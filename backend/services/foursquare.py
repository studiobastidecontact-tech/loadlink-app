"""
services/foursquare.py

Source de données complémentaire : Foursquare Places API.
OpenStreetMap est souvent troué (pas de téléphone / site) pour les petits
commerces. Foursquare permet de compléter téléphone + site web, qu'on
utilise ensuite pour retrouver un email (via le scraper de search.py).

La clé API se configure via la variable d'environnement FOURSQUARE_API_KEY
(à définir côté Vercel, jamais dans le code). Si elle est absente,
l'enrichissement Foursquare est simplement désactivé (aucune erreur).

Foursquare a deux générations d'API et le format d'authentification diffère.
Pour être robuste, ce module AUTO-DÉTECTE la bonne génération au premier
appel réussi, puis la réutilise :
  - Nouvelle API : https://places-api.foursquare.com/places/search
      en-têtes : Authorization: Bearer <clé>, X-Places-Api-Version: <date>
  - Ancienne API v3 : https://api.foursquare.com/v3/places/search
      en-tête  : Authorization: <clé>
"""

from __future__ import annotations

import os
import time
import logging
import unicodedata
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

logger = logging.getLogger("loadlink.foursquare")

API_KEY = os.environ.get("FOURSQUARE_API_KEY", "").strip()
API_VERSION = os.environ.get("FOURSQUARE_API_VERSION", "2025-06-17").strip()

# Définitions des deux générations d'API. On tente la nouvelle d'abord.
_MODES = [
    {
        "name": "places-api",
        "url": "https://places-api.foursquare.com/places/search",
        "headers": lambda key: {
            "Authorization": f"Bearer {key}",
            "X-Places-Api-Version": API_VERSION,
            "accept": "application/json",
        },
        "id_field": "fsq_place_id",
    },
    {
        "name": "v3",
        "url": "https://api.foursquare.com/v3/places/search",
        "headers": lambda key: {
            "Authorization": key,
            "accept": "application/json",
        },
        "id_field": "fsq_id",
    },
]

_FIELDS = "name,tel,website,email,location,geocodes,latitude,longitude"

# Mode retenu après auto-détection (index dans _MODES), None tant qu'inconnu.
_active_mode_idx: Optional[int] = None


def is_configured() -> bool:
    return bool(API_KEY)


def _normalize(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def _looks_like_match(query: str, candidate_name: str) -> bool:
    """Évite les correspondances aberrantes : au moins un mot significatif commun."""
    q = set(w for w in _normalize(query).split() if len(w) > 2)
    c = set(w for w in _normalize(candidate_name).split() if len(w) > 2)
    if not q:
        return True
    return bool(q & c)


def _request(mode: dict, params: dict, timeout: float) -> Optional[list]:
    """Effectue une requête ; renvoie la liste des résultats, ou None si échec
    d'authentification (pour déclencher l'essai d'un autre mode)."""
    try:
        resp = requests.get(mode["url"], headers=mode["headers"](API_KEY), params=params, timeout=timeout)
    except requests.RequestException as exc:
        logger.warning("Foursquare (%s) erreur réseau : %s", mode["name"], exc)
        return None
    if resp.status_code in (401, 403):
        logger.info("Foursquare (%s) auth refusée (%s)", mode["name"], resp.status_code)
        return None
    if resp.status_code != 200:
        logger.warning("Foursquare (%s) statut %s : %s", mode["name"], resp.status_code, resp.text[:200])
        return []
    return resp.json().get("results", [])


def _place_to_contacts(place: dict) -> dict:
    return {
        "phone": (place.get("tel") or "").strip() or None,
        "website": (place.get("website") or "").strip() or None,
        "email": (place.get("email") or "").strip() or None,
    }


def search_place(name: str, lat: float, lon: float, radius: int = 400, timeout: float = 6.0) -> dict:
    """Cherche un établissement par nom + position et renvoie {phone, website, email}
    (valeurs None si absentes ou non trouvé)."""
    global _active_mode_idx
    empty = {"phone": None, "website": None, "email": None}
    if not API_KEY or lat is None or lon is None or not name:
        return empty

    params = {
        "query": name,
        "ll": f"{lat},{lon}",
        "radius": radius,
        "limit": 1,
        "fields": _FIELDS,
    }

    # Ordre des modes à essayer : le mode déjà validé d'abord, sinon tous.
    order = [_active_mode_idx] if _active_mode_idx is not None else range(len(_MODES))
    for idx in order:
        results = _request(_MODES[idx], params, timeout)
        if results is None:
            continue  # auth refusée -> essaie le mode suivant
        _active_mode_idx = idx  # ce mode fonctionne, on le mémorise
        if not results:
            return empty
        place = results[0]
        if not _looks_like_match(name, place.get("name", "")):
            return empty
        return _place_to_contacts(place)

    return empty


def status() -> dict:
    """Petit test de bout en bout (pour /api/foursquare-status) : interroge un
    lieu connu et indique si la clé fonctionne et quelle génération d'API."""
    if not API_KEY:
        return {"configured": False, "ok": False, "detail": "FOURSQUARE_API_KEY absente."}
    res = search_place("Tour Eiffel", 48.8584, 2.2945, radius=500)
    mode = _MODES[_active_mode_idx]["name"] if _active_mode_idx is not None else None
    ok = _active_mode_idx is not None
    return {
        "configured": True,
        "ok": ok,
        "api": mode,
        "sample": res,
        "detail": "Clé valide." if ok else "Clé configurée mais aucun mode d'API n'a répondu (auth refusée ?).",
    }


def enrich(
    items: list[dict],
    time_budget_seconds: float = 18.0,
    max_workers: int = 12,
) -> dict[str, dict]:
    """
    Pour chaque item {id, name, lat, lon}, cherche téléphone/site/email sur
    Foursquare, en parallèle et dans un budget de temps borné.
    Renvoie {id: {phone, website, email}}.
    """
    results: dict[str, dict] = {it["id"]: {"phone": None, "website": None, "email": None} for it in items}
    if not API_KEY:
        return results
    candidates = [it for it in items if it.get("lat") is not None and it.get("lon") is not None and it.get("name")]
    if not candidates:
        return results

    deadline = time.monotonic() + time_budget_seconds

    def _task(it: dict) -> tuple[str, dict]:
        if deadline - time.monotonic() <= 0:
            return it["id"], {"phone": None, "website": None, "email": None}
        return it["id"], search_place(it["name"], it["lat"], it["lon"])

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_task, it) for it in candidates]
        try:
            for f in as_completed(futures, timeout=time_budget_seconds + 5):
                try:
                    iid, contacts = f.result()
                    results[iid] = contacts
                except Exception:
                    continue
        except TimeoutError:
            pass

    return results
