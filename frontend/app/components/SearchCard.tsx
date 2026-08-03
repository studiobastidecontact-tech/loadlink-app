"use client";

import { useEffect, useState } from "react";
import { fetchCategories, CategoryOption } from "../lib/api";

interface SearchCardProps {
  onSearch: (city: string, scrapeEmails: boolean, categories: string[]) => void;
  loading: boolean;
}

export default function SearchCard({ onSearch, loading }: SearchCardProps) {
  const [city, setCity] = useState("");
  const [scrapeEmails, setScrapeEmails] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((cats) => {
        setCategories(cats);
        // Tout sélectionné par défaut
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
    if (!city.trim()) return;
    onSearch(city.trim(), scrapeEmails, Array.from(selected));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <label htmlFor="city" className="text-sm font-medium text-slate-700">
        Ville à prospecter
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="city"
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="ex : Brive-la-Gaillarde"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={loading || selected.size === 0}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
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
