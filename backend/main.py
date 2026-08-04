"""
main.py — Point d'entrée FastAPI pour LoadLink.

Lancer en dev:
    uvicorn main:app --reload --port 8000

Toutes les routes sont préfixées par /api/backend pour correspondre
au routage multi-services de Vercel (voir vercel.json à la racine).
"""

import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services import catalog
from services.search import search_city, enrich_emails

_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 30 * 60

app = FastAPI(
    title="LoadLink API",
    description="Outil de prospection commerciale — moteur de recherche universel d'entreprises via OpenStreetMap.",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PREFIX = "/api/backend"


class Company(BaseModel):
    id: str
    name: str
    category: str
    phone: str | None = None
    website: str | None = None
    email: str | None = None
    street: str | None = None
    postcode: str | None = None
    city: str | None = None
    lat: float | None = None
    lon: float | None = None


class CategoryOption(BaseModel):
    key: str
    label: str
    group: str | None = None


class EnrichItem(BaseModel):
    id: str
    website: str | None = None


class EnrichResult(BaseModel):
    emails: dict[str, str | None]


@app.get(f"{PREFIX}/health")
def health():
    return {"status": "ok", "activities": catalog.count()}


@app.get(f"{PREFIX}/api/categories", response_model=list[CategoryOption])
def categories(
    q: str = Query("", description="Texte tapé par l'utilisateur (autocomplétion). Vide = aucune suggestion."),
    limit: int = Query(12, ge=1, le=50, description="Nombre maximum de suggestions."),
):
    """
    Autocomplétion universelle des activités : « avo » -> Cabinet d'avocats,
    « cine » -> Cinéma, etc. Les tags OpenStreetMap ne sont jamais exposés,
    seuls le libellé FR et une clé opaque sont renvoyés.
    """
    return catalog.search(q, limit=limit)


@app.get(f"{PREFIX}/api/search", response_model=list[Company])
def search(
    city: str = Query(..., min_length=2, description="Nom de la ville, pour l'affichage et le repli si lat/lon absents"),
    categories: str = Query(..., description="Clés d'activités séparées par des virgules (ex. 'office=lawyer,amenity=cinema'). Obligatoire."),
    lat: float | None = Query(None, description="Latitude du centre de recherche (recommandé : évite l'ambiguïté des noms de ville)"),
    lon: float | None = Query(None, description="Longitude du centre de recherche"),
    radius_km: float = Query(5.0, ge=0.5, le=20.0, description="Rayon de recherche en kilomètres autour du centre"),
):
    """
    Recherche les entreprises/établissements des activités choisies autour
    d'un point (ou d'une ville), et retourne une liste normalisée.
    """
    category_list = [c.strip() for c in categories.split(",") if c.strip()]
    if not category_list:
        raise HTTPException(status_code=400, detail="Sélectionne au moins une activité à rechercher.")

    cats_key = ",".join(sorted(category_list))
    cache_key = f"{city.strip().lower()}::{cats_key}::{lat}:{lon}:{radius_km}"
    cached = _CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        results = search_city(
            city=city,
            categories=category_list,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _CACHE[cache_key] = (time.time(), results)
    return results


@app.post(f"{PREFIX}/api/enrich-emails", response_model=EnrichResult)
def enrich(items: list[EnrichItem]):
    """
    Tente de récupérer un email public pour un lot d'établissements
    (à partir de leur site web). Appelé par petits lots depuis le frontend
    après l'affichage des résultats, pour rester sous la limite de temps
    des fonctions serverless.
    """
    payload = [{"id": it.id, "website": it.website} for it in items]
    emails = enrich_emails(payload)
    return {"emails": emails}
