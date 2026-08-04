"use client";

import { useState } from "react";
import { CategoryOption } from "../lib/api";
import { Company } from "../lib/types";
import CategoryAutocomplete from "./CategoryAutocomplete";
import LocationSelector, { SelectedZone } from "./LocationSelector";

interface SearchCardProps {
  onSearch: (
    zone: SelectedZone,
    categories: string[],
    radiusKm: number,
    scrapeEmails: boolean
  ) => void;
  loading: boolean;
  companies?: Company[];
}

const RADIUS_OPTIONS = [3, 5, 10, 20];

export default function SearchCard({ onSearch, loading, companies = [] }: SearchCardProps) {
  const [zone, setZone] = useState<SelectedZone | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [scrapeEmails, setScrapeEmails] = useState(false);
  const [activities, setActivities] = useState<CategoryOption[]>([]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!zone || activities.length === 0) return;
    onSearch(
      zone,
      activities.map((a) => a.key),
      radiusKm,
      scrapeEmails
    );
  }

  const canSearch = !!zone && activities.length > 0 && !loading;

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:p-6">
      <label className="text-sm font-medium text-slate-700">Que recherchez-vous ?</label>
      <div className="mt-2">
        <CategoryAutocomplete selected={activities} onChange={setActivities} />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Tapez une activité (avocat, cinéma, boîte de production, garagiste…). Vous pouvez en ajouter plusieurs.
      </p>

      <label className="mt-5 block text-sm font-medium text-slate-700">Zone à prospecter</label>
      <div className="mt-2">
        <LocationSelector onSelect={setZone} companies={companies} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600">Rayon (ville) :</label>
        <select
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          disabled={zone?.wholeArea}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
        >
          {RADIUS_OPTIONS.map((km) => (
            <option key={km} value={km}>
              {km} km
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!canSearch}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-400 disabled:opacity-50"
        >
          {loading ? "Recherche..." : "Rechercher"}
        </button>
      </div>

      {!zone && (
        <p className="mt-2 text-xs text-slate-400">
          Choisissez au moins une région et un département (la ville est facultative).
        </p>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={scrapeEmails}
          onChange={(e) => setScrapeEmails(e.target.checked)}
          className="rounded border-slate-300"
        />
        Chercher aussi les emails sur les sites web (plus lent)
      </label>
    </form>
  );
}
