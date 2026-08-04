# LoadLink

Outil de prospection commerciale : **moteur de recherche universel d'entreprises**
en France. On choisit une zone (région → département → ville + rayon), on tape une
activité en langage naturel (« avocat », « cinéma », « boîte de production »,
« garagiste »…), et LoadLink récupère les établissements correspondants via
OpenStreetMap, avec leurs informations publiques (nom, adresse, téléphone,
site web, email).

## Structure

```
backend/     FastAPI + OSMnx (recherche OSM, normalisation des données)
frontend/    Next.js 16 (App Router) + TailwindCSS
```

## Moteur d'activités universel

LoadLink ne contient **aucune liste de catégories écrite à la main**. Les activités
interrogeables proviennent des « presets » officiels de l'éditeur OpenStreetMap iD
(paquet `@openstreetmap/id-tagging-schema`), communautaires et déjà traduits en
français. Chaque activité (~477 aujourd'hui) associe un libellé FR, des synonymes
de recherche et le bon tag OSM — l'utilisateur ne voit jamais les tags.

- `backend/services/catalog.json` — catalogue généré (données, à committer).
- `backend/services/catalog.py` — autocomplétion (insensible aux accents),
  construction des tags OSM, résolution des libellés.
- `backend/services/aliases.json` — **seul fichier à éditer à la main** : des
  synonymes FR supplémentaires (ex. « boîte de production ») pointant vers un
  preset existant.
- `backend/scripts/build_catalog.py` — régénère `catalog.json` depuis la dernière
  version des presets. Pour ajouter/mettre à jour des activités :

```bash
cd backend
python scripts/build_catalog.py   # installe id-tagging-schema via npm si besoin
```

### API

- `GET /api/backend/api/categories?q=avo` — autocomplétion d'activités.
- `GET /api/backend/api/search?city=...&categories=office=lawyer,amenity=cinema&lat=...&lon=...&radius_km=5`
  — recherche des entreprises (au moins une activité requise).
- `POST /api/backend/api/enrich-emails` — récupère les emails publics d'un lot
  d'établissements (à partir de leur site web), appelé par petits lots.

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

- Export CSV / Excel des résultats
- Sélection des entreprises + création de campagnes d'emails
- Historique des campagnes + CRM simple (notes, statut, relances)
- Authentification (multi-utilisateurs, quota de recherches)
- Persistance des recherches en base (Postgres) plutôt que sessionStorage
- Pagination / cache des recherches Overpass (les grandes villes peuvent être lentes)
- Rate limiting sur `/api/search` (Overpass a ses propres limites d'usage)
- Source de données complémentaire (Google Places) branchée sur le même catalogue
