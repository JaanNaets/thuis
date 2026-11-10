// Stap voor stap invullen in het palet (shared/steps.ts): welke velden, wat je typte als waarde, de suggesties en wat er
// bewaard wordt, zoals het volledige formulier het zou doen.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldDef } from "../shared/fields.ts";
import { baseKind, type KindInfo } from "../shared/model.ts";
import { canStep, eventBody, eventSteps, memoryOf, prefillOf, readStep, stepSuggestions, thingBody, thingSteps } from "../shared/steps.ts";

const uitEten: KindInfo = {
  ...baseKind("dienst"),
  id: "uiteten",
  name: "Uit eten",
  list_id: "RESTAURANTS",
  fields: [
    { key: "score", label: "Score", type: "score" },
    { key: "gegeten", label: "Wat ik at", type: "text" },
    { key: "foto", label: "Bon", type: "checklist" },
  ],
};
const aankoop: KindInfo = { ...baseKind("aankoop"), id: "aankoop-u", name: "Aankoop", list_id: "UITGAVEN" };
const boodschap: KindInfo = { ...aankoop, id: "boodschap", name: "Boodschap", planned: true };
const ctx = { today: "2026-11-11", people: [{ id: "jaan", name: "Jaan" }, { id: "jana", name: "Jana" }] };

test("welke stappen: hoeveel bij voorraad, de velden in één regel, een bedrag bij geld", () => {
  // Uit eten bij Het Forum: geen hoeveel (het restaurant komt er niet bij), de takenlijst niet, wel een bedrag.
  assert.deepEqual(eventSteps(uitEten, { unit: null }).map((s) => s.label), ["Score", "Wat ik at", "Bedrag"]);
  // Een aankoop van een wijn: hoeveel (in flessen) en het bedrag; een boodschap enkel hoeveel.
  assert.deepEqual(eventSteps(aankoop, { unit: "fles" }).map((s) => [s.label, s.type === "qty" ? s.unit : null]), [["Hoeveel", "fles"], ["Bedrag", null]]);
  assert.deepEqual(eventSteps(boodschap, { unit: "l" }).map((s) => s.label), ["Hoeveel"]);
  // Een activiteit (loopt als timer) en een overdracht (naar wie) gaan naar het volledige formulier.
  assert.ok(canStep(uitEten));
  assert.ok(!canStep(baseKind("activiteit")));
  assert.ok(!canStep(baseKind("overdracht")));
  assert.ok(!canStep(null));
});

test("een nieuw ding: de naam als je die nog niet typte, dan de verplichte velden en de kolommen", () => {
  const fields: FieldDef[] = [
    { key: "keuken", label: "Keuken", type: "select", options: ["Belgisch", "Frans"], column: true },
    { key: "gemeente", label: "Gemeente", type: "text", column: true },
    { key: "website", label: "Website", type: "url" },
    { key: "telefoon", label: "Telefoon", type: "phone", required: true },
  ];
  assert.deepEqual(thingSteps(fields, true).map((s) => s.label), ["Keuken", "Gemeente", "Telefoon"]);
  assert.deepEqual(thingSteps(fields, false).map((s) => s.label), ["Naam", "Keuken", "Gemeente", "Telefoon"]);
});

test("wat je typt: dezelfde lezer als het formulier, leeg is overslaan", () => {
  const [score, gegeten] = eventSteps(uitEten);
  assert.deepEqual(readStep(score, "4", ctx), { value: 4 });
  assert.deepEqual(readStep(score, "17/20", ctx), { value: 4.5 }); // halve sterren, zoals in het formulier
  assert.deepEqual(readStep(score, "", ctx), { skip: true });
  assert.ok("error" in readStep(score, "lekker", ctx));
  assert.deepEqual(readStep(gegeten, " Steak ", ctx), { value: "Steak" });
  const [qty, bedrag] = eventSteps(aankoop, { unit: "fles" });
  assert.deepEqual(readStep(qty, "6", ctx), { value: 6 });
  assert.deepEqual(readStep(qty, "1,5 kg", ctx), { value: 1.5 });
  assert.deepEqual(readStep(bedrag, "€ 54,50", ctx), { value: 5450 });
  const keuken = { key: "keuken", label: "Keuken", type: "field", def: { key: "keuken", label: "Keuken", type: "select", options: ["Belgisch", "Frans"] } } as const;
  assert.deepEqual(readStep(keuken, "fr", ctx), { value: "Frans" });
  assert.ok("error" in readStep(keuken, "Thais", ctx));
  const op = { key: "op", label: "Op", type: "field", def: { key: "op", label: "Op", type: "date" } } as const;
  assert.deepEqual(readStep(op, "gisteren", ctx), { value: "2026-11-10" });
  assert.deepEqual(readStep(op, "3/11/2026", ctx), { value: "2026-11-03" });
  const wie = { key: "wie", label: "Wie", type: "field", def: { key: "wie", label: "Wie", type: "person" } } as const;
  assert.deepEqual(readStep(wie, "jan", ctx), { value: "jana" });
});

