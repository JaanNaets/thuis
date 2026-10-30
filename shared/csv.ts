// Een lijst exporteren als CSV: om te openen in Excel, Numbers of Google Sheets. Met ; tussen de kolommen en een
// komma in getallen, zoals Excel het in België verwacht, en een BOM zodat é en € goed staan.

import { formatFieldValue, type FieldDef, type FieldValue, type Names } from "./fields.ts";

/** Een waarde als cel: getallen en bedragen zonder eenheid (om mee te rekenen), datums als 2026-10-30, de rest leesbaar. */
export function exportValue(def: FieldDef, value: FieldValue | undefined, names: Names): string {
  if (value === undefined || value === null) return "";
  const type = def.type === "calc" && def.result && def.result !== "calc" ? def.result : def.type;
  if (typeof value === "number" && (type === "money" || type === "number" || type === "score" || type === "duration" || type === "year")) {
    const n = type === "money" ? (value / 100).toFixed(2) : String(value);
    return n.replace(".", ",");
  }
  if (type === "date" && typeof value === "string") return value;
  return formatFieldValue(def, value, names);
}

const cell = (text: string) => (/[;"\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/** Rijen als CSV (de eerste rij: de kolomnamen). */
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Een bestandsnaam zonder vreemde tekens: "Uitgaven-2026-10-30.csv". */
export function csvFilename(name: string, today: string): string {
  const safe = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safe || "lijst"}-${today}.csv`;
}
