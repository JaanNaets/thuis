import assert from "node:assert/strict";
import { test } from "node:test";
import { baseKind, brusselsNow, cleanParts, fitGroups, groupOf, mergeKinds, namedLines, eventTitle, fillsLists, formsOf, isAt, minutesBetween, startsPlanned, type KindInfo } from "../shared/model.ts";
import { eventRole, keepsAdmin, lineAllowed, lineVisible, rolesFor, Roles } from "../shared/rights.ts";

const JAAN = "jaan";
const JANA = "jana";
const RIK = "rik";

test("een moment is een dag of een dag met uur", () => {
  assert.ok(isAt("2026-11-06"));
  assert.ok(isAt("2026-11-06T18:42"));
  assert.ok(!isAt("2026-11-06T25:00"));
  assert.ok(!isAt("6 nov"));
  assert.equal(minutesBetween("2026-11-06T08:30", "2026-11-06T16:30"), 480);
  assert.equal(minutesBetween("2026-11-06", "2026-11-06T16:30"), null);
  assert.equal(brusselsNow(new Date("2026-07-01T10:00:00Z")), "2026-07-01T12:00");
  assert.equal(brusselsNow(new Date("2026-12-01T10:00:00Z")), "2026-12-01T11:00");
});

test("de titel van een gebeurtenis: haar naam, anders de soort met het eerste item", () => {
  const lines = [{ role: "bij" as const, item_id: "colruyt", text: null }, { role: "in" as const, item_id: "yoghurt", text: null }];
  const names: Record<string, string> = { yoghurt: "Yoghurt", colruyt: "Colruyt" };
  assert.equal(eventTitle({ name: "", lines: lines as never }, { name: "Aankoop" }, (id) => names[id]), "Aankoop: Yoghurt");
  assert.equal(eventTitle({ name: "Boodschappen", lines: lines as never }, { name: "Aankoop" }, (id) => names[id]), "Boodschappen");
  assert.equal(eventTitle({ name: "", lines: [] }, { name: "Werk" }, () => undefined), "Werk");
});

test("rechtstreeks wint van een regel, ook geen", () => {
  const direct = [
    { list_id: "voorraad", person_id: JAAN, role: "beheerder" as const },
    { list_id: "bezit", person_id: JAAN, role: "beheerder" as const },
    { list_id: "bezit", person_id: JANA, role: "gast" as const },
    { list_id: "kluis", person_id: JAAN, role: "beheerder" as const },
    { list_id: "kluis", person_id: JANA, role: "geen" as const },
  ];
  const links = [
    { list_id: "voorraad", tag_id: "huis" },
    { list_id: "bezit", tag_id: "huis" },
    { list_id: "kluis", tag_id: "huis" },
  ];
  const rules = [{ tag_id: "huis", person_id: JANA, role: "lid" as const, created_by: JAAN }];
  const roles = rolesFor(JANA, direct, links, rules, ["voorraad", "bezit", "kluis"]);
  assert.equal(roles.get("voorraad"), "lid");
  assert.equal(roles.get("bezit"), "gast");
  assert.equal(roles.has("kluis"), false);
});

test("een regel geldt enkel waar wie ze maakte rechtstreeks beheerder is", () => {
  const direct = [
    { list_id: "voorraad", person_id: JAAN, role: "beheerder" as const },
    { list_id: "gereedschap", person_id: RIK, role: "beheerder" as const },
  ];
  // Rik zet de tag Huis op zijn eigen lijst: Jaan's regel geeft Jana daar niets.
  const links = [
    { list_id: "voorraad", tag_id: "huis" },
    { list_id: "gereedschap", tag_id: "huis" },
  ];
  const rules = [{ tag_id: "huis", person_id: JANA, role: "beheerder" as const, created_by: JAAN }];
  const roles = rolesFor(JANA, direct, links, rules, ["voorraad", "gereedschap"]);
  assert.equal(roles.get("voorraad"), "beheerder");
  assert.equal(roles.has("gereedschap"), false);
});