test("suggesties: de keuzes, sterren, en wat je eerder invulde (het vaakst eerst)", () => {
  const [score, gegeten] = eventSteps(uitEten);
  assert.deepEqual(stepSuggestions(score, { people: [], memory: [] }).map((s) => [s.label, s.text]), [["★", "1"], ["★★", "2"], ["★★★", "3"], ["★★★★", "4"], ["★★★★★", "5"]]);
  const memory = memoryOf([{ gegeten: "Steak" }, { gegeten: "Stoofvlees" }, { gegeten: "Steak" }, {}], "gegeten");
  assert.deepEqual(memory, ["Steak", "Stoofvlees"]);
  assert.deepEqual(stepSuggestions(gegeten, { people: [], memory }).map((s) => s.text), ["Steak", "Stoofvlees"]);
});

test("bewaren zoals het formulier: vandaag, het ding als lijn, jij betaalt, gelijk verdeeld waar meer mensen loggen", () => {
  const steps = eventSteps(aankoop, { unit: "fles" });
  const people = [
    { id: "jaan", role: "beheerder" as const },
    { id: "jana", role: "lid" as const },
  ];
  const body = eventBody(aankoop, steps, { $qty: 6, $amount: 5400 }, { thing: { id: "CHABLIS", unit: "fles" }, me: "jaan", people, today: "2026-11-11" });
  assert.equal(body.status, "gebeurd");
  assert.equal(body.at, "2026-11-11");
  assert.equal(body.amount, 5400);
  assert.equal(body.paid_by, "jaan");
  assert.deepEqual(body.split?.map((s) => s.person_id), ["jaan", "jana"]);
  assert.deepEqual(body.lines, [{ role: "in", thing_id: "CHABLIS", amount: 6, unit: "fles", price: 5400, expires: null, owner: null }]);
  // Een boodschap begint gepland en heeft geen geld; Uit eten zet de velden en het restaurant als lijn.
  assert.equal(eventBody(boodschap, eventSteps(boodschap, { unit: null }), {}, { thing: { id: "MELK", unit: null }, me: "jaan", people, today: "2026-11-11" }).status, "gepland");
  const eten = eventBody(uitEten, eventSteps(uitEten, { unit: null }), { score: 4, gegeten: "Steak" }, { thing: { id: "FORUM", unit: null }, me: "jaan", people: [people[0]], today: "2026-11-11" });
  assert.deepEqual(eten.data, { score: 4, gegeten: "Steak" });
  assert.equal(eten.split, null);
  assert.deepEqual(eten.lines.map((l) => [l.role, l.thing_id, l.price]), [["voor", "FORUM", null]]);
});

test("een nieuw ding en Alles invullen: wat je al invulde gaat mee", () => {
  const fields: FieldDef[] = [{ key: "gemeente", label: "Gemeente", type: "text", column: true }];
  const steps = thingSteps(fields, false);
  assert.deepEqual(thingBody("", steps, { $name: "Het Forum", gemeente: "Geel" }), { name: "Het Forum", data: { gemeente: "Geel" } });
  assert.deepEqual(thingBody("Foru", thingSteps(fields, true), {}), { name: "Foru", data: {} });
  assert.deepEqual(prefillOf(eventSteps(aankoop, { unit: "fles" }), { $qty: 6, $amount: 5400 }), { $qty: 6, $amount: 5400 });
});
