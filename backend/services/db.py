"""
services/db.py

Collecte automatique des établissements trouvés vers une base Supabase
(PostgreSQL). À chaque recherche/enrichissement, le frontend envoie les
résultats à /api/collect, qui les enregistre ici : chaque établissement est
ajouté ou complété (jamais écrasé par une valeur vide), pour construire au
fil du temps une base centrale que le propriétaire peut consulter/exporter.

Configuration (variables d'environnement, côté Vercel) :
  SUPABASE_URL          ex: https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  la clé "service_role" (secrète)
  ADMIN_TOKEN           mot de passe pour la page admin / l'export

Si SUPABASE_URL/KEY sont absentes, la collecte est désactivée (aucune erreur).

Utilise l'API REST de Supabase (PostgREST) via HTTP : pas de driver SQL ni de
pool de connexions à gérer, adapté au serverless.
"""

from __future__ import annotations

import os
import re
import logging
import unicodedata
from typing import Optional

import requests

logger = logging.getLogger("loadlink.db")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()

_TABLE = "establishments"


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def admin_ok(token: Optional[str]) -> bool:
    return bool(ADMIN_TOKEN) and token == ADMIN_TOKEN


def _headers(extra: Optional[dict] = None) -> dict:
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFD", (text or "").lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _dedup_key(item: dict) -> str:
    """Clé de déduplication stable d'un établissement : nom + code postal (ou
    ville). Permet de fusionner la même entreprise vue via plusieurs sources."""
    name = _slug(item.get("name", ""))
    loc = _slug(item.get("postcode") or item.get("city") or "")
    return f"{name}|{loc}"


def _clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _to_row(item: dict) -> Optional[dict]:
    name = _clean(item.get("name"))
    if not name:
        return None
    return {
        "dedup_key": _dedup_key(item),
        "name": name,
        "category": _clean(item.get("category")),
        "phone": _clean(item.get("phone")),
        "email": _clean(item.get("email")),
        "website": _clean(item.get("website")),
        "street": _clean(item.get("street")),
        "postcode": _clean(item.get("postcode")),
        "city": _clean(item.get("city")),
        "lat": item.get("lat"),
        "lon": item.get("lon"),
        "source": _clean(item.get("source")) or "openstreetmap",
    }


def collect(items: list[dict], timeout: float = 8.0) -> dict:
    """Enregistre/complète un lot d'établissements. Best-effort : n'échoue
    jamais l'appelant. Renvoie {saved: n} ou {error: ...}."""
    if not is_configured():
        return {"configured": False, "saved": 0}
    rows = [r for r in (_to_row(it) for it in items) if r]
    if not rows:
        return {"configured": True, "saved": 0}
    # RPC 'upsert_establishments' : fusionne sans écraser par des valeurs vides
    # (voir le script SQL fourni). On envoie par lots raisonnables.
    saved = 0
    try:
        for i in range(0, len(rows), 200):
            batch = rows[i:i + 200]
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc/upsert_establishments",
                headers=_headers(),
                json={"rows": batch},
                timeout=timeout,
            )
            if resp.status_code >= 400:
                logger.warning("Supabase upsert %s: %s", resp.status_code, resp.text[:300])
                return {"configured": True, "saved": saved, "error": f"{resp.status_code}: {resp.text[:200]}"}
            saved += len(batch)
    except requests.RequestException as exc:
        logger.warning("Supabase réseau: %s", exc)
        return {"configured": True, "saved": saved, "error": str(exc)}
    return {"configured": True, "saved": saved}


def list_establishments(limit: int = 100, offset: int = 0, search: str = "") -> dict:
    """Liste paginée pour la page admin. Renvoie {total, rows}."""
    if not is_configured():
        return {"total": 0, "rows": []}
    params = {
        "select": "*",
        "order": "last_seen.desc",
        "limit": str(max(1, min(limit, 1000))),
        "offset": str(max(0, offset)),
    }
    if search:
        # recherche insensible à la casse sur nom, ville, catégorie
        s = search.replace(",", " ").strip()
        params["or"] = f"(name.ilike.*{s}*,city.ilike.*{s}*,category.ilike.*{s}*)"
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{_TABLE}",
        headers=_headers({"Prefer": "count=exact"}),
        params=params,
        timeout=10,
    )
    resp.raise_for_status()
    total = 0
    cr = resp.headers.get("content-range", "")
    if "/" in cr:
        try:
            total = int(cr.split("/")[-1])
        except ValueError:
            total = 0
    return {"total": total, "rows": resp.json()}


def fetch_all(max_rows: int = 50000) -> list[dict]:
    """Récupère toutes les fiches (pour l'export), par pages."""
    if not is_configured():
        return []
    out: list[dict] = []
    page = 1000
    offset = 0
    while offset < max_rows:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{_TABLE}",
            headers=_headers(),
            params={"select": "*", "order": "last_seen.desc", "limit": str(page), "offset": str(offset)},
            timeout=15,
        )
        resp.raise_for_status()
        batch = resp.json()
        out.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return out


def status() -> dict:
    """Vérifie la configuration et la connexion à la base."""
    if not is_configured():
        return {"configured": False, "ok": False, "detail": "SUPABASE_URL / SUPABASE_SERVICE_KEY absentes."}
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{_TABLE}",
            headers=_headers({"Prefer": "count=exact"}),
            params={"select": "dedup_key", "limit": "1"},
            timeout=10,
        )
    except requests.RequestException as exc:
        return {"configured": True, "ok": False, "detail": f"réseau: {exc}"}
    if resp.status_code >= 400:
        return {
            "configured": True,
            "ok": False,
            "detail": f"{resp.status_code}: {resp.text[:300]}",
            "hint": "As-tu bien exécuté le script SQL (table + fonction) dans Supabase ?",
        }
    total = 0
    cr = resp.headers.get("content-range", "")
    if "/" in cr:
        try:
            total = int(cr.split("/")[-1])
        except ValueError:
            total = 0
    return {"configured": True, "ok": True, "detail": "Connexion OK.", "total_collected": total, "admin_token_set": bool(ADMIN_TOKEN)}
