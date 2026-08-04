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
  radiusKm = 5,
  wholeArea = false
): Promise<Company[]> {
  const params = new URLSearchParams({
    city,
    categories: categories.join(","),
    radius_km: String(radiusKm),
  });
  if (wholeArea) {
    params.set("whole_area", "true");
  }
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
 * Enregistre les résultats dans la base centrale (collecte automatique).
 * Best-effort : n'interrompt jamais l'utilisateur et ignore les erreurs.
 * Sans effet si Supabase n'est pas configuré côté serveur.
 */
export async function collectResults(companies: Company[]): Promise<void> {
  if (companies.length === 0) return;
  try {
    await fetch(`${API_BASE}/api/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        companies.map((c) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          phone: c.phone,
          email: c.email,
          website: c.website,
          street: c.street,
          postcode: c.postcode,
          city: c.city,
          lat: c.lat,
          lon: c.lon,
        }))
      ),
    });
  } catch {
    /* collecte best-effort */
  }
}

export interface AdminRow {
  dedup_key: string;
  name: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  postcode: string | null;
  source: string | null;
  first_seen: string | null;
  last_seen: string | null;
}

/** Page admin : liste des établissements collectés (protégée par token). */
export async function fetchEstablishments(
  token: string,
  opts: { limit?: number; offset?: number; search?: string } = {}
): Promise<{ total: number; rows: AdminRow[] }> {
  const params = new URLSearchParams({
    token,
    limit: String(opts.limit ?? 200),
    offset: String(opts.offset ?? 0),
  });
  if (opts.search) params.set("search", opts.search);
  const res = await fetch(`${API_BASE}/api/admin/establishments?${params.toString()}`);
  if (res.status === 401) throw new Error("Mot de passe incorrect.");
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

/** URL de téléchargement CSV de toute la base (protégée par token). */
export function adminExportCsvUrl(token: string): string {
  return `${API_BASE}/api/admin/export?token=${encodeURIComponent(token)}`;
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
