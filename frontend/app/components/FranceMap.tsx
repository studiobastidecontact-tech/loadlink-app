"use client";

import { useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { loadRegionsGeoJSON, loadDepartementsGeoJSON } from "../lib/geojson";

interface FranceMapProps {
  regionCode: string;
  departementCode: string;
  /** Départements de la région sélectionnée (codes), pour n'afficher que ceux-là. */
  departementCodes: string[];
  onSelectRegion: (code: string) => void;
  onSelectDepartement: (code: string) => void;
}

const NEUTRAL = { color: "#94a3b8", weight: 1, fillColor: "#e2e8f0", fillOpacity: 0.5 };
const SELECTED = { color: "#16160F", weight: 1.5, fillColor: "#CBF24E", fillOpacity: 0.75 };
const HOVER = { fillColor: "#CBF24E", fillOpacity: 0.4 };

/**
 * Carte de France cliquable : on clique une région (puis un département) pour
 * choisir sa zone. Se synchronise avec les menus déroulants du LocationSelector.
 * Best-effort : si les contours ne chargent pas, la carte reste vide et les
 * menus déroulants prennent le relais.
 */
export default function FranceMap({
  regionCode,
  departementCode,
  departementCodes,
  onSelectRegion,
  onSelectDepartement,
}: FranceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.GeoJSON | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regionsRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deptsRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Init carte + chargement des contours (une fois).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          scrollWheelZoom: false,
          attributionControl: false,
        }).setView([46.6, 2.4], 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(mapRef.current);
      }
      try {
        regionsRef.current = await loadRegionsGeoJSON();
        deptsRef.current = await loadDepartementsGeoJSON();
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError("Contours indisponibles — utilisez les menus ci-dessous.");
      }
      setTimeout(() => mapRef.current?.invalidateSize(), 150);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)dessine les polygones selon la sélection.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      const map = mapRef.current;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }

      if (!regionCode) {
        // Vue régions
        layerRef.current = L.geoJSON(regionsRef.current, {
          style: () => NEUTRAL,
          onEachFeature: (feature, layer) => {
            const code = String(feature.properties?.code ?? "");
            const nom = feature.properties?.nom ?? "";
            layer.bindTooltip(nom, { sticky: true });
            layer.on({
              click: () => onSelectRegion(code),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              mouseover: (e: any) => e.target.setStyle(HOVER),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              mouseout: (e: any) => e.target.setStyle(NEUTRAL),
            });
          },
        }).addTo(map);
        try {
          map.fitBounds(layerRef.current.getBounds(), { padding: [10, 10] });
        } catch {
          /* ignore */
        }
      } else {
        // Vue départements de la région sélectionnée
        const codes = new Set(departementCodes);
        const feats = (deptsRef.current?.features ?? []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (f: any) => codes.has(String(f.properties?.code ?? ""))
        );
        layerRef.current = L.geoJSON(
          { type: "FeatureCollection", features: feats } as never,
          {
            style: (feature) =>
              String(feature?.properties?.code ?? "") === departementCode ? SELECTED : NEUTRAL,
            onEachFeature: (feature, layer) => {
              const code = String(feature.properties?.code ?? "");
              const nom = feature.properties?.nom ?? "";
              layer.bindTooltip(nom, { sticky: true });
              layer.on({
                click: () => onSelectDepartement(code),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                mouseover: (e: any) => {
                  if (code !== departementCode) e.target.setStyle(HOVER);
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                mouseout: (e: any) => {
                  if (code !== departementCode) e.target.setStyle(NEUTRAL);
                },
              });
            },
          }
        ).addTo(map);
        try {
          map.fitBounds(layerRef.current.getBounds(), { padding: [15, 15] });
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, regionCode, departementCode, departementCodes, onSelectRegion, onSelectDepartement]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-2xl border border-slate-200"
        style={{ zIndex: 0 }}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>
          {!regionCode
            ? "Cliquez une région sur la carte"
            : !departementCode
            ? "Cliquez un département"
            : "Zone choisie — sélectionnez la ville ci-dessous"}
        </span>
        {regionCode && (
          <button
            type="button"
            onClick={() => onSelectRegion("")}
            className="font-medium text-ink hover:underline"
          >
            ↺ Revoir la France
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-amber-600">{error}</p>}
    </div>
  );
}
