"use client";

import { useEffect, useRef } from "react";
import type * as LeafletNS from "leaflet";
import { Company } from "../lib/types";

/**
 * Carte des résultats : affiche chaque établissement (ayant des coordonnées)
 * sous forme de point cliquable. Tuiles OpenStreetMap (libres, sans clé).
 * Leaflet est chargé dynamiquement côté client uniquement (il a besoin de
 * `window`), et on utilise des circleMarkers (pas d'icônes image) pour éviter
 * les soucis de chemins d'icônes avec le bundler.
 */
export default function ResultsMap({ companies }: { companies: Company[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
          [46.6, 2.5],
          5
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }

      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();

      const points: LeafletNS.LatLngTuple[] = [];
      companies.forEach((c) => {
        if (c.lat == null || c.lon == null) return;
        const marker = L.circleMarker([c.lat, c.lon], {
          radius: 7,
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
        marker.addTo(layer);
        points.push([c.lat, c.lon]);
      });

      if (points.length > 0) {
        map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
      }
      // Corrige la taille de la carte une fois affichée dans le layout.
      setTimeout(() => map.invalidateSize(), 120);
    })();

    return () => {
      cancelled = true;
    };
  }, [companies]);

  // Détruit la carte au démontage du composant.
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  const hasCoords = companies.some((c) => c.lat != null && c.lon != null);
  if (!hasCoords) return null;

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-2xl border border-slate-200 shadow-soft"
      style={{ zIndex: 0 }}
    />
  );
}
