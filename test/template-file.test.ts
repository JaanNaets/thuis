import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTemplateFile,
  flatten,
  parseTemplateFile,
  planTemplate,
  templateSummary,
  type ExportProject,
  type TemplateProject,
} from "../shared/template-file.ts";
import { resolveTemplateLists } from "../shared/templates.ts";
import type { ItemType } from "../shared/types.ts";

const list = (
  id: string,
  project_id: string,
  name: string,
  fields: ItemType["fields"],
  totals: ItemType["totals"] = [],
): ItemType => ({
  id,
  project_id,
  name,
  plural: `${name}s`,
  name_label: null,
  icon: "folder",
  fields,
  totals,
  sort_order: 0,
});

// Huis (erboven, met Verkopers) › Kelder (met Wijnen) › Rek (met Vakken die naar een wijn verwijzen).
const vendor = list("v", "huis", "Verkoper", [{ key: "land", label: "Land", type: "text" }]);
const wine = list(
  "w",
  "kelder",
  "Wijn",
  [
    { key: "aantal", label: "Aantal", type: "number" },
    { key: "prijs", label: "Prijs", type: "money" },
    { key: "bij", label: "Gekocht bij", type: "item", ref_type: "v" },
    { key: "wie", label: "Betaald door", type: "person", me: true },
    { key: "verdeling", label: "Verdeling", type: "share", fill: true, default_shares: [{ person_id: "p1", share: 100 }] },
    { key: "waarde", label: "Waarde", type: "calc", result: "money", calc: { kind: "math", op: "*", a: { field: "aantal" }, b: { field: "prijs" } } },
    { key: "vakken", label: "Vakken", type: "calc", result: "number", calc: { kind: "rollup", from: "backlinks", list: "x", via: "wijn", agg: "count" } },
    { key: "elders", label: "Elders", type: "calc", result: "number", calc: { kind: "rollup", from: "backlinks", list: "ander", via: "wijn", agg: "count" } },
  ],
  [
    { id: "t1", agg: "sum", field: "waarde", period: "all", by: "wie", goal: 50000, goal_kind: "max", sources: ["elders"] },
    { id: "saldo", agg: "sum", field: "prijs", period: "all", by: "wie", against: "verdeling", settle: true, scope: "tree" },
  ],
);
const slot = list("x", "rek", "Vak", [{ key: "wijn", label: "Wijn", type: "item", ref_type: "w" }]);
const tree: ExportProject[] = [
  { id: "kelder", parent_id: "huis", name: "Kelder", description: "Onder de trap", icon: "wine", color: "rose" },
  { id: "rek", parent_id: "kelder", name: "Rek", description: null, icon: null, color: null },
];

test("een project als sjabloon: lijsten, subprojecten, en wat erboven nodig is", () => {
  const file = buildTemplateFile(tree, [vendor, wine, slot]);
  assert.equal(file.thuis, "sjabloon");
  const top = file.project;
  assert.deepEqual(
    top.lists.map((l) => [l.key, l.linked ?? false]),
    [
      ["wijn", false],
      ["verkoper", true],
    ],
  );
  assert.equal(top.children[0].name, "Rek");
  assert.equal(top.children[0].lists[0].fields[0].ref, "wijn");
  const w = top.lists[0];
  // Verwijzingen op sleutel, geen uitkomsten of id's; een samenvatting over een lijst die niet meekomt, valt weg.
  assert.equal(w.fields.find((f) => f.key === "bij")!.ref, "verkoper");
  assert.ok(!JSON.stringify(file).includes('"result"'));
  assert.deepEqual(w.fields.find((f) => f.key === "vakken")!.calc, { kind: "rollup", from: "backlinks", list: "vak", via: "wijn", agg: "count" });
  assert.equal(
    w.fields.find((f) => f.key === "elders"),
    undefined,
  );
  // Geen mensen: de gewone verdeling gaat eruit (zelf invullen blijft).
  assert.deepEqual(w.fields.find((f) => f.key === "verdeling"), { key: "verdeling", label: "Verdeling", type: "share", fill: true });
  assert.ok(!JSON.stringify(file).includes("p1"));
  // Totalen gaan mee, zonder lijsten uit andere projecten ("apart per" noemt een veld, geen persoon).
  assert.deepEqual(w.totals, [
    { id: "t1", agg: "sum", field: "waarde", period: "all", by: "wie", goal: 50000, goal_kind: "max" },
    { id: "saldo", agg: "sum", field: "prijs", period: "all", by: "wie", against: "verdeling", settle: true, scope: "tree" },
  ]);
  // Wat je inleest, is wat je deelde.
  assert.deepEqual(parseTemplateFile(JSON.parse(JSON.stringify(file))), file);
  assert.deepEqual(templateSummary(file), { lists: ["Wijns", "Verkopers", "Vaks"], projects: 1 });
});

