import { Company } from "./types";

export interface CategoryOption {
  key: string;
  label: string;
  group?: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/backend";

/**
 * Autocomplétion universelle des activités.
 * `q` est le texte tapé par l'utilisateur ("avo", "cine", "boîte de prod"...).
 * Renvoie des libellés français ; les tags OpenStreetMap ne sont jamais exposés.
 */
export async function searchCategories(
  q: string,
  limit = 12,
  signal?: AbortSignal
): Promise<CategoryOption[]> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_BASE}/api/categories?${params.toString()}`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`Erreur ${res.status}`);
  }
  return res.json();
}

/**
 * Recherche les entreprises pour les activités sélectionnées autour d'un point.
 * `categories` : clés d'activités renvoyées par searchCategories (obligatoire).
 */
export async function searchCompanies(
  city: string,
  categories: string[],
  location?: { lat: number; lon: number },
  radiusKm = 5
): Promise<Company[]> {
  const params = new URLSearchParams({
    city,
    categories: categories.join(","),
    radius_km: String(radiusKm),
  });
  if (location) {
    params.set("lat", String(location.lat));
    params.set("lon", String(location.lon));
  }
  const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Erreur inconnue" }));
    throw new Error(body.detail || `Erreur ${res.status}`);
  }

  return res.json();
}

export interface Contact {
  email: string | null;
  phone: string | null;
}

export interface FsqContact {
  email: string | null;
  phone: string | null;
  website: string | null;
}

/**
 * Complète téléphone / site web (et parfois email) via Foursquare, pour un lot
 * d'établissements identifiés par nom + position. Renvoie { id -> {email, phone, website} }.
 * Si la clé Foursquare n'est pas configurée côté serveur, renvoie des valeurs nulles.
 */
export async function enrichFoursquare(
  items: { id: string; name: string; lat: number | null; lon: number | null }[]
): Promise<Record<string, FsqContact>> {
  const candidates = items.filter((i) => i.lat != null && i.lon != null && i.name);
  if (candidates.length === 0) return {};
  const res = await fetch(`${API_BASE}/api/enrich-foursquare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candidates),
  });
  if (!res.ok) {
    throw new Error(`Erreur ${res.status}`);
  }
  const data: { contacts: Record<string, FsqContact> } = await res.json();
  return data.contacts;
}

/**
 * Récupère email + téléphone publics pour un lot d'établissements (via leur
 * site web : page d'accueil + pages Contact / Mentions légales).
 * Renvoie un dictionnaire { id -> { email, phone } }.
 */
export async function enrichContacts(
  items: { id: string; website: string | null }[]
): Promise<Record<string, Contact>> {
  const candidates = items.filter((i) => i.website);
  if (candidates.length === 0) return {};
  const res = await fetch(`${API_BASE}/api/enrich-contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candidates),
  });
  if (!res.ok) {
    throw new Error(`Erreur ${res.status}`);
  }
  const data: { contacts: Record<string, Contact> } = await res.json();
  return data.contacts;
}
