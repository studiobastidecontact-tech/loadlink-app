"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Company } from "../../lib/types";
import { STATUSES, CrmStatus, useCrmEntry, setEntry } from "../../lib/crm";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<Company | null | undefined>(undefined);
  const crm = useCrmEntry(id);
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("loadlink:companies");
    if (!raw) {
      setCompany(null);
      return;
    }
    const companies: Company[] = JSON.parse(raw);
    setCompany(companies.find((c) => c.id === id) ?? null);
  }, [id]);

  // Initialise la zone de notes depuis le CRM une fois l'entreprise chargée.
  useEffect(() => {
    setNotes(crm.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (company === undefined) {
    return <p className="p-6 text-sm text-slate-500">Chargement...</p>;
  }

  if (company === null) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">
          Établissement introuvable. Relancez une recherche depuis l'accueil.
        </p>
        <button
          onClick={() => router.push("/app")}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-accent-400"
        >
          Retour à l'accueil
        </button>
      </div>
    );
  }

  const fields: [string, string | null][] = [
    ["Catégorie", company.category],
    ["Téléphone", company.phone],
    ["Email", company.email],
    ["Site web", company.website],
    ["Adresse", company.street],
    ["Code postal", company.postcode],
    ["Ville", company.city],
  ];

  function saveNotes() {
    setEntry(id, { notes });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <button
        onClick={() => router.push("/app")}
        className="mb-4 text-sm text-slate-500 hover:text-slate-900"
      >
        ← Retour
      </button>
      <h1 className="text-2xl font-semibold">{company.name}</h1>

      <div className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-3 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="font-medium">{value ?? "—"}</span>
          </div>
        ))}
      </div>

      {/* Suivi CRM */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Suivi</h2>

        <label className="mt-3 block text-xs font-medium text-slate-500">Statut</label>
        <select
          value={crm.status}
          onChange={(e) => setEntry(id, { status: e.target.value as CrmStatus })}
          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-xs font-medium text-slate-500">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={5}
          placeholder="Compte-rendu d'appel, prochaine relance, contact identifié…"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={saveNotes}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink hover:bg-accent-400"
          >
            Enregistrer les notes
          </button>
          {notesSaved && <span className="text-xs text-emerald-600">Enregistré ✓</span>}
        </div>
      </div>
    </div>
  );
}
