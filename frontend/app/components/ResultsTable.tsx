"use client";

import Link from "next/link";
import { Company } from "../lib/types";

interface ResultsTableProps {
  companies: Company[];
}

function exportToCsv(companies: Company[]) {
  const headers = ["name", "category", "phone", "website", "email", "street", "postcode", "city"];
  const rows = companies.map((c) =>
    headers.map((h) => `"${(c as any)[h] ?? ""}"`).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "loadlink-prospects.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultsTable({ companies }: ResultsTableProps) {
  if (companies.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        Aucun résultat pour l'instant. Lancez une recherche pour voir apparaître vos prospects ici.
      </p>
    );
  }

  return (
    <div id="results" className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-500">{companies.length} établissement(s) trouvé(s)</p>
        <button
          onClick={() => exportToCsv(companies)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
        >
          Exporter en CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Catégorie</th>
              <th className="px-4 py-2">Ville</th>
              <th className="px-4 py-2">Téléphone</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Site web</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/companies/${c.id}`} className="hover:text-brand hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.category}</td>
                <td className="px-4 py-2">{c.city ?? "—"}</td>
                <td className="px-4 py-2">{c.phone ?? "—"}</td>
                <td className="px-4 py-2">{c.email ?? "—"}</td>
                <td className="px-4 py-2">
                  {c.website ? (
                    <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                      Voir
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
