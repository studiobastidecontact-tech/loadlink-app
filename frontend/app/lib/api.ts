import { Company } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function searchCompanies(
  city: string,
  scrapeEmails = false
): Promise<Company[]> {
  const params = new URLSearchParams({ city, scrape_emails: String(scrapeEmails) });
  const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Erreur inconnue" }));
    throw new Error(body.detail || `Erreur ${res.status}`);
  }

  return res.json();
}
