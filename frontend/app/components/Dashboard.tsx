"use client";

import { useEffect, useMemo, useState } from "react";
import SearchCard from "./SearchCard";
import ResultsTable from "./ResultsTable";
import StatsCard from "./StatsCard";
import { Company } from "../lib/types";
import { searchCompanies, enrichContacts, enrichFoursquare } from "../lib/api";
import { SelectedLocation } from "./LocationSelector";

const ENRICH_BATCH_SIZE = 40;

export default function Dashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restaure les derniers résultats au montage (ex. retour depuis « Campagnes »),
  // pour ne pas perdre la recherche en cours en changeant de page.
  useEffect(() => {
    const raw = sessionStorage.getItem("loadlink:companies");
    if (raw) {
      try {
        const saved: Company[] = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0) setCompanies(saved);
      } catch {
        /* ignore */
      }
    }
  }, []);

  function persist(list: Company[]) {
    setCompanies(list);
    sessionStorage.setItem("loadlink:companies", JSON.stringify(list));
  }

  async function runEnrichment(list: Company[]) {
    setEnriching(true);
    // Copie de travail indexée pour appliquer les infos au fur et à mesure.
    const byId = new Map(list.map((c) => [c.id, { ...c }]));
    try {
      // Étape 1 — Foursquare : complète téléphone / site (parfois email) pour
      // les établissements à qui il manque un téléphone OU un site.
      const needFsq = list.filter((c) => !c.phone || !c.website);
      for (let i = 0; i < needFsq.length; i += ENRICH_BATCH_SIZE) {
        const batch = needFsq.slice(i, i + ENRICH_BATCH_SIZE);
        const fsq = await enrichFoursquare(
          batch.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon }))
        );
        for (const [id, contact] of Object.entries(fsq)) {
          const item = byId.get(id);
          if (!item) continue;
          if (!item.phone && contact.phone) item.phone = contact.phone;
          if (!item.website && contact.website) item.website = contact.website;
          if (!item.email && contact.email) item.email = contact.email;
        }
        persist(Array.from(byId.values()));
      }

      // Étape 2 — Scraper : sur les sites web (y compris ceux trouvés via
      // Foursquare), va chercher l'email/téléphone manquant.
      const current = Array.from(byId.values());
      const pending = current.filter((c) => c.website && (!c.email || !c.phone));
      for (let i = 0; i < pending.length; i += ENRICH_BATCH_SIZE) {
        const batch = pending.slice(i, i + ENRICH_BATCH_SIZE);
        const contacts = await enrichContacts(
          batch.map((c) => ({ id: c.id, website: c.website }))
        );
        for (const [id, contact] of Object.entries(contacts)) {
          const item = byId.get(id);
          if (!item) continue;
          // On ne remplit que les champs vides : ne jamais écraser une donnée existante.
          if (!item.email && contact.email) item.email = contact.email;
          if (!item.phone && contact.phone) item.phone = contact.phone;
        }
        persist(Array.from(byId.values()));
      }
    } catch {
      // L'enrichissement est best-effort : on garde les résultats déjà trouvés.
    } finally {
      setEnriching(false);
    }
  }

  async function handleSearch(
    location: SelectedLocation,
    categories: string[],
    radiusKm: number,
    scrapeEmails: boolean
  ) {
    setLoading(true);
    setError(null);
    try {
      const results = await searchCompanies(
        location.nom,
        categories,
        { lat: location.lat, lon: location.lon },
        radiusKm
      );
      persist(results);
      if (scrapeEmails) {
        // Ne bloque pas l'affichage des résultats : l'enrichissement se fait ensuite.
        runEnrichment(results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    const withEmail = companies.filter((c) => c.email).length;
    const withPhone = companies.filter((c) => c.phone).length;
    return {
      total: companies.length,
      withEmail,
      withPhone,
    };
  }, [companies]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <SearchCard onSearch={handleSearch} loading={loading} />

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {enriching && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Recherche des emails et téléphones en cours…
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatsCard label="Établissements trouvés" value={stats.total} />
        <StatsCard label="Avec email" value={stats.withEmail} />
        <StatsCard label="Avec téléphone" value={stats.withPhone} />
      </div>

      <ResultsTable companies={companies} />
    </div>
  );
}
