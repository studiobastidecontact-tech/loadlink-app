"use client";

import { useState } from "react";

interface SearchCardProps {
  onSearch: (city: string, scrapeEmails: boolean) => void;
  loading: boolean;
}

export default function SearchCard({ onSearch, loading }: SearchCardProps) {
  const [city, setCity] = useState("");
  const [scrapeEmails, setScrapeEmails] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim()) return;
    onSearch(city.trim(), scrapeEmails);
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
          disabled={loading}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? "Recherche..." : "Rechercher"}
        </button>
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
