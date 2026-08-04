"use client";

import { useEffect, useState } from "react";
import { fetchRegions, fetchDepartements, fetchCommunes, Region, Departement, Commune } from "../lib/geo";

export interface SelectedLocation {
  nom: string;
  lat: number;
  lon: number;
}

interface LocationSelectorProps {
  onSelect: (location: SelectedLocation | null) => void;
}

export default function LocationSelector({ onSelect }: LocationSelectorProps) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [departements, setDepartements] = useState<Departement[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);

  const [regionCode, setRegionCode] = useState("");
  const [departementCode, setDepartementCode] = useState("");
  const [communeCode, setCommuneCode] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRegions()
      .then(setRegions)
      .catch(() => setError("Impossible de charger les régions."));
  }, []);

  useEffect(() => {
    setDepartements([]);
    setDepartementCode("");
    setCommunes([]);
    setCommuneCode("");
    onSelect(null);
    if (!regionCode) return;
    fetchDepartements(regionCode)
      .then(setDepartements)
      .catch(() => setError("Impossible de charger les départements."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionCode]);

  useEffect(() => {
    setCommunes([]);
    setCommuneCode("");
    onSelect(null);
    if (!departementCode) return;
    fetchCommunes(departementCode)
      .then(setCommunes)
      .catch(() => setError("Impossible de charger les communes."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departementCode]);

  useEffect(() => {
    if (!communeCode) return;
    const commune = communes.find((c) => c.code === communeCode);
    if (commune) {
      onSelect({ nom: commune.nom, lat: commune.lat, lon: commune.lon });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communeCode]);

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={regionCode}
          onChange={(e) => setRegionCode(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        >
          <option value="">Région</option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.nom}
            </option>
          ))}
        </select>

        <select
          value={departementCode}
          onChange={(e) => setDepartementCode(e.target.value)}
          disabled={!regionCode}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
        >
          <option value="">Département</option>
          {departements.map((d) => (
            <option key={d.code} value={d.code}>
              {d.nom}
            </option>
          ))}
        </select>

        <select
          value={communeCode}
          onChange={(e) => setCommuneCode(e.target.value)}
          disabled={!departementCode}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
        >
          <option value="">Ville</option>
          {communes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.nom}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
