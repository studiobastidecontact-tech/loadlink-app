"use client";

import { useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { loadRegionsGeoJSON, loadDepartementsGeoJSON } from "../lib/geojson";
import { Company } from "../lib/types";

interface FranceMapProps {
  regionCode: string;
  departementCode: string;
  /** Départements de la région sélectionnée (codes), pour n'afficher que ceux-là. */
  departementCodes: string[];
  onSelectRegion: (code: string) => void;
  onSelectDepartement: (code: string) => void;
  /** Résultats à afficher en points (une seule carte pour zone + résultats). */
  companies?: Company[];
}

const NEUTRAL = { color: "#94a3b8", weight: 1, fillColor: "#e2e8f0", fillOpacity: 0.5 };
const SELECTED = { color: "#16160F", weight: 1.5, fillColor: "#CBF24E", fillOpacity: 0.55 };
const HOVER = { fillColor: "#CBF24E", fillOpacity: 0.4 };

/**
 * Carte unique : sert à choisir la zone (régions → départements) ET à afficher
 * les établissements trouvés (points). Se synchronise avec les menus déroulants.
 * Best-effort : si les contours ne chargent pas, les menus prennent le relais.
 */
export default function FranceMap({
  regionCode,
  departementCode,
  departementCodes,
  onSelectRegion,
  onSelectDepartement,
  companies = [],
}: FranceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const polyRef = useRef<LeafletNS.GeoJSON | null>(null);
  const pinsRef = useRef<LeafletNS.LayerGroup | null>(null);
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
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(
          mapRef.current
        );
        pinsRef.current = L.layerGroup().addTo(mapRef.current);
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

  // (Re)dessine polygones de zone + points des résultats.
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      const map = mapRef.current;

      // 1) Points des résultats
      const pins = pinsRef.current;
      let pinBounds: LeafletNS.LatLngTuple[] = [];
      if (pins) {
        pins.clearLayers();
        companies.forEach((c) => {
          if (c.lat == null || c.lon == null) return;
          const marker = L.circleMarker([c.lat, c.lon], {
            radius: 6,
            color: "#16160F",
            weight: 1,
            fillColor: "#CBF24E",
            fillOpacity: 0.9,
          });
          const lines = [
            `<strong>${c.name ?? ""}</strong>`,
            c.category ?? "",
            c.phone ? `📞 ${c.phone}` : "",
            c.email ? `✉️ ${c.email}` : "",
          ].filter(Boolean);
          marker.bindPopup(lines.join("<br>"));
          marker.addTo(pins);
          pinBounds.push([c.lat, c.lon]);
        });
      }

      // 2) Polygones de zone (seulement si contours chargés)
      if (polyRef.current) {
        map.removeLayer(polyRef.current);
        polyRef.current = null;
      }
      if (ready) {
        if (!regionCode) {
          polyRef.current = L.geoJSON(regionsRef.current, {
            style: () => NEUTRAL,
            onEachFeature: (feature, layer) => {
              const code = String(feature.properties?.code ?? "");
              layer.bindTooltip(feature.properties?.nom ?? "", { sticky: true });
              layer.on({
                click: () => onSelectRegion(code),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                mouseover: (e: any) => e.target.setStyle(HOVER),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                mouseout: (e: any) => e.target.setStyle(NEUTRAL),
              });
            },
          }).addTo(map);
        } else {
          const codes = new Set(departementCodes);
          const feats = (deptsRef.current?.features ?? []).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (f: any) => codes.has(String(f.properties?.code ?? ""))
          );
          polyRef.current = L.geoJSON({ type: "FeatureCollection", features: feats } as never, {
            style: (feature) =>
              String(feature?.properties?.code ?? "") === departementCode ? SELECTED : NEUTRAL,
            onEachFeature: (feature, layer) => {
              const code = String(feature.properties?.code ?? "");
              layer.bindTooltip(feature.properties?.nom ?? "", { sticky: true });
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
          }).addTo(map);
        }
      }

      // 3) Cadrage : priorité aux résultats, sinon à la zone.
      try {
        if (pinBounds.length > 0) {
          map.fitBounds(L.latLngBounds(pinBounds), { padding: [25, 25], maxZoom: 15 });
        } else if (polyRef.current) {
          map.fitBounds(polyRef.current.getBounds(), { padding: [10, 10] });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, regionCode, departementCode, departementCodes, companies, onSelectRegion, onSelectDepartement]);

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
        className="h-72 w-full overflow-hidden rounded-2xl border border-slate-200 sm:h-80"
        style={{ zIndex: 0 }}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>
          {companies.length > 0
            ? `${companies.filter((c) => c.lat != null).length} résultat(s) sur la carte`
            : !regionCode
            ? "Cliquez une région sur la carte"
            : !departementCode
            ? "Cliquez un département"
            : "Zone choisie"}
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
