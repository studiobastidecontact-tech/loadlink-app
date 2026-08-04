"use client";

import { useMemo, useState } from "react";
import { Company } from "../lib/types";
import { saveCampaign } from "../lib/campaigns";

interface CampaignModalProps {
  /** Entreprises retenues (toutes doivent avoir un email). */
  recipients: Company[];
  onClose: () => void;
}

const DEFAULT_SUBJECT = "Proposition de collaboration";
const DEFAULT_BODY = `Bonjour {{nom}},

Je me permets de vous contacter au sujet de votre établissement à {{ville}}.

[Votre message ici]

Bien cordialement,
`;

function fill(template: string, c: Company): string {
  return template
    .replaceAll("{{nom}}", c.name ?? "")
    .replaceAll("{{ville}}", c.city ?? "");
}

export default function CampaignModal({ recipients, onClose }: CampaignModalProps) {
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const emails = useMemo(
    () => recipients.map((r) => r.email!).filter(Boolean),
    [recipients]
  );
  const preview = recipients[0];

  function openDraft(c: Company) {
    const url = `mailto:${encodeURIComponent(c.email!)}?subject=${encodeURIComponent(
      fill(subject, c)
    )}&body=${encodeURIComponent(fill(body, c))}`;
    window.location.href = url;
  }

  function openBulkBcc() {
    // Un seul brouillon en copie cachée (sans personnalisation).
    const url = `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  function handleSave() {
    saveCampaign({
      subject,
      body,
      recipients: recipients.map((r) => ({ id: r.id, name: r.name, email: r.email! })),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">
            Nouvelle campagne · {recipients.length} destinataire(s)
          </h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 text-xl text-slate-400 hover:text-slate-700"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {recipients.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucun des établissements sélectionnés n'a d'email. Sélectionne des entreprises
              avec une adresse email pour créer une campagne.
            </p>
          ) : (
            <>
              <label className="text-xs font-medium text-slate-600">Objet</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />

              <label className="mt-3 block text-xs font-medium text-slate-600">
                Message
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={9}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-slate-400">
                Variables : <code>{"{{nom}}"}</code> (nom de l'établissement),{" "}
                <code>{"{{ville}}"}</code>. Elles sont remplacées pour chaque destinataire.
              </p>

              {preview && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">
                    Aperçu pour « {preview.name} »
                  </p>
                  <p className="mt-2 text-xs font-semibold">{fill(subject, preview)}</p>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                    {fill(body, preview)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {recipients.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
            <button
              onClick={() => preview && openDraft(preview)}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-ink hover:bg-accent-400"
            >
              Ouvrir un brouillon personnalisé (1er)
            </button>
            <button
              onClick={openBulkBcc}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50"
            >
              Brouillon groupé (Cci, sans perso)
            </button>
            <button
              onClick={copyEmails}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50"
            >
              {copied ? "Adresses copiées ✓" : "Copier les adresses"}
            </button>
            <button
              onClick={handleSave}
              className="ml-auto rounded-lg border border-accent px-3 py-2 text-xs font-medium text-ink hover:bg-accent/20"
            >
              {saved ? "Enregistrée ✓" : "Enregistrer la campagne"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
