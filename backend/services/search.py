"""
services/search.py

Récupère les établissements publics (restaurants, bars, hôtels, etc.)
pour une ville donnée via OSMnx / Overpass API, puis normalise
les résultats au format attendu par le frontend.
"""

import re
import logging
from typing import Optional

import osmnx as ox
import requests

# Sur les plateformes serverless (Vercel...), le système de fichiers est
# en lecture seule sauf /tmp. On y redirige le cache OSMnx.
ox.settings.cache_folder = "/tmp/osmnx_cache"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("loadlink.search")

# Tags OSM correspondant aux catégories ciblées.
# Voir https://wiki.openstreetmap.org/wiki/Key:amenity / Key:tourism
OSM_TAGS = {
    "amenity": [
        "restaurant",
        "bar",
        "cafe",
        "pub",
        "fast_food",
        "biergarten",
    ],
    "tourism": [
        "hotel",
        "guest_house",
        "hostel",
    ],
}

CATEGORY_LABELS = {
    "restaurant": "Restaurant",
    "bar": "Bar",
    "cafe": "Café",
    "pub": "Pub",
    "fast_food": "Fast-food",
    "biergarten": "Brasserie",
    "hotel": "Hôtel",
    "guest_house": "Guest house",
    "hostel": "Hostel",
}

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


def _clean(value) -> Optional[str]:
    """Normalise les valeurs manquantes/NaN renvoyées par OSMnx."""
    if value is None:
        return None
    value = str(value).strip()
    if not value or value.lower() == "nan":
        return None
    return value


def _extract_email_from_website(url: str, timeout: float = 4.0) -> Optional[str]:
    """
    Tentative légère de récupération d'un email public sur la page
    d'accueil du site de l'établissement. Best-effort, ne bloque jamais
    la recherche principale si ça échoue.
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
                # On garde la version la plus complète (avec email/phone/website si dispo)
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
    le même email (même principe que l'ancien scraper Google Maps),
    on ne garde que la première occurrence.
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


def search_city(city: str, scrape_emails: bool = False) -> list[dict]:
    """
    Recherche tous les établissements ciblés dans une ville donnée.

    Args:
        city: nom de la ville (ex: "Brive-la-Gaillarde")
        scrape_emails: si True, tente d'extraire un email depuis le
            site web de chaque établissement (plus lent).

    Returns:
        Liste de dicts au format attendu par le frontend.
    """
    logger.info("Recherche OSM pour la ville: %s", city)

    try:
        gdf = ox.features_from_place(city, tags=OSM_TAGS)
    except Exception as exc:
        logger.error("Échec de la récupération OSM pour %s: %s", city, exc)
        raise ValueError(f"Impossible de récupérer les données pour '{city}': {exc}")

    if gdf.empty:
        return []

    results = []
    for idx, row in gdf.iterrows():
        category = None
        for tag_key in OSM_TAGS:
            if tag_key in row and _clean(row.get(tag_key)):
                raw_cat = _clean(row.get(tag_key))
                if raw_cat in CATEGORY_LABELS:
                    category = CATEGORY_LABELS[raw_cat]
                    break

        name = _clean(row.get("name"))
        if not name or not category:
            # On ignore les entités sans nom ou hors catégories ciblées
            continue

        website = _clean(row.get("website") or row.get("contact:website"))
        email = _clean(row.get("email") or row.get("contact:email"))

        if not email and scrape_emails and website:
            email = _extract_email_from_website(website)

        # osmid est un MultiIndex (element_type, osmid) selon la version d'OSMnx
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
