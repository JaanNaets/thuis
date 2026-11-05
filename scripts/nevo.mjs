// Zet het bestand van NEVO-online (RIVM) om naar shared/nevo-data.ts: per voedingsmiddel de code, de Nederlandse naam
// en per 100 g kcal, vet, verzadigd vet, koolhydraten, suikers, vezels en eiwit. Ongewijzigd (enkel de kolommen die de
// app toont; geen omrekening). Gebruik: node scripts/nevo.mjs data/NEVO2025_9.0.csv 2025/9.0
//
// Het scheidingsteken (| ; tab of komma) en een kommagetal herkent het script zelf; de kolommen zoekt het op hun naam
// (NEVO-code, Voedingsmiddelnaam, ENERCC, FAT, FASAT, CHO, SUGAR, FIBT, PROT).

import { readFileSync, writeFileSync } from "node:fs";

const [file, version] = process.argv.slice(2);
if (!file || !version) {
  console.error("Gebruik: node scripts/nevo.mjs <bestand.csv> <versie, bv. 2025/9.0>");
  process.exit(1);
}

let text = readFileSync(file);
// UTF-8, of anders Windows-1252 (oudere bestanden van het RIVM).
let raw = new TextDecoder("utf-8", { fatal: false }).decode(text);
if (raw.includes("�")) raw = new TextDecoder("windows-1252").decode(text);
raw = raw.replace(/^﻿/, "");

const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = lines[0];
const sep = ["|", ";", "\t", ","].sort((a, b) => header.split(b).length - header.split(a).length)[0];

/** Eén regel in velden (met aanhalingstekens). */
function split(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') (cur += '"'), i++;
      else quoted = !quoted;
    } else if (ch === sep && !quoted) (out.push(cur), (cur = ""));
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const head = split(header);
const col = (test) => {
  const i = head.findIndex(test);
  if (i < 0) throw new Error(`Kolom niet gevonden (${test}). Kolommen: ${head.join(" | ")}`);
  return i;
};
const code = (h) => h.split(/[\s(]/)[0].toUpperCase();
const idx = {
  code: col((h) => /nevo.?code/i.test(h)),
  name: col((h) => /voedingsmiddelnaam|dutch food name/i.test(h)),
  kcal: col((h) => code(h) === "ENERCC"),
  fat: col((h) => code(h) === "FAT"),
  saturated: col((h) => code(h) === "FASAT"),
  carbs: col((h) => code(h) === "CHO"),
  sugars: col((h) => code(h) === "SUGAR"),
  fiber: col((h) => code(h) === "FIBT"),
  protein: col((h) => code(h) === "PROT"),
};
const num = (s) => {
  const t = (s ?? "").replace(",", ".").trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

const foods = [];
for (const line of lines.slice(1)) {
  const f = split(line);
  const name = f[idx.name];
  const c = Number(f[idx.code]);
  if (!name || !Number.isInteger(c)) continue;
  foods.push([c, name, num(f[idx.kcal]), num(f[idx.fat]), num(f[idx.saturated]), num(f[idx.carbs]), num(f[idx.sugars]), num(f[idx.fiber]), num(f[idx.protein])]);
}
if (!foods.length) throw new Error("Geen voedingsmiddelen gevonden.");

const out = `// Gemaakt door scripts/nevo.mjs uit het bestand van NEVO-online (RIVM), versie ${version}. Niet met de hand aanpassen:
// de gegevens worden ongewijzigd gebruikt. Bron: Gebaseerd op gegevens van NEVO-online versie ${version}, RIVM, Bilthoven.

import type { NevoData } from "./nevo.ts";

export const NEVO_DATA: NevoData = {
  version: ${JSON.stringify(version)},
  foods: [
${foods.map((f) => `    ${JSON.stringify(f)},`).join("\n")}
  ],
};
`;
writeFileSync(new URL("../shared/nevo-data.ts", import.meta.url), out);
console.log(`${foods.length} voedingsmiddelen uit NEVO-online ${version} → shared/nevo-data.ts`);
