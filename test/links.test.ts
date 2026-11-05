import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { adjustProblems, AGENDA_NODE, BALANCE_NODE, CALC_LINKS, FIELD_LINKS, layoutLinks, listLinks, mergeLinks, TOTAL_LINKS, type LinkList } from "../shared/links.ts";

// De pelletkachel: Bijvullen trekt af van de Voorraad, Uitgaven tellen erbij en verrekenen, Verkopers vatten de
// uitgaven samen, Onderhoud staat in de agenda.
const voorraad: LinkList = {
  id: "V",
  fields: [
    { key: "aantal", label: "Aantal", type: "number" },
    { key: "laatst", label: "Laatst bijgevuld", type: "calc", result: "date", calc: { kind: "rollup", from: "backlinks", list: "B", via: "voorraad", agg: "max", field: "datum" } },
  ],
  totals: [],
};
const bijvullen: LinkList = {
  id: "B",
  fields: [
    { key: "datum", label: "Datum", type: "date" },
    { key: "zakken", label: "Zakken", type: "number" },
    { key: "voorraad", label: "Uit voorraad", type: "item", ref_type: "V", adjust: { field: "aantal", by: "zakken", sign: -1 } },
  ],
  totals: [],
};
const uitgaven: LinkList = {
  id: "U",
  fields: [
    { key: "bedrag", label: "Bedrag", type: "money" },
    { key: "door", label: "Betaald door", type: "person" },
    { key: "voor", label: "Verdeling", type: "share" },
    { key: "aantal", label: "Aantal", type: "number" },
    { key: "voorraad", label: "Voor de voorraad", type: "item", ref_type: "V", adjust: { field: "aantal", by: "aantal", sign: 1 } },
    { key: "verkoper", label: "Verkoper", type: "item", ref_type: "K" },
  ],
  totals: [{ id: "t1", agg: "sum", field: "bedrag", period: "all", by: "voor", against: "door", settle: true }],
};
const verkopers: LinkList = {
  id: "K",
  fields: [{ key: "totaal", label: "Uitgegeven", type: "calc", result: "money", calc: { kind: "rollup", from: "backlinks", list: "U", via: "verkoper", agg: "sum", field: "bedrag" } }],
  totals: [],
};
const onderhoud: LinkList = {
  id: "O",
  fields: [
    { key: "datum", label: "Volgende beurt", type: "date", agenda: true },
    { key: "notitie", label: "Notitie", type: "longtext" },
  ],
  totals: [],
};
const all = [voorraad, bijvullen, uitgaven, verkopers, onderhoud];
const fieldsOf = (id: string): FieldDef[] | undefined => all.find((l) => l.id === id)?.fields;
const links = mergeLinks(all.flatMap((l) => listLinks(l, fieldsOf)));

test("verbanden volgen uit verwijzingen, berekeningen, totalen en de agenda", () => {
  const find = (kind: string, from: string, to: string) => links.find((l) => l.kind === kind && l.from === from && l.to === to);
  assert.deepEqual(find("adjust", "B", "V")?.texts, ["Trekt Zakken af van Aantal"]);
  assert.deepEqual(find("calc", "B", "V")?.texts, ["Levert Laatst bijgevuld"]);
  assert.deepEqual(find("adjust", "U", "V")?.texts, ["Telt Aantal bij Aantal"]);
  assert.deepEqual(find("calc", "U", "K")?.texts, ["Levert Uitgegeven"]);
  assert.deepEqual(find("total", "U", BALANCE_NODE)?.texts, ["Telt mee in Wie moet wie"]);
  assert.deepEqual(find("agenda", "O", AGENDA_NODE)?.texts, ["Volgende beurt in de agenda"]);
  // De verwijzing Uitgaven → Verkopers is dezelfde band als de samenvatting erover: één lijn.
  assert.equal(find("ref", "U", "K"), undefined);
  assert.equal(links.length, 6);
});

test("wat de lezer niet ziet, geeft geen naam en geen verband", () => {
  // Zonder de velden van de Voorraad: het verband blijft, zonder het veld dat de lezer niet kent.
  assert.deepEqual(listLinks(bijvullen)[0].texts, ["Trekt af"]);
  // Een verborgen verwijzing (de Worker laat het veld weg): geen verband.
  assert.deepEqual(listLinks({ ...bijvullen, fields: bijvullen.fields.filter((f) => f.key !== "voorraad") }), []);
  // Een plaats in een plaats verwijst naar zichzelf: geen lijn.
  assert.deepEqual(listLinks({ id: "P", fields: [{ key: "in", label: "Ligt in", type: "item", ref_type: "P" }], totals: [] }), []);
});

