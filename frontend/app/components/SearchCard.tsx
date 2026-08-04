"use client";

import { useEffect, useState } from "react";
import { fetchCategories, CategoryOption } from "../lib/api";
import LocationSelector, { SelectedLocation } from "./LocationSelector";

interface SearchCardProps {
  onSearch: (
    location: SelectedLocation,
    scrapeEmails: boolean,
    categories: string[],
    radiusKm: number
  ) => void;
  loading: boolean;
}

const RADIUS_OPTIONS = [3, 5, 10, 20];

export default function SearchCard({ onSearch, loading }: SearchCardProps) {
  const [location, setLocation] = useState<SelectedLocation | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [scrapeEmails, setScrapeEmails] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((cats) => {
        setCategories(cats);
        setSelected(new Set(cats.map((c) => c.key)));
      })
      .catch(() => setCategoriesError("Impossible de charger les catégories."));
  }, []);

  const allSelected = categories.length > 0 && selected.size === categories.length;

  function toggleCategory(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(categories.map((c) => c.key)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!location) return;
    onSearch(location, scrapeEmails, Array.from(selected), radiusKm);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <label className="text-sm font-medium text-slate-700">Zone à prospecter</label>
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
          disabled={loading || selected.size === 0 || !location}
          className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? "Recherche..." : "Rechercher"}
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Catégories</span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-brand hover:underline"
          >
            {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
        </div>

        {categoriesError && (
          <p className="mt-2 text-xs text-red-600">{categoriesError}</p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          {categories.map((cat) => {
            const isChecked = selected.has(cat.key);
            return (
              <label
                key={cat.key}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  isChecked
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleCategory(cat.key)}
                  className="sr-only"
                />
                {cat.label}
              </label>
            );
          })}
        </div>
        {selected.size === 0 && categories.length > 0 && (
          <p className="mt-2 text-xs text-red-600">Sélectionne au moins une catégorie.</p>
        )}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={scrapeEmails}
          onChange={(e) => setScrapeEmails(e.target.checked)}
          className="rounded border-slate-300"
        />
        Tenter de récupérer un email depuis le site web (plus lent)
      </label>
    </form>
  );
}
