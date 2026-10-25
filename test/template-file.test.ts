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

const list = (id: string, project_id: string, name: string, fields: ItemType["fields"], rules: ItemType["rules"] = []): ItemType => ({
  id,
  project_id,
  name,
  plural: `${name}s`,
  name_label: null,
  icon: "folder",
  fields,
  rules,
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
    { key: "wie", label: "Betaald door", type: "person" },
    { key: "verdeling", label: "Verdeling", type: "share" },
    { key: "waarde", label: "Waarde", type: "calc", result: "money", calc: { kind: "math", op: "*", a: { field: "aantal" }, b: { field: "prijs" } } },
    { key: "vakken", label: "Vakken", type: "calc", result: "number", calc: { kind: "rollup", from: "backlinks", list: "x", via: "wijn", agg: "count" } },
    { key: "elders", label: "Elders", type: "calc", result: "number", calc: { kind: "rollup", from: "backlinks", list: "ander", via: "wijn", agg: "count" } },
  ],
  [{ kind: "split", amount: "prijs", payer: "wie", for: "verdeling", default: [{ person_id: "p1", share: 100 }] }],
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
  // Geen mensen: de gewone verdeling gaat eruit.
  assert.deepEqual(w.rules, [{ kind: "split", amount: "prijs", payer: "wie", for: "verdeling" }]);
  assert.ok(!JSON.stringify(file).includes("p1"));
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