test("een gewone verwijzing en een totaal uit een andere lijst", () => {
  const uit = listLinks({ id: "X", fields: [{ key: "w", label: "Winkel", type: "item", ref_type: "K", copy: true }], totals: [] });
  assert.deepEqual(uit, [{ kind: "ref", from: "X", to: "K", texts: ["Verwijst met Winkel en neemt over"] }]);
  const totaal = listLinks({ id: "Y", fields: [{ key: "kcal", label: "Kcal", type: "number" }], totals: [{ id: "t", agg: "sum", field: "kcal", period: "day", sources: ["Z"] }] });
  assert.deepEqual(totaal, [{ kind: "total", from: "Z", to: "Y", texts: ["Telt mee in Kcal per dag"] }]);
});

test("de kaart: een rij per lijst waar iets toekomt, de agenda onderaan", () => {
  const nodes = [
    { id: "B", column: "pk" },
    { id: "O", column: "pk" },
    { id: "V", column: "s1" },
    { id: "U", column: "s1" },
    { id: "K", column: "s1" },
    { id: BALANCE_NODE, column: "s1" },
    { id: AGENDA_NODE, column: "out" },
    { id: "W", column: "s1" }, // zonder verbanden: niet op de kaart
  ];
  const layout = layoutLinks(["pk", "s1", "out"], nodes, links);
  assert.deepEqual(
    layout.rows.map((r) => r.hub),
    ["V", "K", BALANCE_NODE, AGENDA_NODE],
  );
  assert.deepEqual(layout.rows[0].kinds, ["adjust", "calc"]);
  assert.deepEqual(layout.places.get("B"), { col: 0, slot: 0, row: 0 });
  assert.deepEqual(layout.places.get("O"), { col: 0, slot: 0, row: 3 });
  assert.deepEqual(layout.places.get("V"), { col: 1, slot: 0, row: 0 });
  // Uitgaven gaat naar drie rijen: een eigen plaats, zodat haar verticale lijn niets raakt.
  assert.deepEqual(layout.places.get("U"), { col: 1, slot: 1, row: 0 });
  assert.deepEqual(layout.places.get("K"), { col: 1, slot: 0, row: 1 });
  assert.equal(layout.places.has("W"), false);
  assert.deepEqual(layout.slots, [1, 2, 1]);
});

test("de kaart is voorspelbaar", () => {
  const nodes = [
    { id: "B", column: "a" },
    { id: "V", column: "b" },
  ];
  const one = layoutLinks(["a", "b"], nodes, links);
  const two = layoutLinks(["a", "b"], nodes, [...links].reverse());
  assert.deepEqual([...one.places], [...two.places]);
  assert.deepEqual(one.rows, two.rows);
});

test("een verwijzing naar twee voorraden geeft een lijn naar elk", () => {
  const eten: LinkList = {
    id: "E",
    fields: [
      { key: "hoeveel", label: "Hoeveel", type: "number" },
      { key: "wat", label: "Wat", type: "item", ref_type: "V1", ref_also: ["V2"], free: true, adjust: { field: "aantal", by: "hoeveel", sign: -1 } },
    ],
    totals: [],
  };
  const fields = (id: string) => (id === "V1" || id === "V2" ? voorraad.fields : undefined);
  const out = listLinks(eten, fields);
  assert.deepEqual(
    out.map((l) => [l.kind, l.from, l.to, l.texts[0]]),
    [
      ["adjust", "E", "V1", "Trekt Hoeveel af van Aantal"],
      ["adjust", "E", "V2", "Trekt Hoeveel af van Aantal"],
    ],
  );
});

