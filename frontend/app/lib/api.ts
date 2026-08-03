import { Company } from "./types";

export interface CategoryOption {
  key: string;
  label: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/backend";

export async function fetchCategories(): Promise<CategoryOption[]> {
  const res = await fetch(`${API_BASE}/api/categories`);
  if (!res.ok) {
    throw new Error(`Erreur ${res.status}`);
  }
  return res.json();
}

export async function searchCompanies(
  city: string,
  scrapeEmails = false,
  categories: string[] = []
): Promise<Company[]> {
  const params = new URLSearchParams({ city, scrape_emails: String(scrapeEmails) });
  if (categories.length > 0) {
    params.set("categories", categories.join(","));
  }
  const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Erreur inconnue" }));
    throw new Error(body.detail || `Erreur ${res.status}`);
  }

  return res.json();
}
