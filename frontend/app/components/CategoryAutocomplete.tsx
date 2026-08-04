"use client";

import { useEffect, useRef, useState } from "react";
import { searchCategories, CategoryOption } from "../lib/api";

interface CategoryAutocompleteProps {
  /** Activités déjà sélectionnées (chips). */
  selected: CategoryOption[];
  onChange: (next: CategoryOption[]) => void;
}

/**
 * Champ de recherche universel « Que recherchez-vous ? ».
 * L'utilisateur tape une activité en langage naturel (avocat, cinéma,
 * boîte de production...) et choisit dans les suggestions. Plusieurs
 * activités peuvent être ajoutées. Les tags OpenStreetMap restent invisibles.
 */
export default function CategoryAutocomplete({
  selected,
  onChange,
}: CategoryAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CategoryOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const selectedKeys = new Set(selected.map((s) => s.key));

  // Autocomplétion avec debounce + annulation des requêtes obsolètes.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchCategories(q, 12, controller.signal)
        .then((opts) => {
          setOptions(opts);
          setHighlight(0);
          setError(null);
        })
        .catch((err) => {
          if (err?.name !== "AbortError") setError("Recherche d'activités indisponible.");
        })
        .finally(() => setLoading(false));
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Ferme le menu au clic à l'extérieur.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function addOption(opt: CategoryOption) {
    if (!selectedKeys.has(opt.key)) {
      onChange([...selected, opt]);
    }
    setQuery("");
    setOptions([]);
    setOpen(false);
  }

  function removeOption(key: string) {
    onChange(selected.filter((s) => s.key !== key));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const visible = options.filter((o) => !selectedKeys.has(o.key));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(visible.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[highlight]) addOption(visible[highlight]);
    } else if (e.key === "Backspace" && !query && selected.length > 0) {
      removeOption(selected[selected.length - 1].key);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const visibleOptions = options.filter((o) => !selectedKeys.has(o.key));

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 px-2 py-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        {selected.map((s) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2.5 py-1 text-xs font-medium text-ink"
          >
            {s.label}
            <button
              type="button"
              onClick={() => removeOption(s.key)}
              className="text-ink/60 hover:text-ink"
              aria-label={`Retirer ${s.label}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? "Que recherchez-vous ? (ex : avocat, cinéma, garagiste…)" : "Ajouter une activité…"}
          className="min-w-[8rem] flex-1 border-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading && (
            <p className="px-3 py-2 text-xs text-slate-400">Recherche…</p>
          )}
          {!loading && error && (
            <p className="px-3 py-2 text-xs text-red-600">{error}</p>
          )}
          {!loading && !error && visibleOptions.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">
              Aucune activité trouvée pour « {query.trim()} ».
            </p>
          )}
          {!loading &&
            visibleOptions.map((opt, i) => (
              <button
                key={opt.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addOption(opt)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  i === highlight ? "bg-accent/20 text-ink" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>{opt.label}</span>
                {opt.group && (
                  <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
                    {opt.group}
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
