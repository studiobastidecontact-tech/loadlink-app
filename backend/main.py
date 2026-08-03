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

from services.search import search_city

# Cache mémoire très simple (ville+options -> résultats) avec TTL.
# Overpass est un service public avec des limites d'usage strictes ;
# ce cache évite de le solliciter à chaque re-clic sur la même ville.
# À remplacer par Redis si l'app passe en multi-instance.
_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 30 * 60

app = FastAPI(
    title="LoadLink API",
    description="Outil de prospection commerciale — recherche d'établissements via OpenStreetMap.",
    version="0.1.0",
)

# En dev, on autorise le frontend Next.js local. À restreindre en prod.
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


@app.get(f"{PREFIX}/health")
def health():
    return {"status": "ok"}


@app.get(f"{PREFIX}/api/search", response_model=list[Company])
def search(
    city: str = Query(..., min_length=2, description="Nom de la ville, ex: 'Brive-la-Gaillarde'"),
    scrape_emails: bool = Query(False, description="Tenter d'extraire un email depuis le site de chaque établissement"),
):
    """
    Recherche les établissements publics (restaurants, bars, hôtels...)
    d'une ville donnée et retourne une liste normalisée.
    """
    cache_key = f"{city.strip().lower()}::{scrape_emails}"
    cached = _CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        results = search_city(city=city, scrape_emails=scrape_emails)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _CACHE[cache_key] = (time.time(), results)
    return results
