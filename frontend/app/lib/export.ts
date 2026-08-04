import * as XLSX from "xlsx";
import { Company } from "./types";
import { getEntry, statusLabel } from "./crm";

/** Construit les lignes exportables (contacts + statut/notes CRM). */
function toRows(companies: Company[]) {
  return companies.map((c) => {
    const crm = getEntry(c.id);
    return {
      Nom: c.name,
      Catégorie: c.category,
      Téléphone: c.phone ?? "",
      Email: c.email ?? "",
      "Site web": c.website ?? "",
      Adresse: c.street ?? "",
      "Code postal": c.postcode ?? "",
      Ville: c.city ?? "",
      Statut: statusLabel(crm.status),
      Notes: crm.notes ?? "",
    };
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function exportCsv(companies: Company[], filename = "loadlink-prospects.csv") {
  const rows = toRows(companies);
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(",")),
  ];
  // BOM UTF-8 pour qu'Excel affiche correctement les accents.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, filename);
}

export function exportXlsx(companies: Company[], filename = "loadlink-prospects.xlsx") {
  const rows = toRows(companies);
  if (rows.length === 0) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  // Largeurs de colonnes lisibles.
  worksheet["!cols"] = [
    { wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 30 },
    { wch: 26 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 40 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Prospects");
  XLSX.writeFile(workbook, filename);
}
