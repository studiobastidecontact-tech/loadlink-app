"use client";

import { useSyncExternalStore } from "react";

/**
 * CRM local : statut + notes par entreprise, sauvegardés dans le navigateur
 * (localStorage). Persistant entre les sessions et les recherches, car la clé
 * est l'identifiant OSM stable de l'établissement.
 *
 * NB : c'est un stockage LOCAL (propre à ce navigateur / cette machine). Pour
 * un CRM partagé multi-appareils, on migrera vers une base côté serveur.
 */

export type CrmStatus =
  | "nouveau"
  | "a_contacter"
  | "contacte"
  | "relance"
  | "interesse"
  | "client"
  | "pas_interesse";

export interface CrmEntry {
  status: CrmStatus;
  notes: string;
  updatedAt: string;
}

export const STATUSES: { value: CrmStatus; label: string }[] = [
  { value: "nouveau", label: "Nouveau" },
  { value: "a_contacter", label: "À contacter" },
  { value: "contacte", label: "Contacté" },
  { value: "relance", label: "Relancé" },
  { value: "interesse", label: "Intéressé" },
  { value: "client", label: "Client" },
  { value: "pas_interesse", label: "Pas intéressé" },
];

// Classes Tailwind explicites (littéraux, pour ne pas être purgés par le JIT).
const BADGE_CLASSES: Record<CrmStatus, string> = {
  nouveau: "bg-slate-100 text-slate-600",
  a_contacter: "bg-blue-100 text-blue-700",
  contacte: "bg-amber-100 text-amber-700",
  relance: "bg-violet-100 text-violet-700",
  interesse: "bg-emerald-100 text-emerald-700",
  client: "bg-green-100 text-green-700",
  pas_interesse: "bg-rose-100 text-rose-700",
};

export function statusLabel(status: CrmStatus): string {
  return STATUSES.find((s) => s.value === status)?.label ?? "Nouveau";
}

export function statusBadgeClass(status: CrmStatus): string {
  return BADGE_CLASSES[status] ?? BADGE_CLASSES.nouveau;
}

const KEY = "loadlink:crm";
const DEFAULT_ENTRY: CrmEntry = { status: "nouveau", notes: "", updatedAt: "" };

type CrmData = Record<string, CrmEntry>;

let cache: CrmData | null = null;
const listeners = new Set<() => void>();

function load(): CrmData {
  if (cache) return cache;
  if (typeof window === "undefined") return {};
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

function persist(data: CrmData) {
  cache = data;
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  listeners.forEach((l) => l());
}

export function getEntry(id: string): CrmEntry {
  return load()[id] ?? DEFAULT_ENTRY;
}

export function setEntry(id: string, patch: Partial<Omit<CrmEntry, "updatedAt">>) {
  const data = { ...load() };
  const current = data[id] ?? DEFAULT_ENTRY;
  data[id] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  persist(data);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Réagit aux changements de l'entrée CRM d'une entreprise donnée. */
export function useCrmEntry(id: string): CrmEntry {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id),
    () => DEFAULT_ENTRY
  );
}

/** Réagit à n'importe quel changement du CRM (utile pour les compteurs). */
export function useCrmData(): CrmData {
  return useSyncExternalStore(
    subscribe,
    () => load(),
    () => ({})
  );
}
