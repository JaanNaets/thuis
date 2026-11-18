import assert from "node:assert/strict";
import { test } from "node:test";
import { allDoes, cleanDoes, effectsOf, foldCell, roleDoes, STOCK, touchesCell, type CellEntry, type Handeling, type ListColumns } from "../shared/cells.ts";
import type { FieldDef } from "../shared/fields.ts";

const HUIS: ListColumns = {
  id: "huis",
  name: "Huis",
  stock: false,
  fields: [
    { key: "kleur", label: "Kleur", type: "text" },
    { key: "geschilderd", label: "Geschilderd", type: "date" },
    { key: "lagen", label: "Lagen", type: "number" },
    { key: "som", label: "Som", type: "calc" },
  ],
};
const WIJNEN: ListColumns = { id: "wijnen", name: "Wijnen", stock: true, fields: [{ key: "score", label: "Score", type: "score" }] };
const FORM: FieldDef[] = [
  { key: "kleur", label: "Kleur", type: "text" },
  { key: "lagen", label: "Lagen", type: "number" },
];
const voor = { from: "lines", role: "voor" } as const;
const zetKleur: Handeling = { rows: voor, list: "huis", field: "kleur", op: "zet", value: { from: "field", key: "kleur" } };

test("handelingen nakijken: enkel kolommen van lijsten waar je mag aanpassen, tellen enkel bij getallen", () => {
  assert.deepEqual(cleanDoes([zetKleur], [HUIS], FORM), [zetKleur]);
  assert.deepEqual(cleanDoes(null, [HUIS], FORM), []);
  assert.throws(() => cleanDoes([zetKleur], [WIJNEN], FORM), /lijst/);
  assert.throws(() => cleanDoes([{ ...zetKleur, field: "bestaat_niet" }], [HUIS], FORM), /kolom/);
  assert.throws(() => cleanDoes([{ ...zetKleur, field: "som" }], [HUIS], FORM), /rekent de app/);
  assert.throws(() => cleanDoes([{ ...zetKleur, op: "bij" }], [HUIS], FORM), /getal/);
  assert.throws(() => cleanDoes([{ ...zetKleur, field: "lagen", op: "bij" }], [HUIS], FORM), /geen getal/);
  assert.throws(() => cleanDoes([{ ...zetKleur, field: "geschilderd", value: { from: "field", key: "weg" } }], [HUIS], FORM), /veld van het formulier/);
  assert.throws(() => cleanDoes([{ ...zetKleur, field: "lagen", op: "bij", value: { from: "at" } }], [HUIS], FORM), /datum/);
  // De voorraad: van elke lijst (geen lijst), of van een lijst die telt.
  const stock: Handeling = { rows: { from: "lines", role: "in" }, list: null, field: STOCK, op: "bij", value: { from: "qty" } };
  assert.deepEqual(cleanDoes([stock, { ...stock, list: "wijnen" }], [HUIS, WIJNEN], FORM), [stock, { ...stock, list: "wijnen" }]);
  assert.throws(() => cleanDoes([{ ...stock, list: "huis" }], [HUIS, WIJNEN], FORM), /voorraad/);
  // Een vaste waarde: een getal om te tellen, tekst enkel om te zetten.
  assert.deepEqual(cleanDoes([{ ...zetKleur, field: "lagen", op: "bij", value: { from: "fixed", value: 2 } }], [HUIS], FORM)[0].value, { from: "fixed", value: 2 });
  assert.throws(() => cleanDoes([{ ...zetKleur, field: "lagen", op: "bij", value: { from: "fixed", value: "twee" } }], [HUIS], FORM));
});

const event = (data: Record<string, unknown>, lines: { role: "in" | "uit" | "voor" | "bij"; thing: string; list: string; amount?: number | null; unit?: string; price?: number }[], at = "2026-11-12", amount: number | null = null) => ({
  at,
  amount,
  data: data as never,
  lines: lines.map((l) => ({ role: l.role, thing_id: l.thing, thing_list: l.list, amount: l.amount ?? null, unit: l.unit ?? null, price: l.price ?? null, expires: null })),
});

test("wat een gebeurtenis doet: Schilderwerk zet de kleur en de datum van elke ruimte in de lijn Voor", () => {
  const does: Handeling[] = [zetKleur, { rows: voor, list: "huis", field: "geschilderd", op: "zet", value: { from: "at" } }];
  const effects = effectsOf(does, event({ kleur: "Country Linen" }, [{ role: "voor", thing: "keuken", list: "huis" }, { role: "voor", thing: "living", list: "huis" }, { role: "bij", thing: "schilder", list: "winkels" }]));
  assert.deepEqual(
    effects.map((e) => [e.thing_id, e.field, e.op, e.val ?? e.num]),
    [
      ["keuken", "kleur", "zet", "Country Linen"],
      ["living", "kleur", "zet", "Country Linen"],
      ["keuken", "geschilderd", "zet", "2026-11-12"],
      ["living", "geschilderd", "zet", "2026-11-12"],
    ],
  );
  // Een leeg veld wist niets; een ding in een andere lijst raakt de handeling niet.
  assert.deepEqual(effectsOf([zetKleur], event({}, [{ role: "voor", thing: "keuken", list: "huis" }])), []);
  assert.deepEqual(effectsOf([zetKleur], event({ kleur: "Wit" }, [{ role: "voor", thing: "fiat", list: "wagens" }])), []);
});