test("wie bij een lijst kan: rechtstreeks, via een regel, of uitgesloten", () => {
  const index = new Roles(
    [
      { list_id: "voorraad", person_id: JAAN, role: "beheerder" },
      { list_id: "voorraad", person_id: RIK, role: "geen" },
    ],
    [{ list_id: "voorraad", tag_id: "huis" }],
    [
      { tag_id: "huis", person_id: JANA, role: "lid", created_by: JAAN },
      { tag_id: "huis", person_id: RIK, role: "gast", created_by: JAAN },
    ],
  );
  const people = index.people("voorraad", [JAAN, JANA, RIK, "kobe"]);
  assert.deepEqual(people, [
    { person_id: JAAN, role: "beheerder", direct: "beheerder", tag_id: null },
    { person_id: JANA, role: "lid", direct: null, tag_id: "huis" },
    { person_id: RIK, role: null, direct: "geen", tag_id: null },
  ]);
});

test("er blijft altijd een rechtstreekse beheerder", () => {
  assert.ok(keepsAdmin([{ role: "lid" }, { role: "beheerder" }]));
  assert.ok(!keepsAdmin([{ role: "lid" }, { role: "geen" }]));
});

test("lijnen zien en bewaren", () => {
  // Met de gebeurtenis zie je alles.
  assert.ok(lineVisible("bij", "gast", null));
  // Via het item: in, uit en voor, maar nooit bij (de dokter in Winkels en diensten).
  assert.ok(lineVisible("in", null, "gast"));
  assert.ok(lineVisible("voor", null, "lid"));
  assert.ok(!lineVisible("bij", null, "beheerder"));
  assert.ok(!lineVisible("in", null, null));
  // De voorraad veranderen vraagt lid; ergens voor of bij zijn vraagt enkel zien.
  assert.ok(!lineAllowed("in", "gast"));
  assert.ok(lineAllowed("uit", "lid"));
  assert.ok(lineAllowed("bij", "gast"));
  assert.ok(!lineAllowed("voor", null));
  assert.ok(lineAllowed("in", "none"));
});

test("een nieuwe gebeurtenis begint gepland als je erom vraagt of als haar formulier dat doet", () => {
  const boodschap: KindInfo = { ...baseKind("aankoop"), id: "k1", name: "Boodschap", planned: true };
  assert.equal(baseKind("aankoop").planned, false);
  assert.equal(startsPlanned(baseKind("aankoop"), false), false);
  assert.equal(startsPlanned(baseKind("aankoop"), true), true);
  assert.equal(startsPlanned(boodschap, false), true);
});

test("de formulieren van een lijst: die haar invullen, anders alle; de rest onder Ander formulier", () => {
  const form = (id: string, name: string, list: string): KindInfo => ({ ...baseKind("gebruik"), id, name, parts: { ...baseKind("gebruik").parts, groups: [{ role: "uit", label: "Uit", lists: [list] }] } });
  const kinds = [baseKind("aankoop"), form("k1", "Gegeten", "VOORRAAD"), form("k2", "Gewicht", "VOORRAAD"), form("k3", "Proeverij", "WIJN")];
  const ids = (xs: KindInfo[]) => xs.map((k) => k.id);
  const fills = (list: string) => (k: KindInfo) => fillsLists(k).includes(list);
  assert.deepEqual(ids(formsOf(kinds, fills("VOORRAAD")).shown), ["k1", "k2"]);
  assert.deepEqual(ids(formsOf(kinds, fills("VOORRAAD")).more), ["aankoop", "k3"]);
  // Vult niets de lijst in: alle formulieren.
  assert.deepEqual(ids(formsOf(kinds, fills("LEEG")).shown), ["aankoop", "k1", "k2", "k3"]);
  assert.deepEqual(ids(formsOf(kinds, fills("LEEG")).more), []);
  // Hoogstens zes als pillen; de rest zoek je onder Ander formulier.
  const many = Array.from({ length: 9 }, (_, i) => ({ ...kinds[1], id: `f${i}` }));
  assert.deepEqual([ids(formsOf(many, () => false).shown).length, ids(formsOf(many, () => false).more).length], [6, 3]);
  // Wat al gekozen is, staat erbij (een gebeurtenis die je bewerkt) en niet nog eens onderaan.
  const chosen = formsOf(kinds, fills("VOORRAAD"), "aankoop");
  assert.deepEqual(ids(chosen.shown), ["k1", "k2", "aankoop"]);
  assert.ok(!ids(chosen.more).includes("aankoop"));
  assert.deepEqual(ids(formsOf(kinds, fills("VOORRAAD"), "k1").shown), ["k1", "k2"]);
});

