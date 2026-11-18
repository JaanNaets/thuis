import assert from "node:assert/strict";
import { test } from "node:test";
import { ADJUST_DOES, BALANCE, cleanDoes, effectsOf, foldCell, presetDoes, STOCK, touchesCell, type CellEntry, type Handeling, type ListColumns } from "../shared/cells.ts";
import type { FieldDef } from "../shared/fields.ts";
import { settleUp } from "../shared/ledger.ts";
import { baseKind, kindInfo } from "../shared/model.ts";

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

const event = (data: Record<string, unknown>, lines: { role: "in" | "uit" | "voor" | "bij"; item: string; list: string; amount?: number | null; unit?: string; price?: number }[], at = "2026-11-12", amount: number | null = null) => ({
  list_id: "uitgaven",
  at,
  amount,
  data: data as never,
  lines: lines.map((l) => ({ role: l.role, item_id: l.item, item_list: l.list, amount: l.amount ?? null, unit: l.unit ?? null, price: l.price ?? null, expires: null })),
});

test("wat een gebeurtenis doet: Schilderwerk zet de kleur en de datum van elke ruimte in de lijn Voor", () => {
  const does: Handeling[] = [zetKleur, { rows: voor, list: "huis", field: "geschilderd", op: "zet", value: { from: "at" } }];
  const effects = effectsOf(does, event({ kleur: "Country Linen" }, [{ role: "voor", item: "keuken", list: "huis" }, { role: "voor", item: "living", list: "huis" }, { role: "bij", item: "schilder", list: "winkels" }]));
  assert.deepEqual(
    effects.map((e) => [e.item_id, e.field, e.op, e.val ?? e.num]),
    [
      ["keuken", "kleur", "zet", "Country Linen"],
      ["living", "kleur", "zet", "Country Linen"],
      ["keuken", "geschilderd", "zet", "2026-11-12"],
      ["living", "geschilderd", "zet", "2026-11-12"],
    ],
  );
  // Een leeg veld wist niets; een item in een andere lijst raakt de handeling niet.
  assert.deepEqual(effectsOf([zetKleur], event({}, [{ role: "voor", item: "keuken", list: "huis" }])), []);
  assert.deepEqual(effectsOf([zetKleur], event({ kleur: "Wit" }, [{ role: "voor", item: "fiat", list: "wagens" }])), []);
});

test("de voorraad: Toevoegen telt bij, Weghalen telt af, een telling zet; met hoeveel en eenheid", () => {
  // Een formulier zonder eigen onderdelen doet wat zijn vertrekpunt doet, plus zijn eigen handelingen.
  const own = kindInfo({ id: "k", list_id: "huis", base: "dienst", name: "Schilderwerk", icon: null, fields: [], goal: null, planned: false, parts: null, does: [zetKleur], sort_order: 0 });
  assert.deepEqual(own.does, [...presetDoes("dienst"), zetKleur]);
  // Met eigen onderdelen enkel wat erin staat.
  assert.deepEqual(kindInfo({ ...own, list_id: "huis", icon: null, sort_order: 0, parts: own.parts, does: [zetKleur] }).does, [zetKleur]);
  const buy = effectsOf(baseKind("aankoop").does, event({}, [{ role: "in", item: "chablis", list: "wijnen", amount: 6, unit: "fles" }, { role: "bij", item: "colruyt", list: "winkels" }]));
  assert.deepEqual(buy.map((e) => [e.item_id, e.field, e.op, e.num, e.unit]), [["chablis", STOCK, "bij", 6, "fles"]]);
  const count = effectsOf(baseKind("meting").does, event({}, [{ role: "voor", item: "chablis", list: "wijnen", amount: 4 }, { role: "voor", item: "jaan", list: "mensen" }]));
  // Een telling zonder hoeveelheid zegt niets.
  assert.deepEqual(count.map((e) => [e.item_id, e.op, e.num]), [["chablis", "zet", 4]]);
});

test("een Aanpassing zet elk ingevuld veld op het item (leeg wist)", () => {
  const effects = effectsOf(ADJUST_DOES, event({ kleur: "Wit", lagen: 2, oud: "" }, [{ role: "voor", item: "keuken", list: "huis" }]));
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
  // In eender welke volgorde bewaard; wat er in het item stond, is het begin.
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
  const does = [...presetDoes("aankoop"), zetKleur];
  assert.equal(touchesCell(does, "voor", "huis", false), true);
  assert.equal(touchesCell(does, "voor", "winkels", false), false);
  assert.equal(touchesCell(does, "bij", "huis", false), false);
  // Toevoegen telt enkel in een lijst die voorraad telt.
  assert.equal(touchesCell(does, "in", "wijnen", true), true);
  assert.equal(touchesCell(does, "in", "huis", false), false);
  // Een Aanpassing raakt elke kolom van het item.
  assert.equal(touchesCell(ADJUST_DOES, "voor", "huis", false), true);
});

