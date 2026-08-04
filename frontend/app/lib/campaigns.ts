"use client";

import { useSyncExternalStore } from "react";

/**
 * Historique des campagnes d'emails, sauvegardé localement (navigateur).
 * Une campagne = un objet + un message + la liste des destinataires visés.
 */

export interface CampaignRecipient {
  id: string;
  name: string;
  email: string;
}

export interface Campaign {
  id: string;
  date: string;
  subject: string;
  body: string;
  recipients: CampaignRecipient[];
}

const KEY = "loadlink:campaigns";

let cache: Campaign[] | null = null;
const listeners = new Set<() => void>();

function load(): Campaign[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    cache = [];
  }
  return cache!;
}

function persist(list: Campaign[]) {
  cache = list;
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(list));
  }
  listeners.forEach((l) => l());
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function saveCampaign(
  data: Omit<Campaign, "id" | "date">
): Campaign {
  const campaign: Campaign = { ...data, id: newId(), date: new Date().toISOString() };
  persist([campaign, ...load()]);
  return campaign;
}

export function deleteCampaign(id: string) {
  persist(load().filter((c) => c.id !== id));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCampaigns(): Campaign[] {
  return useSyncExternalStore(
    subscribe,
    () => load(),
    () => []
  );
}
