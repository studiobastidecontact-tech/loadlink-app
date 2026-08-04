"""
services/search.py

Récupère les établissements/entreprises via OSMnx / Overpass API selon
les activités choisies par l'utilisateur, dans un rayon autour d'un point
(coordonnées GPS de préférence, ou nom de ville en repli), puis normalise
les résultats au format attendu par le frontend.

Le moteur est UNIVERSEL : les activités interrogeables proviennent du
catalogue généré depuis OpenStreetMap (services/catalog.py + catalog.json),
et non plus d'une liste codée en dur. Voir scripts/build_catalog.py.

La récupération d'emails est séparée de la recherche (voir enrich_emails) :
sur de gros volumes, scraper chaque site web dans le même appel dépasserait
la limite de temps des fonctions serverless.
"""

import re
import time
import html as html_lib
import logging
from typing import Optional
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import osmnx as ox
import requests

from services import catalog

# Sur les plateformes serverless (Vercel...), le système de fichiers est
# en lecture seule sauf /tmp. On y redirige le cache OSMnx.
ox.settings.cache_folder = "/tmp/osmnx_cache"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("loadlink.search")

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Téléphone français : fixe/mobile en 0X..., ou +33 / 0033.
PHONE_REGEX = re.compile(
    r"(?:(?:\+|00)33[\s.\-]?\(?0?\)?|0)\s?[1-9](?:[\s.\-]?\d{2}){4}"
)

HREF_REGEX = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
MAILTO_REGEX = re.compile(r'mailto:([^"\'?>\s]+)', re.IGNORECASE)
TEL_REGEX = re.compile(r'tel:([+0-9.\s\-()]{6,})', re.IGNORECASE)

# Liens de pages où les coordonnées sont presque toujours affichées.
CONTACT_HINTS = (
    "contact", "contactez", "nous-contacter", "nous_contacter",
    "mentions-legales", "mentions_legales", "mentionslegales",
    "legal", "a-propos", "apropos", "about",
)

# Faux positifs fréquents dans les emails scrappés (assets, exemples, trackers).
EMAIL_BLOCKLIST = (
    "sentry", "wixpress", "example.", "example@", "yourdomain", "your-email",
    "your@email", "domain.com", "email@example", "@2x", "@sentry", "u003e",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
)


def _valid_email(raw: str) -> bool:
    e = raw.strip().lower()
    if not e or "@" not in e:
        return False
    if any(bad in e for bad in EMAIL_BLOCKLIST):
        return False
    if e.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico")):
        return False
    return True


def _normalize_phone(raw: str) -> Optional[str]:
    """Normalise un numéro FR au format '0X XX XX XX XX', ou None si invalide.
    Gère 0X..., +33 X..., +33(0)X..., 0033X..."""
    d = re.sub(r"\D", "", raw)
    # Retire l'indicatif international +33 / 0033 si présent.
    if d.startswith("0033"):
        d = d[4:]
    elif d.startswith("33"):
        d = d[2:]
    # Rajoute le 0 national si l'indicatif l'a mangé (ex. "+33 1 23..." -> 9 chiffres).
    if len(d) == 9 and d[0] in "123456789":
        d = "0" + d
    if len(d) == 10 and d[0] == "0" and d[1] in "123456789":
        return " ".join(d[i:i + 2] for i in range(0, 10, 2))
    return None


def _clean(value) -> Optional[str]:
    """Normalise les valeurs manquantes/NaN renvoyées par OSMnx."""
    if value is None:
        return None
    value = str(value).strip()
    if not value or value.lower() == "nan":
        return None
    return value


def _fetch_html(url: str, timeout: float) -> Optional[str]:
    """Récupère le HTML d'une page. Best-effort, renvoie None si échec."""
    try:
        resp = requests.get(url, timeout=timeout, headers={
            "User-Agent": "Mozilla/5.0 (compatible; LoadLinkBot/1.0)"
        })
        if resp.status_code != 200:
            return None
        ctype = resp.headers.get("content-type", "")
        if ctype and "html" not in ctype and "text" not in ctype:
            return None
        return resp.text
    except requests.RequestException:
        return None


