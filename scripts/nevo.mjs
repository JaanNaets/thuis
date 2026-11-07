// Zet het bestand van NEVO-online (RIVM) om naar data/nevo.sql: per voedingsmiddel de code, de Nederlandse naam en per
// 100 g kcal, vet, verzadigd vet, koolhydraten, suikers, vezels en eiwit, en de synoniemen (om op te zoeken), voor de
// tabel nevo_foods (migrations/0031).
// Ongewijzigd (enkel de kolommen die de app toont; geen omrekening). data/ staat niet in git: het repo is publiek en de
// gegevens zijn van het RIVM.
//
// Gebruik: node scripts/nevo.mjs data/NEVO2025_v9.0.csv 2025/9.0
// Dan lokaal: npx wrangler d1 execute DB --local --file data/nevo.sql (online: --remote).
//
// Het scheidingsteken (| ; tab of komma) en een kommagetal herkent het script zelf; de kolommen zoekt het op hun naam
// (NEVO-code, Voedingsmiddelnaam, ENERCC, FAT, FASAT, CHO, SUGAR, FIBT, PROT).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

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
  synonym: col((h) => /^synoniem/i.test(h)),
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
  foods.push([c, name, num(f[idx.kcal]), num(f[idx.fat]), num(f[idx.saturated]), num(f[idx.carbs]), num(f[idx.sugars]), num(f[idx.fiber]), num(f[idx.protein]), f[idx.synonym] || null]);
}
if (!foods.length) throw new Error("Geen voedingsmiddelen gevonden.");

// Per 200 rijen één INSERT (D1 houdt een vraag klein); eerst alles weg, zodat een nieuwe versie de oude vervangt.
const sql = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const rows = foods.map((f) => `(${[...f, version].map(sql).join(", ")})`);
const parts = ["DELETE FROM nevo_foods;"];
for (let i = 0; i < rows.length; i += 200) {
  parts.push(`INSERT INTO nevo_foods (code, name, kcal, fat, saturated, carbs, sugars, fiber, protein, synonym, version) VALUES\n${rows.slice(i, i + 200).join(",\n")};`);
}
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/nevo.sql", import.meta.url), parts.join("\n") + "\n");
console.log(`${foods.length} voedingsmiddelen uit NEVO-online ${version} → data/nevo.sql`);