// Elke eigenschap die volgens shared/links.ts een verband maakt, heeft hier een voorbeeld dat een lijn moet geven.
// Komt er een bij (TypeScript dwingt dat af in FIELD_LINKS, CALC_LINKS of TOTAL_LINKS), dan faalt deze test tot
// `listLinks` ze toont en er hier een voorbeeld staat.
test("elke werking die lijsten verbindt, staat op de kaart", () => {
  const ref = { key: "r", label: "R", type: "item", ref_type: "B" } as const;
  const field: Record<string, FieldDef[]> = {
    ref_type: [ref],
    ref_also: [{ ...ref, ref_also: ["C"] }],
    agenda: [{ key: "d", label: "D", type: "date", agenda: true }],
    adjust: [{ key: "n", label: "N", type: "number" }, { ...ref, adjust: { field: "aantal", sign: -1 } }],
    copy: [{ ...ref, copy: true }],
    spawn: [{ key: "g", label: "Gegeten", type: "bool", spawn: ["E"] }],
    calc: [ref, { key: "c", label: "C", type: "calc", result: "text", calc: { kind: "lookup", via: "r", field: "x" } }],
  };
  const calc: Record<string, FieldDef[]> = {
    lookup: field.calc,
    rollup: [{ key: "s", label: "S", type: "calc", result: "number", calc: { kind: "rollup", from: "backlinks", list: "B", via: "r", agg: "count" } }],
  };
  const total: Record<string, LinkList["totals"]> = {
    sources: [{ id: "t", agg: "count", period: "all", sources: ["B"] }],
    settle: [{ id: "t", agg: "sum", field: "n", period: "all", by: "p", against: "q", settle: true }],
  };
  const linksOf = (fields: FieldDef[], totals: LinkList["totals"] = []) => listLinks({ id: "A", fields, totals });
  for (const [key, on] of Object.entries(FIELD_LINKS)) if (on) assert.ok(field[key] && linksOf(field[key]).length > 0, `veld.${key} geeft geen verband`);
  for (const [kind, on] of Object.entries(CALC_LINKS)) if (on) assert.ok(calc[kind] && linksOf(calc[kind]).length > 0, `berekening ${kind} geeft geen verband`);
  for (const [key, on] of Object.entries(TOTAL_LINKS)) if (on) assert.ok(total[key] && linksOf([], total[key]).length > 0, `totaal.${key} geeft geen verband`);
  // En omgekeerd: een veld zonder zo'n eigenschap verbindt niets.
  assert.deepEqual(linksOf([{ key: "t", label: "T", type: "text", hint: "x", column: true }]), []);
});

test("problemen: wie bijvult maar het aantal daar niet mag wijzigen", () => {
  const admin = { manage: true, members: true, create: true, delete: true, items: "edit", types: {} } as const;
  const member = { ...admin, manage: false, members: false } as const;
  const viewer = { ...member, create: false, delete: false, items: "view" } as const;
  const noWat = { ...member, types: { E: { fields: { wat: "view" } } } } as const;
  const roles = new Map([
    ["r-admin", { name: "Beheerder", rights: admin, project_id: "F" }],
    ["r-lid", { name: "Lid", rights: member, project_id: "F" }],
    ["r-kijk", { name: "Lezer", rights: viewer, project_id: "K" }],
    ["r-k-admin", { name: "Beheerder", rights: admin, project_id: "K" }],
    ["r-nowat", { name: "Kijker", rights: noWat, project_id: "F" }],
  ]);
  const memberships = [
    { project_id: "F", person_id: "jaan", role_id: "r-admin" },
    { project_id: "K", person_id: "jaan", role_id: "r-k-admin" },
    { project_id: "F", person_id: "jana", role_id: "r-lid" },
    { project_id: "K", person_id: "jana", role_id: "r-kijk" },
    { project_id: "F", person_id: "piet", role_id: "r-lid" },
    { project_id: "F", person_id: "kim", role_id: "r-nowat" },
  ];
  const people = new Map([
    ["jaan", "Jaan"],
    ["jana", "Jana"],
    ["piet", "Piet"],
    ["kim", "Kim"],
  ]);
  const edge = { from: "E", fromProject: "F", key: "wat", to: "V", toProject: "K", toProjectName: "Kerkstraat", target: "aantal", label: "Aantal" };
  const problems = adjustProblems([edge], people, memberships, roles, (p) => [p]);
  assert.deepEqual(
    problems.map((p) => [p.person, p.role?.name ?? null]),
    [
      ["Jana", "Lezer"],
      ["Piet", null],
    ],
  );
  assert.equal(problems[0].field, "Aantal");
  assert.deepEqual(problems[0].project, { id: "K", name: "Kerkstraat" });
  // Een rol erboven telt ook: wie in het hoofdproject Beheerder is, kan het.
  const sub = adjustProblems([{ ...edge, toProject: "K-sub" }], people, memberships, roles, (p) => (p === "K-sub" ? ["K-sub", "K"] : [p]));
  assert.deepEqual(
    sub.map((p) => p.person),
    ["Jana", "Piet"],
  );
});
