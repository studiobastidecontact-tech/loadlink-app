"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRegions, fetchDepartements, fetchCommunes, Region, Departement, Commune } from "../lib/geo";
import { Company } from "../lib/types";
import FranceMap from "./FranceMap";

/** Zone à prospecter : soit une ville (point + rayon), soit un département entier. */
export interface SelectedZone {
  nom: string;
  place: string; // à géocoder côté serveur si pas de lat/lon
  lat: number | null;
  lon: number | null;
  wholeArea: boolean; // true = tout le département
}

interface LocationSelectorProps {
  onSelect: (zone: SelectedZone | null) => void;
  /** Résultats à afficher sur la carte (points). */
  companies?: Company[];
}

export default function LocationSelector({ onSelect, companies = [] }: LocationSelectorProps) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [departements, setDepartements] = useState<Departement[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);

  const [regionCode, setRegionCode] = useState("");
  const [departementCode, setDepartementCode] = useState("");
  const [communeCode, setCommuneCode] = useState("");

  const [error, setError] = useState<string | null>(null);

  const departementCodes = useMemo(() => departements.map((d) => d.code), [departements]);

  useEffect(() => {
    fetchRegions()
      .then(setRegions)
      .catch(() => setError("Impossible de charger les régions."));
  }, []);

  // Chargement en cascade (les émissions de zone sont gérées plus bas).
  useEffect(() => {
    setDepartements([]);
    setDepartementCode("");
    setCommunes([]);
    setCommuneCode("");
    if (!regionCode) return;
    fetchDepartements(regionCode)
      .then(setDepartements)
      .catch(() => setError("Impossible de charger les départements."));
  }, [regionCode]);

  useEffect(() => {
    setCommunes([]);
    setCommuneCode("");
    if (!departementCode) return;
    fetchCommunes(departementCode)
      .then(setCommunes)
      .catch(() => setError("Impossible de charger les communes."));
  }, [departementCode]);

  // Source unique de la zone sélectionnée : ville si choisie, sinon département entier.
  useEffect(() => {
    if (communeCode) {
      const c = communes.find((x) => x.code === communeCode);
      if (c) {
        onSelect({ nom: c.nom, place: c.nom, lat: c.lat, lon: c.lon, wholeArea: false });
        return;
      }
    }
    if (departementCode) {
      const d = departements.find((x) => x.code === departementCode);
      if (d) {
        onSelect({ nom: d.nom, place: `${d.nom}, France`, lat: null, lon: null, wholeArea: true });
        return;
      }
    }
    onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionCode, departementCode, communeCode, communes, departements]);

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";

  return (
    <div>
      {/* Carte unique : choix de la zone + points des résultats */}
      <div className="mb-3">
        <FranceMap
          regionCode={regionCode}
          departementCode={departementCode}
          departementCodes={departementCodes}
          onSelectRegion={setRegionCode}
          onSelectDepartement={setDepartementCode}
          companies={companies}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select value={regionCode} onChange={(e) => setRegionCode(e.target.value)} className={inputCls}>
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
          className={inputCls}
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
          className={inputCls}
        >
          <option value="">Ville (facultatif)</option>
          {communes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.nom}
            </option>
          ))}
        </select>
      </div>

      {departementCode && !communeCode && (
        <p className="mt-2 text-xs text-slate-500">
          Ville vide = <strong>tout le département {departements.find((d) => d.code === departementCode)?.nom}</strong> sera prospecté (plus long).
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
