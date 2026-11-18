import assert from "node:assert/strict";
import { test } from "node:test";
import { baseKind, brusselsNow, eventTitle, fillsLists, formsOf, isAt, minutesBetween, startsPlanned, type KindInfo } from "../shared/model.ts";
import { keepsAdmin, lineAllowed, lineVisible, rolesFor, Roles } from "../shared/rights.ts";

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
  const form = (id: string, name: string, list: string): KindInfo => ({ ...baseKind("gebruik"), id, name, parts: { ...baseKind("gebruik").parts, groups: [{ role: "uit", label: "Uit", list }] } });
  const kinds = [baseKind("aankoop"), form("k1", "Gegeten", "VOORRAAD"), form("k2", "Gewicht", "VOORRAAD"), form("k3", "Proeverij", "WIJN")];
  const ids = (xs: KindInfo[]) => xs.map((k) => k.id);
  const fills = (list: string) => (k: KindInfo) => fillsLists(k).includes(list);
  assert.deepEqual(ids(formsOf(kinds, fills("VOORRAAD")).shown), ["k1", "k2"]);
  assert.deepEqual(ids(formsOf(kinds, fills("VOORRAAD")).more), ["aankoop", "k3"]);
  // Vult niets de lijst in: alle formulieren.
  assert.deepEqual(ids(formsOf(kinds, fills("LEEG")).shown), ["aankoop", "k1", "k2", "k3"]);
  assert.deepEqual(ids(formsOf(kinds, fills("LEEG")).more), []);
  // Wat al gekozen is, staat erbij (een gebeurtenis die je bewerkt) en niet nog eens onderaan.
  const chosen = formsOf(kinds, fills("VOORRAAD"), "aankoop");
  assert.deepEqual(ids(chosen.shown), ["k1", "k2", "aankoop"]);
  assert.ok(!ids(chosen.more).includes("aankoop"));
  assert.deepEqual(ids(formsOf(kinds, fills("VOORRAAD"), "k1").shown), ["k1", "k2"]);
});
