/**
 * Chargement des contours géographiques (régions / départements) pour la
 * carte de France. Source : projet open-source france-geojson, servi via le
 * CDN jsDelivr (CORS OK, mise en cache). Versions "simplifiées" (plus légères).
 *
 * Les fichiers sont chargés une seule fois puis gardés en mémoire.
 */

const REGIONS_URL =
  "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson@master/regions-version-simplifiee.geojson";
const DEPARTEMENTS_URL =
  "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson@master/departements-version-simplifiee.geojson";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoJSON = any;

let regionsCache: GeoJSON | null = null;
let deptsCache: GeoJSON | null = null;

export async function loadRegionsGeoJSON(): Promise<GeoJSON> {
  if (regionsCache) return regionsCache;
  const res = await fetch(REGIONS_URL);
  if (!res.ok) throw new Error("Impossible de charger les contours des régions.");
  regionsCache = await res.json();
  return regionsCache;
}

export async function loadDepartementsGeoJSON(): Promise<GeoJSON> {
  if (deptsCache) return deptsCache;
  const res = await fetch(DEPARTEMENTS_URL);
  if (!res.ok) throw new Error("Impossible de charger les contours des départements.");
  deptsCache = await res.json();
  return deptsCache;
}
