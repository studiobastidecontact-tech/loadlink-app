"""
services/search.py

Récupère les établissements publics via OSMnx / Overpass API selon les
catégories choisies par l'utilisateur, puis normalise les résultats au
format attendu par le frontend.
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

# Catalogue des catégories disponibles. Clé = identifiant utilisé par le
# frontend et l'API. Chaque catégorie correspond à un tag OSM précis.
# Voir https://wiki.openstreetmap.org/wiki/Key:amenity / Key:tourism / Key:office
CATEGORY_CATALOG: dict[str, dict] = {
    "restaurant":  {"osm_key": "amenity", "osm_value": "restaurant",  "label": "Restaurant"},
    "bar":         {"osm_key": "amenity", "osm_value": "bar",         "label": "Bar"},
    "cafe":        {"osm_key": "amenity", "osm_value": "cafe",        "label": "Café"},
    "pub":         {"osm_key": "amenity", "osm_value": "pub",         "label": "Pub"},
    "fast_food":   {"osm_key": "amenity", "osm_value": "fast_food",   "label": "Fast-food"},
    "biergarten":  {"osm_key": "amenity", "osm_value": "biergarten",  "label": "Brasserie"},
    "hotel":       {"osm_key": "tourism", "osm_value": "hotel",       "label": "Hôtel"},
    "guest_house": {"osm_key": "tourism", "osm_value": "guest_house", "label": "Guest house"},
    "hostel":      {"osm_key": "tourism", "osm_value": "hostel",      "label": "Hostel"},
    "estate_agent":       {"osm_key": "office", "osm_value": "estate_agent",       "label": "Agence immobilière"},
    "advertising_agency": {"osm_key": "office", "osm_value": "advertising_agency", "label": "Agence de communication"},
}

CATEGORY_LABELS = {key: cfg["label"] for key, cfg in CATEGORY_CATALOG.items()}

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


def _build_osm_tags(selected_categories: Optional[list[str]]) -> dict:
    """
    Construit le dict de tags OSM à interroger à partir des catégories
    choisies. Si selected_categories est None ou vide, on prend TOUT
    le catalogue (comportement par défaut = "tout sélectionner").
    """
    keys = selected_categories or list(CATEGORY_CATALOG.keys())
    tags: dict[str, list[str]] = {}
    for key in keys:
        cfg = CATEGORY_CATALOG.get(key)
        if not cfg:
            continue  # catégorie inconnue, on ignore silencieusement
        tags.setdefault(cfg["osm_key"], []).append(cfg["osm_value"])
    return tags


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
    scrape_emails: bool = False,
    categories: Optional[list[str]] = None,
) -> list[dict]:
    """
    Recherche les établissements ciblés dans une ville donnée.

    Args:
        city: nom de la ville (ex: "Brive-la-Gaillarde")
        scrape_emails: si True, tente d'extraire un email depuis le
            site web de chaque établissement (plus lent).
        categories: liste de clés de CATEGORY_CATALOG à rechercher.
            None ou liste vide = toutes les catégories.

    Returns:
        Liste de dicts au format attendu par le frontend.
    """
    osm_tags = _build_osm_tags(categories)
    logger.info("Recherche OSM pour la ville: %s (catégories: %s)", city, list(osm_tags.keys()))

    try:
        gdf = ox.features_from_place(city, tags=osm_tags)
    except Exception as exc:
        logger.error("Échec de la récupération OSM pour %s: %s", city, exc)
        raise ValueError(f"Impossible de récupérer les données pour '{city}': {exc}")

    if gdf.empty:
        return []

    results = []
    for idx, row in gdf.iterrows():
        category = None
        for tag_key in osm_tags:
            if tag_key in row and _clean(row.get(tag_key)):
                raw_cat = _clean(row.get(tag_key))
                if raw_cat in CATEGORY_LABELS:
                    category = CATEGORY_LABELS[raw_cat]
                    break

        name = _clean(row.get("name"))
        if not name or not category:
            continue

        website = _clean(row.get("website") or row.get("contact:website"))
        email = _clean(row.get("email") or row.get("contact:email"))

        if not email and scrape_emails and website:
            email = _extract_email_from_website(website)

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