test("één lijst delen", () => {
  const file = buildTemplateFile(tree.slice(0, 1), [vendor, wine], wine);
  assert.equal(file.project.name, "Wijns");
  assert.deepEqual(
    file.project.lists.map((l) => l.key),
    ["wijn", "verkoper"],
  );
  assert.deepEqual(file.project.children, []);
});

test("een sjabloon nakijken", () => {
  const ok = { thuis: "sjabloon", version: 1, project: { name: "Tuin", lists: [{ key: "plant", name: "Plant", fields: [] }] } };
  assert.equal(parseTemplateFile(ok).project.lists[0].plural, "Plant");
  assert.throws(() => parseTemplateFile({ project: {} }), /geen sjabloon/);
  assert.throws(() => parseTemplateFile({ ...ok, version: 9 }), /nieuwere versie/);
  assert.throws(() => parseTemplateFile({ ...ok, project: { name: "" } }), /geen naam/);
  const two = { key: "a", name: "A", fields: [] };
  assert.throws(() => parseTemplateFile({ ...ok, project: { name: "X", lists: [two, two] } }), /sleutel/);
  assert.throws(
    () => parseTemplateFile({ ...ok, project: { name: "X", lists: [{ key: "a", name: "A", fields: [{ key: "k", label: "K", type: "magie" }] }] } }),
    /Onbekende soort/,
  );
  assert.throws(
    () => parseTemplateFile({ ...ok, project: { name: "X", lists: [{ key: "a", name: "A", fields: [{ key: "w", label: "W", type: "item" }] }] } }),
    /verwijst/,
  );
  // Te diep of te veel.
  let deep: object = { name: "D", lists: [] };
  for (let i = 0; i < 6; i++) deep = { name: `D${i}`, lists: [], children: [deep] };
  assert.throws(() => parseTemplateFile({ ...ok, project: deep }), /te diep/);
  // Onbekende iconen en kleuren worden gewoon niets.
  const odd = parseTemplateFile({ ...ok, project: { ...ok.project, icon: "raket", color: "neon" } });
  assert.equal(odd.project.icon, null);
  assert.equal(odd.project.color, null);
});

