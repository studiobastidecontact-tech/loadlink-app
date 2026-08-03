"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Company } from "../../lib/types";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<Company | null | undefined>(undefined);

  useEffect(() => {
    const raw = sessionStorage.getItem("loadlink:companies");
    if (!raw) {
      setCompany(null);
      return;
    }
    const companies: Company[] = JSON.parse(raw);
    setCompany(companies.find((c) => c.id === id) ?? null);
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
          onClick={() => router.push("/")}
          className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
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

  return (
    <div className="mx-auto max-w-2xl p-6">
      <button
        onClick={() => router.push("/")}
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
    </div>
  );
}
