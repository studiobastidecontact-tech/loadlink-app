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

from services.search import search_city, CATEGORY_CATALOG

_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 30 * 60

app = FastAPI(
    title="LoadLink API",
    description="Outil de prospection commerciale — recherche d'établissements via OpenStreetMap.",
    version="0.3.0",
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


@app.get(f"{PREFIX}/health")
def health():
    return {"status": "ok"}


@app.get(f"{PREFIX}/api/categories", response_model=list[CategoryOption])
def list_categories():
    """Liste des catégories disponibles pour le filtre du frontend."""
    return [{"key": key, "label": cfg["label"]} for key, cfg in CATEGORY_CATALOG.items()]


@app.get(f"{PREFIX}/api/search", response_model=list[Company])
def search(
    city: str = Query(..., min_length=2, description="Nom de la ville, pour l'affichage et le repli si lat/lon absents"),
    scrape_emails: bool = Query(False, description="Tenter d'extraire un email depuis le site de chaque établissement"),
    categories: str | None = Query(None, description="Clés de catégories séparées par des virgules. Vide = toutes."),
    lat: float | None = Query(None, description="Latitude du centre de recherche (recommandé : évite l'ambiguïté des noms de ville)"),
    lon: float | None = Query(None, description="Longitude du centre de recherche"),
    radius_km: float = Query(5.0, ge=0.5, le=20.0, description="Rayon de recherche en kilomètres autour du centre"),
):
    """
    Recherche les établissements publics autour d'un point (ou d'une ville),
    filtrés par catégories, et retourne une liste normalisée.
    """
    category_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else None

    cats_key = ",".join(sorted(category_list)) if category_list else "all"
    cache_key = f"{city.strip().lower()}::{scrape_emails}::{cats_key}::{lat}:{lon}:{radius_km}"
    cached = _CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        results = search_city(
            city=city,
            scrape_emails=scrape_emails,
            categories=category_list,
            lat=lat,
            lon=lon,
            radius_km=radius_km,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _CACHE[cache_key] = (time.time(), results)
    return results