test("de voorraad: Toevoegen telt bij, Weghalen telt af, een telling zet; met hoeveel en eenheid", () => {
  assert.deepEqual(allDoes({ id: "k", base: "dienst", does: [zetKleur] }), [...roleDoes("dienst"), zetKleur]);
  const buy = effectsOf(allDoes({ id: "aankoop", base: "aankoop", does: [] }), event({}, [{ role: "in", thing: "chablis", list: "wijnen", amount: 6, unit: "fles" }, { role: "bij", thing: "colruyt", list: "winkels" }]));
  assert.deepEqual(buy.map((e) => [e.thing_id, e.field, e.op, e.num, e.unit]), [["chablis", STOCK, "bij", 6, "fles"]]);
  const count = effectsOf(allDoes({ id: "meting", base: "meting", does: [] }), event({}, [{ role: "voor", thing: "chablis", list: "wijnen", amount: 4 }, { role: "voor", thing: "jaan", list: "mensen" }]));
  // Een telling zonder hoeveelheid zegt niets.
  assert.deepEqual(count.map((e) => [e.thing_id, e.op, e.num]), [["chablis", "zet", 4]]);
});

test("een Aanpassing zet elk ingevuld veld op het ding (leeg wist)", () => {
  const effects = effectsOf(allDoes({ id: "aanpassing", base: "meting", does: [] }), event({ kleur: "Wit", lagen: 2, oud: "" }, [{ role: "voor", thing: "keuken", list: "huis" }]));
  assert.deepEqual(
    effects.map((e) => [e.field, e.val, e.num]),
    [
      ["kleur", "Wit", null],
      ["lagen", 2, 2],
      ["oud", null, null],
    ],
  );
});

const entry = (at: string, op: CellEntry["op"], v: number | string | null, i = 0): CellEntry => ({
  op,
  num: typeof v === "number" ? v : null,
  val: typeof v === "string" ? v : null,
  unit: null,
  expires: null,
  at,
  created_at: `2026-01-01 00:00:0${i}`,
  position: 0,
  event_id: `e${at}${i}`,
});

test("de waarde van een cel: de laatste Zet plus wat er daarna bij en af ging, in volgorde van de datum", () => {
  // In eender welke volgorde bewaard; wat er in het ding stond, is het begin.
  const km = foldCell([entry("2026-11-03", "bij", 120), entry("2026-11-01", "zet", 52000), entry("2026-11-02", "bij", 80.5)], 50000);
  assert.deepEqual(km, { value: 52200.5, from: "e2026-11-030" });
  assert.deepEqual(foldCell([entry("2026-11-02", "af", 1)], 6), { value: 5, from: "e2026-11-020" });
  // Een latere Zet wist wat ervoor kwam; leeg zetten wist de cel.
  assert.equal(foldCell([entry("2026-11-01", "bij", 3), entry("2026-11-05", "zet", "Wit")], undefined).value, "Wit");
  assert.equal(foldCell([entry("2026-11-05", "zet", null)], "Rood").value, undefined);
  // Zonder veranderingen: wat er stond.
  assert.deepEqual(foldCell([], "Rood"), { value: "Rood", from: null });
  // Geen kommagetallen-ruis.
  assert.equal(foldCell([entry("2026-11-01", "bij", 0.1), entry("2026-11-02", "bij", 0.2)], 0).value, 0.3);
});

test("wie bewaart, moet de lijst mogen wijzigen als het formulier daar een kolom invult", () => {
  const does = allDoes({ id: "k", base: "dienst", does: [zetKleur] });
  assert.equal(touchesCell(does, "voor", "huis", false), true);
  assert.equal(touchesCell(does, "voor", "winkels", false), false);
  assert.equal(touchesCell(does, "bij", "huis", false), false);
  // Toevoegen telt enkel in een lijst die voorraad telt.
  assert.equal(touchesCell(does, "in", "wijnen", true), true);
  assert.equal(touchesCell(does, "in", "huis", false), false);
  // Een Aanpassing raakt elke kolom van het ding.
  assert.equal(touchesCell(allDoes({ id: "aanpassing", base: "meting", does: [] }), "voor", "huis", false), true);
});