test("aanmaken: verwijzingen enkel naar boven, gekoppelde lijsten hergebruikt", () => {
  const top: TemplateProject = {
    name: "Kelder",
    description: null,
    icon: null,
    color: null,
    lists: [
      {
        key: "wijn",
        name: "Wijn",
        plural: "Wijnen",
        icon: "wine",
        fields: [
          { key: "bij", label: "Gekocht bij", type: "item", ref: "verkoper" },
          // Naar een lijst in een subproject verwijzen kan niet (in de app ook niet).
          { key: "vak", label: "Vak", type: "item", ref: "vak" },
          { key: "vakken", label: "Vakken", type: "calc", calc: { kind: "rollup", from: "backlinks", list: "vak", via: "wijn", agg: "count" } },
        ],
      },
      { key: "verkoper", name: "Verkoper", plural: "Verkopers", icon: "store", fields: [], linked: true },
    ],
    children: [
      {
        name: "Rek",
        description: null,
        icon: null,
        color: null,
        lists: [{ key: "vak", name: "Vak", plural: "Vakken", icon: "folder", fields: [{ key: "wijn", label: "Wijn", type: "item", ref: "wijn" }] }],
        children: [],
      },
    ],
  };
  assert.deepEqual(
    flatten(top).map((n) => [n.project.name, n.parent]),
    [
      ["Kelder", null],
      ["Rek", 0],
    ],
  );
  let n = 0;
  // Erboven bestaat al een lijst Verkoper: die wordt gebruikt.
  const nodes = planTemplate(top, ["p-kelder", "p-rek"], { verkoper: "bestaand" }, () => `nieuw-${++n}`);
  assert.deepEqual(
    nodes.map((x) => [x.projectId, x.plans.map((p) => p.list.key)]),
    [
      ["p-kelder", ["wijn"]],
      ["p-rek", ["vak"]],
    ],
  );
  const plans = nodes.flatMap((x) => x.plans);
  const fields = resolveTemplateLists(plans, { verkoper: "bestaand" });
  const wijn = fields[plans[0].id];
  assert.equal(wijn.find((f) => f.key === "bij")!.ref_type, "bestaand");
  assert.equal(
    wijn.find((f) => f.key === "vak"),
    undefined,
  );
  // Samenvatten over wat eronder naar een wijn verwijst, mag wel.
  assert.equal(wijn.find((f) => f.key === "vakken")!.result, "number");
  assert.equal(fields[plans[1].id][0].ref_type, plans[0].id);
  // Zonder Verkoper erboven komt er een nieuwe.
  assert.deepEqual(
    planTemplate(top, ["a", "b"], {}, () => `n-${++n}`)[0].plans.map((p) => p.list.key),
    ["wijn", "verkoper"],
  );
});

test("een sjabloon van voor de totalen: regels worden een totaal dat verrekent", () => {
  const old = {
    thuis: "sjabloon",
    version: 1,
    project: {
      name: "Reis",
      lists: [
        {
          key: "uitgave",
          name: "Uitgave",
          fields: [
            { key: "bedrag", label: "Bedrag", type: "money" },
            { key: "door", label: "Betaald door", type: "person" },
            { key: "voor", label: "Verdeling", type: "share" },
          ],
          rules: [{ kind: "split", amount: "bedrag", payer: "door", for: "voor", default: [{ person_id: "p1", share: 100 }] }],
        },
        {
          key: "terug",
          name: "Terugbetaling",
          fields: [
            { key: "bedrag", label: "Bedrag", type: "money" },
            { key: "van", label: "Van", type: "person" },
            { key: "aan", label: "Aan", type: "person" },
          ],
          rules: [{ kind: "settle", amount: "bedrag", from: "van", to: "aan" }],
        },
        // Een regel met een veld dat er niet is, valt weg.
        { key: "kapot", name: "Kapot", fields: [], rules: [{ kind: "split", amount: "x", payer: "y", for: "z" }] },
      ],
    },
  };
  const [uitgave, terug, kapot] = parseTemplateFile(old).project.lists;
  assert.equal(uitgave.fields.find((f) => f.key === "door")!.me, true);
  assert.equal(uitgave.fields.find((f) => f.key === "voor")!.fill, true);
  assert.deepEqual(uitgave.totals, [{ id: "saldo", agg: "sum", field: "bedrag", period: "all", by: "door", against: "voor", settle: true, scope: "tree" }]);
  assert.deepEqual(terug.totals, [{ id: "saldo", agg: "sum", field: "bedrag", period: "all", by: "van", against: "aan", settle: true, scope: "tree" }]);
  assert.deepEqual(kapot.totals, []);
  assert.ok(!JSON.stringify(parseTemplateFile(old)).includes("p1"));
  assert.ok(!JSON.stringify(parseTemplateFile(old)).includes("rules"));
});
