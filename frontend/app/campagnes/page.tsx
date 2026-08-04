"use client";

import { useState } from "react";
import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import { useCampaigns, deleteCampaign, Campaign } from "../lib/campaigns";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 text-left"
        >
          <p className="text-sm font-medium">{campaign.subject || "(sans objet)"}</p>
          <p className="text-xs text-slate-500">
            {formatDate(campaign.date)} · {campaign.recipients.length} destinataire(s)
          </p>
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-brand hover:underline"
        >
          {open ? "Masquer" : "Détails"}
        </button>
        <button
          onClick={() => deleteCampaign(campaign.id)}
          className="text-xs font-medium text-rose-600 hover:underline"
        >
          Supprimer
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {campaign.body}
          </pre>
          <p className="mt-3 text-xs font-medium text-slate-500">Destinataires</p>
          <ul className="mt-1 max-h-48 overflow-auto text-xs text-slate-600">
            {campaign.recipients.map((r) => (
              <li key={r.id} className="flex justify-between border-b border-slate-50 py-1">
                <span>{r.name}</span>
                <span className="text-slate-400">{r.email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function CampaignsPage() {
  const campaigns = useCampaigns();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <div className="flex flex-1 flex-col gap-4 p-6">
          <h1 className="text-xl font-semibold">Historique des campagnes</h1>
          {campaigns.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Aucune campagne enregistrée. Sélectionne des entreprises dans les résultats,
              puis « Créer une campagne » pour composer ton premier message.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {campaigns.map((c) => (
                <CampaignRow key={c.id} campaign={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
