"use client";

import { useMemo, useState } from "react";
import SearchCard from "./SearchCard";
import ResultsTable from "./ResultsTable";
import StatsCard from "./StatsCard";
import { Company } from "../lib/types";
import { searchCompanies } from "../lib/api";
import { SelectedLocation } from "./LocationSelector";

export default function Dashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(
    location: SelectedLocation,
    scrapeEmails: boolean,
    categories: string[],
    radiusKm: number
  ) {
    setLoading(true);
    setError(null);
    try {
      const results = await searchCompanies(
        location.nom,
        scrapeEmails,
        categories,
        { lat: location.lat, lon: location.lon },
        radiusKm
      );
      setCompanies(results);
      sessionStorage.setItem("loadlink:companies", JSON.stringify(results));
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatsCard label="Établissements trouvés" value={stats.total} />
        <StatsCard label="Avec email" value={stats.withEmail} />
        <StatsCard label="Avec téléphone" value={stats.withPhone} />
      </div>

      <ResultsTable companies={companies} />
    </div>
  );
}