test("een gebeurtenis zien: het formulier, en raakt ze lijsten, minstens één ervan", () => {
  // Rik is lid van Gedronken en van de gedeelde kelder, niet van Jaans Wijnen; Jana ziet Uitgaven.
  const rik = { lists: new Map([["kelder", "lid" as const]]), forms: new Map([["gedronken", "lid" as const]]) };
  assert.equal(eventRole(rik, false, "gedronken", ["kelder"]), "lid");
  assert.equal(eventRole(rik, false, "gedronken", ["wijnen"]), null, "een fles uit Jaans Wijnen ziet Rik niet");
  assert.equal(eventRole(rik, false, "gedronken", ["wijnen", "kelder"]), "lid");
  assert.equal(eventRole(rik, false, "gedronken", []), "lid", "zonder lijst volgt het het formulier");
  assert.equal(eventRole(rik, false, "sport", []), null, "zonder het formulier niets");
  const jana = { lists: new Map([["uitgaven", "lid" as const]]), forms: new Map([["aankoop", "lid" as const]]) };
  assert.equal(eventRole(jana, false, "aankoop", ["wijnen", "uitgaven"]), "lid", "een aankoop die haar saldo raakt");
  // Een Aanpassing: de lijst van haar item.
  assert.equal(eventRole(rik, true, "aanpassing", ["kelder"]), "lid");
  assert.equal(eventRole(rik, true, "aanpassing", ["wijnen"]), null);
});

test("een groep lijnen kiest uit bepaalde lijsten (leeg: elke); van vroeger één lijst", () => {
  const parts = cleanParts({ groups: [{ role: "uit", label: "Fles", lists: ["wijnen", "kelder", "wijnen", "../x"] }, { role: "bij", label: "Waar", list: "winkels" }, { role: "voor", label: "Voor" }] })!;
  assert.deepEqual(
    parts.groups.map((g) => [g.role, g.lists]),
    [
      ["uit", ["wijnen", "kelder"]],
      ["bij", ["winkels"]],
      ["voor", []],
    ],
  );
  assert.deepEqual(fillsLists({ parts, does: [] }), ["wijnen", "kelder", "winkels"]);
});

test("groepen: zoveel als je wil, ook met dezelfde rol; een nieuwe rij in een of meer lijsten, haar naam uit een tekstveld", () => {
  const parts = cleanParts({
    groups: [
      { key: "proef", role: "in", label: "Proeverij", lists: ["geproefd"], fresh: true, name: "wijn" },
      { key: "ruimte", role: "voor", label: "Ruimte", lists: ["huis"], one: true },
      { key: "fles", role: "uit", label: "Fles", lists: ["wijnen", "kelder"], fresh: true, name: "wijn" },
      { key: "schilder", role: "voor", label: "Schilder", lists: [] },
      // Een nieuwe rij zonder lijst kan niet.
      { key: "los", role: "in", label: "Los", lists: [], fresh: true },
    ],
  })!;
  assert.deepEqual(
    parts.groups.map((g) => [g.key, g.role, g.fresh ?? false, g.name ?? null, g.one ?? false]),
    [
      ["proef", "in", true, "wijn", true],
      ["ruimte", "voor", false, null, true],
      // Een nieuwe rij in een van meer lijsten (je kiest per lijn); haar naam uit een veld enkel met één lijst.
      ["fles", "uit", true, null, false],
      ["schilder", "voor", false, null, false],
      ["los", "in", false, null, false],
    ],
  );
  // Van vroeger: de rol is de sleutel; een rol die al een groep heeft, krijgt een volgnummer.
  assert.deepEqual(
    cleanParts({ groups: [{ role: "voor", label: "Wagen" }, { role: "voor", label: "Bestuurder" }, { key: "Fout!", role: "bij", label: "Waar" }] })!.groups.map((g) => g.key),
    ["voor", "voor_2", "bij"],
  );
  // De naam komt enkel uit een tekstveld van het formulier; zonder dat veld typ je ze bij de groep.
  assert.equal(fitGroups(parts, [{ key: "wijn", type: "text" }]).groups[0].name, "wijn");
  assert.equal(fitGroups(parts, [{ key: "wijn", type: "number" }]).groups[0].name, undefined);
  // Valt de lijst weg die je niet ziet, dan is het geen nieuwe rij meer.
  assert.equal(fitGroups({ ...parts, groups: [{ ...parts.groups[0], lists: [] }] }, [{ key: "wijn", type: "text" }]).groups[0].fresh, undefined);
  // Bewaren maakt de rij met de naam uit het veld, tenzij de groep al een lijn heeft of het veld leeg is.
  const kind = { parts };
  assert.deepEqual(namedLines(kind, [], { wijn: " Chablis 2022 " }), [
    { role: "in", group: "proef", new_item: { list_id: "geproefd", name: "Chablis 2022" }, amount: null, unit: null, price: null, expires: null, owner: null },
  ]);
  assert.deepEqual(namedLines(kind, ["proef"], { wijn: "Chablis" }), []);
  assert.deepEqual(namedLines(kind, [], { wijn: "  " }), []);
  // Een nieuwe rij met haar naam uit een veld is bij het loggen een schakelaar: `off` begint uit, `on` zegt wat aan staat.
  const three = cleanParts({
    groups: [
      { key: "eigen", role: "in", label: "In Wijnkelder (Jaan)", lists: ["eigen"], fresh: true, name: "wijn" },
      { key: "samen", role: "in", label: "In Wijnkelder (samen)", lists: ["samen"], fresh: true, name: "wijn", off: true },
      { key: "los", role: "in", label: "Los", lists: ["x", "y"], fresh: true, off: true },
    ],
  })!;
  assert.deepEqual(
    three.groups.map((g) => g.off ?? false),
    [false, true, false],
  );
  const wines = { parts: three };
  assert.deepEqual(
    namedLines(wines, [], { wijn: "Chablis" }).map((l) => l.group),
    ["eigen"],
  );
  assert.deepEqual(
    namedLines(wines, [], { wijn: "Chablis" }, ["eigen", "samen"]).map((l) => [l.group, l.new_item.list_id]),
    [
      ["eigen", "eigen"],
      ["samen", "samen"],
    ],
  );
  assert.deepEqual(namedLines(wines, [], { wijn: "Chablis" }, []), []);
  // De groep van een lijn: met haar sleutel, of (van vroeger) haar rol.
  assert.equal(groupOf(kind, { group: "schilder", role: "voor" }).label, "Schilder");
  assert.equal(groupOf(kind, { role: "bij" }).label, "Bij");
});

