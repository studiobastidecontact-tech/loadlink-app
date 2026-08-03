# LoadLink

Outil de prospection commerciale : recherche d'établissements publics (restaurants, bars, hôtels...) par ville, via OpenStreetMap.

## Structure

```
backend/     FastAPI + OSMnx (recherche OSM, normalisation des données)
frontend/    Next.js 16 (App Router) + TailwindCSS
```

## Lancer le backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # ou venv\Scripts\activate sous Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

L'API est alors disponible sur `http://localhost:8000` (doc interactive sur `/docs`).

## Lancer le frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Le site est alors disponible sur `http://localhost:3000`.

## Prochaines étapes suggérées

- Authentification (multi-utilisateurs, quota de recherches)
- Persistance des recherches en base (Postgres) plutôt que sessionStorage
- Export direct compatible Brevo (comme sur ton app Corrèze en Python)
- Pagination / cache des recherches Overpass (les grandes villes peuvent être lentes)
- Déduplication des établissements proches (doublons OSM fréquents)
- Rate limiting sur `/api/search` (Overpass a ses propres limites d'usage)