def _extract_from_html(text: str) -> tuple[list[str], list[str]]:
    """Extrait (emails, téléphones) d'un HTML : d'abord les liens mailto:/tel:
    (les plus fiables), puis les motifs dans le texte."""
    emails: list[str] = []
    phones: list[str] = []

    for m in MAILTO_REGEX.findall(text):
        e = html_lib.unescape(m).strip()
        if _valid_email(e) and e not in emails:
            emails.append(e)
    for m in TEL_REGEX.findall(text):
        p = _normalize_phone(m)
        if p and p not in phones:
            phones.append(p)
    for e in EMAIL_REGEX.findall(text):
        e = html_lib.unescape(e).strip()
        if _valid_email(e) and e not in emails:
            emails.append(e)
    for m in PHONE_REGEX.findall(text):
        p = _normalize_phone(m)
        if p and p not in phones:
            phones.append(p)
    return emails, phones


def _contact_links(text: str, base_url: str, limit: int = 2) -> list[str]:
    """Repère les liens vers les pages Contact / Mentions légales du même domaine."""
    host = urlparse(base_url).netloc
    found: list[str] = []
    for href in HREF_REGEX.findall(text):
        low = href.lower()
        if any(hint in low for hint in CONTACT_HINTS):
            full = urljoin(base_url, href)
            if urlparse(full).netloc == host and full not in found and full != base_url:
                found.append(full)
        if len(found) >= limit:
            break
    return found


def _pick_email(candidates: list[str], website_host: str) -> Optional[str]:
    """Privilégie un email du même domaine que le site (plus fiable)."""
    if not candidates:
        return None
    base = website_host.replace("www.", "")
    same = [e for e in candidates if e.split("@")[-1].lower().endswith(base)]
    return (same or candidates)[0]


def _extract_contacts_from_website(url: str, deadline: float) -> tuple[Optional[str], Optional[str]]:
    """
    Récupère (email, téléphone) publics depuis le site d'un établissement :
    page d'accueil, puis 1 à 2 pages « Contact » / « Mentions légales » du
    même domaine si un contact manque encore. Best-effort, borné par `deadline`.
    """
    if not url:
        return None, None
    if not url.startswith("http"):
        url = f"https://{url}"

    def remaining() -> float:
        return deadline - time.monotonic()

    if remaining() <= 0.5:
        return None, None

    host = urlparse(url).netloc
    home = _fetch_html(url, timeout=min(3.0, max(0.8, remaining())))
    if home is None:
        return None, None

    emails, phones = _extract_from_html(home)
    email = _pick_email(emails, host)
    phone = phones[0] if phones else None

    # Il manque un email ou un téléphone : on tente les pages de contact.
    if (email is None or phone is None) and remaining() > 1.0:
        for link in _contact_links(home, url):
            if remaining() <= 1.0:
                break
            page = _fetch_html(link, timeout=min(2.5, max(0.8, remaining())))
            if not page:
                continue
            e2, p2 = _extract_from_html(page)
            if email is None:
                email = _pick_email(e2, host)
            if phone is None and p2:
                phone = p2
            if email and phone:
                break

    return email, phone


def enrich_contacts(
    items: list[dict],
    time_budget_seconds: float = 22.0,
    max_workers: int = 20,
) -> dict[str, dict[str, Optional[str]]]:
    """
    Tente de récupérer email + téléphone pour chaque item {id, website}, en
    parallèle et dans un budget de temps borné. Conçu pour être appelé par
    petits lots (voir /api/enrich-contacts) afin de rester sous la limite de
    durée des fonctions serverless.

    Les items non traités dans le budget ressortent à {email: None, phone: None}.
    """
    deadline = time.monotonic() + time_budget_seconds
    results: dict[str, dict[str, Optional[str]]] = {
        item["id"]: {"email": None, "phone": None} for item in items
    }
    candidates = [item for item in items if item.get("website")]
    if not candidates:
        return results

    def _task(item: dict) -> tuple[str, Optional[str], Optional[str]]:
        if deadline - time.monotonic() <= 0:
            return item["id"], None, None
        email, phone = _extract_contacts_from_website(item["website"], deadline)
        return item["id"], email, phone

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_task, item) for item in candidates]
        try:
            for future in as_completed(futures, timeout=time_budget_seconds + 5):
                try:
                    item_id, email, phone = future.result()
                    results[item_id] = {"email": email, "phone": phone}
                except Exception:
                    continue
        except TimeoutError:
            # Budget global dépassé : on renvoie ce qu'on a pu récupérer.
            pass

    return results


def _resolve_category(row, osm_tags: dict[str, list[str]]) -> Optional[str]:
    """Détermine le libellé FR de la ligne OSM à partir des tags interrogés."""
    for key, values in osm_tags.items():
        raw = _clean(row.get(key))
        if raw and raw in values:
            return catalog.label_for(key, raw) or raw.replace("_", " ").capitalize()
    return None