test("formulieren samenvoegen: velden, groepen en handelingen van beide", () => {
  const kind = (id: string, extra: object = {}) => ({ id, base: "gebruik" as const, name: id, icon: null, fields: [{ key: "score", label: "Score", type: "score" as const }], goal: null, planned: false, parts: null, does: [], notify: null, reads: null, archived: 0 as const, created_by: "jaan", created_at: "", ...extra });
  // Twee Gedronken die hun vertrekpunt volgen: blijft zo.
  const same = mergeKinds(kind("a"), kind("b", { fields: [{ key: "score", label: "Punten", type: "score" }, { key: "notitie", label: "Notitie", type: "longtext" }] }));
  assert.equal(same.parts, null);
  assert.deepEqual(same.fields.map((f) => f.label), ["Score", "Notitie"]);
  // Een fles uit Wijnen en een uit de kelder: één groep uit beide lijsten; uit elke lijst wint.
  const uit = (lists: string[]) => ({ money: false, to: false, duration: false, groups: [{ key: "uit", role: "uit" as const, label: "Fles", lists }] });
  assert.deepEqual(mergeKinds(kind("a", { parts: uit(["wijnen"]) }), kind("b", { parts: uit(["kelder"]) })).parts?.groups, [{ key: "uit", role: "uit", label: "Fles", lists: ["wijnen", "kelder"] }]);
  // Groepen met een andere sleutel blijven elk (ook met dezelfde rol): hun lijnen blijven bij hun groep.
  const other = { money: false, to: false, duration: false, groups: [{ key: "glas", role: "uit" as const, label: "Glas", lists: ["kelder"] }] };
  assert.deepEqual(mergeKinds(kind("a", { parts: uit(["wijnen"]) }), kind("b", { parts: other })).parts?.groups.map((g) => g.key), ["uit", "glas"]);
  assert.deepEqual(mergeKinds(kind("a", { parts: uit(["wijnen"]) }), kind("b")).parts?.groups[0].lists, []);
  // Handelingen één keer.
  const zet = { rows: { from: "lines" as const, group: "uit" }, list: "geproefd", field: "score", op: "zet" as const, value: { from: "field" as const, key: "score" } };
  assert.equal(mergeKinds(kind("a", { does: [zet] }), kind("b", { does: [zet] })).does.length, 1);
});
