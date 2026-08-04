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
import logging
from typing import Optional
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


def _clean(value) -> Optional[str]:
    """Normalise les valeurs manquantes/NaN renvoyées par OSMnx."""
    if value is None:
        return None
    value = str(value).strip()
    if not value or value.lower() == "nan":
        return None
    return value


def _extract_email_from_website(url: str, timeout: float = 3.0) -> Optional[str]:
    """
    Tentative légère de récupération d'un email public sur la page
    d'accueil du site de l'établissement. Best-effort, ne bloque jamais
    l'appelant si ça échoue.
    """
    if not url:
        return None
    if not url.startswith("http"):
        url = f"https://{url}"
    try:
        resp = requests.get(url, timeout=timeout, headers={
            "User-Agent": "Mozilla/5.0 (compatible; LoadLinkBot/1.0)"
        })
        if resp.status_code != 200:
            return None
        match = EMAIL_REGEX.search(resp.text)
        return match.group(0) if match else None
    except requests.RequestException:
        return None


def enrich_emails(
    items: list[dict],
    time_budget_seconds: float = 20.0,
    max_workers: int = 25,
) -> dict[str, Optional[str]]:
    """
    Tente de récupérer un email pour chaque item {id, website}, en
    parallèle et dans un budget de temps borné. Conçu pour être appelé
    par petits lots (voir /api/enrich-emails) plutôt que sur un très
    grand nombre de résultats d'un coup, afin de rester largement sous
    la limite de durée des fonctions serverless.

    Les items qui n'ont pas pu être traités dans le budget de temps
    ressortent simplement à None (pas d'erreur).
    """
    deadline = time.monotonic() + time_budget_seconds
    results: dict[str, Optional[str]] = {item["id"]: None for item in items}
    candidates = [item for item in items if item.get("website")]

    if not candidates:
        return results

    def _task(item: dict) -> tuple[str, Optional[str]]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return item["id"], None
        per_item_timeout = min(3.0, max(0.5, remaining))
        return item["id"], _extract_email_from_website(item["website"], timeout=per_item_timeout)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_task, item) for item in candidates]
        try:
            for future in as_completed(futures, timeout=time_budget_seconds + 5):
                try:
                    item_id, email = future.result()
                    results[item_id] = email
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
