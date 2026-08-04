"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import Header from "../components/Header";
import { fetchEstablishments, adminExportCsvUrl, AdminRow } from "../lib/api";

const TOKEN_KEY = "loadlink:admin-token";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      load(saved, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(tok: string, q: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEstablishments(tok, { limit: 500, search: q });
      setRows(data.rows);
      setTotal(data.total);
      setAuthed(true);
      sessionStorage.setItem(TOKEN_KEY, tok);
    } catch (err) {
      setAuthed(false);
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    const data = rows.map((r) => ({
      Nom: r.name ?? "",
      Catégorie: r.category ?? "",
      Téléphone: r.phone ?? "",
      Email: r.email ?? "",
      "Site web": r.website ?? "",
      "Code postal": r.postcode ?? "",
      Ville: r.city ?? "",
      Source: r.source ?? "",
      "Vu le": r.last_seen ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Base LoadLink");
    XLSX.writeFile(wb, "loadlink-base.xlsx");
  }

  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-xl font-semibold">Base collectée</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tous les établissements trouvés par les recherches, enregistrés automatiquement.
        </p>

        {!authed ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              load(token, "");
            }}
            className="mt-6 max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-soft"
          >
            <label className="text-sm font-medium text-slate-700">Mot de passe admin</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="ADMIN_TOKEN"
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || !token}
              className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-400 disabled:opacity-50"
            >
              {loading ? "Chargement…" : "Accéder"}
            </button>
          </form>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  load(token, search);
                }}
                className="flex gap-2"
              >
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrer (nom, ville, catégorie)"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                  Filtrer
                </button>
              </form>
              <span className="text-sm text-slate-500">
                {total} fiche(s) au total · {rows.length} affichée(s)
              </span>
              <div className="ml-auto flex gap-2">
                <a
                  href={adminExportCsvUrl(token)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  Export CSV (tout)
                </a>
                <button
                  onClick={exportExcel}
                  className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-400"
                >
                  Export Excel
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-soft">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Nom</th>
                    <th className="px-4 py-2">Catégorie</th>
                    <th className="px-4 py-2">Ville</th>
                    <th className="px-4 py-2">Téléphone</th>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Site</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.dedup_key} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{r.name}</td>
                      <td className="px-4 py-2">{r.category ?? "—"}</td>
                      <td className="px-4 py-2">{r.city ?? "—"}</td>
                      <td className="px-4 py-2">{r.phone ?? "—"}</td>
                      <td className="px-4 py-2">{r.email ?? "—"}</td>
                      <td className="px-4 py-2">
                        {r.website ? (
                          <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-ink hover:underline">
                            Voir
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                        Aucune fiche collectée pour l'instant.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
