"use client";

import { useState } from "react";
import Link from "next/link";
import { Company } from "../lib/types";
import {
  CrmStatus,
  STATUSES,
  statusBadgeClass,
  useCrmEntry,
  setEntry,
} from "../lib/crm";
import { exportCsv, exportXlsx } from "../lib/export";
import CampaignModal from "./CampaignModal";

interface ResultsTableProps {
  companies: Company[];
}

function mapsUrl(c: Company): string {
  if (c.lat != null && c.lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${c.name} ${c.city ?? ""}`
  )}`;
}

function searchUrl(c: Company): string {
  return `https://www.google.com/search?q=${encodeURIComponent(
    `${c.name} ${c.city ?? ""}`
  )}`;
}

function StatusSelect({ id }: { id: string }) {
  const entry = useCrmEntry(id);
  return (
    <select
      value={entry.status}
      onChange={(e) => setEntry(id, { status: e.target.value as CrmStatus })}
      className={`rounded-full border-none px-2 py-1 text-xs font-medium ${statusBadgeClass(
        entry.status
      )}`}
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export default function ResultsTable({ companies }: ResultsTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCampaign, setShowCampaign] = useState(false);

  if (companies.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        Aucun résultat pour l'instant. Lancez une recherche pour voir apparaître vos prospects ici.
      </p>
    );
  }

  const allSelected = selected.size === companies.length;
  const selectedCompanies = companies.filter((c) => selected.has(c.id));
  const exportTargets = selected.size > 0 ? selectedCompanies : companies;
  const campaignRecipients = selectedCompanies.filter((c) => c.email);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(companies.map((c) => c.id)));
  }

  return (
    <div id="results" className="rounded-2xl border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-500">
          {companies.length} établissement(s)
          {selected.size > 0 && ` · ${selected.size} sélectionné(s)`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => setShowCampaign(true)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink hover:bg-accent-400"
            >
              Créer une campagne ({campaignRecipients.length})
            </button>
          )}
          <button
            onClick={() => exportCsv(exportTargets)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Export CSV{selected.size > 0 ? " (sélection)" : ""}
          </button>
          <button
            onClick={() => exportXlsx(exportTargets)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Export Excel{selected.size > 0 ? " (sélection)" : ""}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Tout sélectionner"
                  className="rounded border-slate-300"
                />
              </th>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Catégorie</th>
              <th className="px-4 py-2">Ville</th>
              <th className="px-4 py-2">Téléphone</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`Sélectionner ${c.name}`}
                    className="rounded border-slate-300"
                  />
                </td>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/companies/${c.id}`} className="hover:text-ink hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.category}</td>
                <td className="px-4 py-2">{c.city ?? "—"}</td>
                <td className="px-4 py-2">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="hover:text-ink hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="hover:text-ink hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  <StatusSelect id={c.id} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    {c.website && (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink hover:underline"
                      >
                        Site
                      </a>
                    )}
                    <a
                      href={mapsUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-ink hover:underline"
                    >
                      Maps
                    </a>
                    <a
                      href={searchUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-ink hover:underline"
                    >
                      Rechercher
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCampaign && (
        <CampaignModal
          recipients={campaignRecipients}
          onClose={() => setShowCampaign(false)}
        />
      )}
    </div>
  );
}