def _dedupe(results: list[dict], distance_threshold: float = 0.0005) -> list[dict]:
    """
    Overpass renvoie fréquemment le même établissement en double
    (ex: un nœud ET la way/building associée). On déduplique par
    nom identique + proximité géographique (~50m par défaut).
    """
    deduped: list[dict] = []
    for item in results:
        is_duplicate = False
        for kept in deduped:
            if item["name"].strip().lower() != kept["name"].strip().lower():
                continue
            if item["lat"] is None or kept["lat"] is None:
                continue
            close_enough = (
                abs(item["lat"] - kept["lat"]) < distance_threshold
                and abs(item["lon"] - kept["lon"]) < distance_threshold
            )
            if close_enough:
                if sum(bool(kept.get(k)) for k in ("email", "phone", "website")) < sum(
                    bool(item.get(k)) for k in ("email", "phone", "website")
                ):
                    deduped.remove(kept)
                    deduped.append(item)
                is_duplicate = True
                break
        if not is_duplicate:
            deduped.append(item)
    return deduped


def _dedupe_by_email(results: list[dict]) -> list[dict]:
    """
    Sécurité supplémentaire : si deux entrées OSM distinctes partagent
    le même email, on ne garde que la première occurrence.
    """
    seen_emails: set[str] = set()
    deduped: list[dict] = []
    for item in results:
        email = item.get("email")
        if email:
            email_key = email.strip().lower()
            if email_key in seen_emails:
                continue
            seen_emails.add(email_key)
        deduped.append(item)
    return deduped


def search_city(
    city: str,
    categories: Optional[list[str]] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_km: float = 5.0,
) -> list[dict]:
    """
    Recherche les entreprises/établissements des activités choisies autour
    d'un point ou d'une ville.

    categories : liste d'identifiants d'activités « clé=valeur » (issus du
        catalogue, ex. "office=lawyer", "amenity=cinema"). Au moins une
        activité est requise — le moteur ne recherche pas « tout » à la fois.
    lat/lon : si fournis, évite la géocodification du nom de ville
        (plus précis, plus rapide, pas d'ambiguïté entre communes homonymes).
    radius_km : rayon de recherche en kilomètres.

    Ne fait PAS de scraping d'email : cette étape est déléguée à
    enrich_emails, appelée séparément par lots depuis le frontend.
    """
    osm_tags = catalog.build_osm_tags(categories)
    if not osm_tags:
        raise ValueError("Sélectionne au moins une activité à rechercher.")

    radius_m = int(max(500, min(radius_km, 20) * 1000))
    logger.info(
        "Recherche OSM pour %s (rayon %sm, tags: %s)",
        city, radius_m, osm_tags,
    )

    try:
        if lat is not None and lon is not None:
            gdf = ox.features_from_point((lat, lon), tags=osm_tags, dist=radius_m)
        else:
            gdf = ox.features_from_address(city, tags=osm_tags, dist=radius_m)
    except Exception as exc:
        if "no data elements" in str(exc).lower() or "InsufficientResponseError" in type(exc).__name__:
            logger.info("Aucun établissement trouvé pour %s avec ces activités.", city)
            return []
        logger.error("Échec de la récupération OSM pour %s: %s", city, exc)
        raise ValueError(f"Impossible de récupérer les données pour '{city}': {exc}")

    if gdf.empty:
        return []

    results = []
    for idx, row in gdf.iterrows():
        category = _resolve_category(row, osm_tags)
        name = _clean(row.get("name"))
        if not name or not category:
            continue

        website = _clean(row.get("website") or row.get("contact:website"))
        email = _clean(row.get("email") or row.get("contact:email"))

        osm_id = idx[1] if isinstance(idx, tuple) else idx
        centroid = row.geometry.centroid if row.geometry is not None else None

        results.append({
            "id": str(osm_id),
            "name": name,
            "category": category,
            "phone": _clean(row.get("phone") or row.get("contact:phone")),
            "website": website,
            "email": email,
            "street": _clean(row.get("addr:street")),
            "postcode": _clean(row.get("addr:postcode")),
            "city": _clean(row.get("addr:city")) or city,
            "lat": centroid.y if centroid is not None else None,
            "lon": centroid.x if centroid is not None else None,
        })

    results = _dedupe(results)
    results = _dedupe_by_email(results)

    logger.info("Résultats trouvés pour %s: %d (après déduplication)", city, len(results))
    return results