test("geld als cellen: wie betaalde telt het bedrag bij, wie deelt zijn deel af, een overdracht zet recht", () => {
  const ledgers = new Map([["uitgaven", { field: "saldo", rows: new Map([["jaan", "rij-jaan"], ["jana", "rij-jana"]]) }]]);
  const half = [
    { person_id: "jaan", share: 50 },
    { person_id: "jana", share: 50 },
  ];
  const money = (o: object) => ({ ...event({}, []), ...o });
  const saldo = (events: object[], does = presetDoes("aankoop", "uitgaven")) => {
    const all = events.flatMap((e, i) => effectsOf(does, money(e), ledgers).map((f) => ({ ...f, at: `2026-11-0${i + 1}`, created_at: "", position: 0, event_id: `e${i}` })));
    return new Map(["rij-jaan", "rij-jana"].map((r) => [r, foldCell(all.filter((f) => f.item_id === r), undefined).value ?? 0]));
  };
  // Jaan betaalt 46 euro, Jana 20, samen gedeeld; iets van Jaan alleen telt niet mee; een lijn van Jaan alleen is van hem.
  const net = saldo([
    { amount: 4600, paid_by: "jaan", split: half },
    { amount: 2000, paid_by: "jana", split: half },
    { amount: 9900, paid_by: "jaan" },
    { amount: 1000, paid_by: "jana", split: half, lines: [{ role: "in", item_id: null, item_list: null, amount: null, unit: null, price: 400, expires: null, owner: "jaan" }] },
  ]);
  // Jaan: +4600 −2300 −1000 (deel) +9900 −9900 −400 −300 = 600; Jana: −2300 +2000 −1000 +1000 −300 = −600.
  assert.deepEqual([...net], [
    ["rij-jaan", 600],
    ["rij-jana", -600],
  ]);
  assert.deepEqual(settleUp(new Map([["jaan", net.get("rij-jaan") as number], ["jana", net.get("rij-jana") as number]])), [{ from: "jana", to: "jaan", amount: 600 }]);
  // Jana betaalt terug: alles in orde.
  const back = effectsOf(presetDoes("overdracht", "uitgaven"), money({ amount: 600, paid_by: "jana", to_person: "jaan" }), ledgers);
  assert.deepEqual(back.map((f) => [f.item_id, f.field, f.op, f.num]), [
    ["rij-jana", "saldo", "bij", 600],
    ["rij-jaan", "saldo", "af", 600],
  ]);
  // Zonder betaler, zonder lijst met een saldo, of in een lijst zonder saldo per persoon: niets.
  assert.deepEqual(effectsOf(presetDoes("aankoop", "uitgaven"), money({ amount: 1000, split: half }), ledgers), []);
  assert.deepEqual(effectsOf(presetDoes("aankoop"), money({ amount: 1000, paid_by: "jaan", split: half }), ledgers), []);
  assert.deepEqual(effectsOf(presetDoes("aankoop", "wijnen"), money({ amount: 1000, paid_by: "jaan", split: half }), ledgers), []);
});

test("geld nakijken: een saldo hoort bij een persoon, in een lijst met een saldo per persoon", () => {
  const uitgaven: ListColumns = { id: "uitgaven", name: "Uitgaven", stock: false, ledger: true, fields: [{ key: "saldo", label: "Saldo", type: "money" }] };
  const payer: Handeling = { rows: { from: "payer" }, list: "uitgaven", field: BALANCE, op: "bij", value: { from: "amount" } };
  assert.deepEqual(cleanDoes([payer], [uitgaven], []), [payer]);
  // Een formulier hoort bij geen lijst: het saldo staat altijd in een gekozen lijst.
  assert.throws(() => cleanDoes([{ ...payer, list: null }], [uitgaven], []), /saldo/);
  assert.throws(() => cleanDoes([{ ...payer, list: "huis" }], [uitgaven, HUIS], []), /saldo/);
  assert.throws(() => cleanDoes([{ ...payer, field: STOCK }], [uitgaven], []), /voorraad/);
  assert.throws(() => cleanDoes([{ ...payer, rows: voor }], [uitgaven], []), /persoon/);
  assert.throws(() => cleanDoes([{ ...payer, value: { from: "qty" } }], [uitgaven], []), /bedrag/);
});
