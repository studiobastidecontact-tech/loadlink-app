"""
services/foursquare.py

Source de données complémentaire : Foursquare Places API.
OpenStreetMap est souvent troué (pas de téléphone / site) pour les petits
commerces. Foursquare permet de compléter téléphone + site web, qu'on
utilise ensuite pour retrouver un email (via le scraper de search.py).

La clé API se configure via la variable d'environnement FOURSQUARE_API_KEY
(à définir côté Vercel, jamais dans le code). Si elle est absente,
l'enrichissement Foursquare est simplement désactivé (aucune erreur).

Foursquare a deux générations d'API, avec des en-têtes ET des noms de
champs différents. Ce module AUTO-DÉTECTE la bonne génération :
  - Nouvelle API : https://places-api.foursquare.com/places/search
      en-têtes : Authorization: Bearer <clé>, X-Places-Api-Version: <date>
      champs   : fsq_place_id, latitude, longitude, ...
  - Ancienne API v3 : https://api.foursquare.com/v3/places/search
      en-tête  : Authorization: <clé>
      champs   : fsq_id, geocodes, ...
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

# Deux générations d'API. On tente la nouvelle d'abord.
# NB : le jeu de champs est PROPRE à chaque génération (les mélanger fait
# échouer la sélection et renvoie des fiches sans téléphone/site).
_MODES = [
    {
        "name": "places-api",
        "url": "https://places-api.foursquare.com/places/search",
        "headers": lambda key: {
            "Authorization": f"Bearer {key}",
            "X-Places-Api-Version": API_VERSION,
            "accept": "application/json",
        },
        "fields": "fsq_place_id,name,tel,website,email,location,latitude,longitude",
    },
    {
        "name": "v3",
        "url": "https://api.foursquare.com/v3/places/search",
        "headers": lambda key: {
            "Authorization": key,
            "accept": "application/json",
        },
        "fields": "fsq_id,name,tel,website,email,location,geocodes",
    },
]

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


def _search_raw(mode: dict, params: dict, timeout: float) -> dict:
    """Effectue une requête et renvoie un dict de diagnostic :
    {auth_ok, status, results, error}. auth_ok=False signale un refus
    d'authentification (401/403) -> on essaiera une autre génération d'API."""
    full = {**params, "fields": mode["fields"]}
    try:
        resp = requests.get(mode["url"], headers=mode["headers"](API_KEY), params=full, timeout=timeout)
    except requests.RequestException as exc:
        return {"auth_ok": True, "status": None, "results": [], "error": f"réseau: {exc}"}
    if resp.status_code in (401, 403):
        return {"auth_ok": False, "status": resp.status_code, "results": [], "error": resp.text[:200]}
    if resp.status_code != 200:
        return {"auth_ok": True, "status": resp.status_code, "results": [], "error": resp.text[:300]}
    try:
        data = resp.json()
    except ValueError:
        return {"auth_ok": True, "status": 200, "results": [], "error": "réponse non-JSON"}
    return {"auth_ok": True, "status": 200, "results": data.get("results", []), "error": None}


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

    params = {"query": name, "ll": f"{lat},{lon}", "radius": radius, "limit": 1}
    order = [_active_mode_idx] if _active_mode_idx is not None else range(len(_MODES))
    for idx in order:
        raw = _search_raw(_MODES[idx], params, timeout)
        if not raw["auth_ok"]:
            continue  # auth refusée -> essaie le mode suivant
        _active_mode_idx = idx
        results = raw["results"]
        if not results:
            return empty
        place = results[0]
        if not _looks_like_match(name, place.get("name", "")):
            return empty
        return _place_to_contacts(place)
    return empty


def status(query: str = "Starbucks", ll: str = "48.8698,2.3079", radius: int = 3000) -> dict:
    """Diagnostic complet pour /api/foursquare-status : teste chaque génération
    d'API sur un lieu donné (par défaut un Starbucks parisien) et renvoie la
    réponse brute, pour voir exactement ce que Foursquare retourne.
    On peut passer ?q=...&ll=lat,lon pour tester un établissement précis."""
    global _active_mode_idx
    if not API_KEY:
        return {"configured": False, "ok": False, "detail": "FOURSQUARE_API_KEY absente."}

    params = {"query": query, "ll": ll, "radius": radius, "limit": 3}
    attempts = []
    working = None
    for idx, mode in enumerate(_MODES):
        raw = _search_raw(mode, params, 6.0)
        preview = [
            {"name": r.get("name"), "tel": r.get("tel"), "website": r.get("website"), "email": r.get("email")}
            for r in raw["results"][:3]
        ]
        attempts.append({
            "api": mode["name"],
            "auth_ok": raw["auth_ok"],
            "http": raw["status"],
            "results": len(raw["results"]),
            "preview": preview,
            "first_result": raw["results"][0] if raw["results"] else None,
            "error": raw["error"],
        })
        if raw["auth_ok"] and raw["status"] == 200 and working is None:
            working = idx
            _active_mode_idx = idx

    ok = working is not None
    return {
        "configured": True,
        "ok": ok,
        "api": _MODES[working]["name"] if ok else None,
        "detail": "Clé valide." if ok else "Clé configurée mais aucune génération d'API n'a répondu 200.",
        "attempts": attempts,
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
