"use client";

import { useState } from "react";
import { CategoryOption } from "../lib/api";
import CategoryAutocomplete from "./CategoryAutocomplete";
import LocationSelector, { SelectedLocation } from "./LocationSelector";

interface SearchCardProps {
  onSearch: (
    location: SelectedLocation,
    categories: string[],
    radiusKm: number,
    scrapeEmails: boolean
  ) => void;
  loading: boolean;
}

const RADIUS_OPTIONS = [3, 5, 10, 20];

export default function SearchCard({ onSearch, loading }: SearchCardProps) {
  const [location, setLocation] = useState<SelectedLocation | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [scrapeEmails, setScrapeEmails] = useState(false);
  const [activities, setActivities] = useState<CategoryOption[]>([]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location || activities.length === 0) return;
    onSearch(
      location,
      activities.map((a) => a.key),
      radiusKm,
      scrapeEmails
    );
  }

  const canSearch = !!location && activities.length > 0 && !loading;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <label className="text-sm font-medium text-slate-700">
        Que recherchez-vous ?
      </label>
      <div className="mt-2">
        <CategoryAutocomplete selected={activities} onChange={setActivities} />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Tapez une activité (avocat, cinéma, boîte de production, garagiste…). Vous pouvez en ajouter plusieurs.
      </p>

      <label className="mt-5 block text-sm font-medium text-slate-700">
        Zone à prospecter
      </label>
      <div className="mt-2">
        <LocationSelector onSelect={setLocation} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600">Rayon de recherche :</label>
        <select
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
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
          className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? "Recherche..." : "Rechercher"}
        </button>
      </div>

      {!location && (
        <p className="mt-2 text-xs text-slate-400">
          Choisissez une région, un département et une ville pour lancer la recherche.
        </p>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={scrapeEmails}
          onChange={(e) => setScrapeEmails(e.target.checked)}
          className="rounded border-slate-300"
        />
        Tenter de récupérer les emails depuis les sites web (plus lent)
      </label>
    </form>
  );
}
