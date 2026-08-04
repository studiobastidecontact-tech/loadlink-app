export interface Region {
  code: string;
  nom: string;
}

export interface Departement {
  code: string;
  nom: string;
}

export interface Commune {
  code: string;
  nom: string;
  lat: number;
  lon: number;
}

const GEO_API_BASE = "https://geo.api.gouv.fr";

export async function fetchRegions(): Promise<Region[]> {
  const res = await fetch(`${GEO_API_BASE}/regions?fields=nom,code`);
  if (!res.ok) throw new Error("Impossible de charger les régions.");
  const data: Region[] = await res.json();
  return data.sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function fetchDepartements(codeRegion: string): Promise<Departement[]> {
  const res = await fetch(`${GEO_API_BASE}/departements?codeRegion=${codeRegion}&fields=nom,code`);
  if (!res.ok) throw new Error("Impossible de charger les départements.");
  const data: Departement[] = await res.json();
  return data.sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function fetchCommunes(codeDepartement: string): Promise<Commune[]> {
  const res = await fetch(
    `${GEO_API_BASE}/communes?codeDepartement=${codeDepartement}&fields=nom,code,centre&format=json`
  );
  if (!res.ok) throw new Error("Impossible de charger les communes.");
  const raw: { code: string; nom: string; centre?: { coordinates: [number, number] } }[] = await res.json();
  return raw
    .filter((c) => c.centre)
    .map((c) => ({
      code: c.code,
      nom: c.nom,
      lon: c.centre!.coordinates[0],
      lat: c.centre!.coordinates[1],
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}
