// Cellen: de kolommen van een item die het logboek invult (Zet, Tel bij, Tel af).
//
// Een formulier zegt wat het doet met **handelingen** (`does` op een soort): per handeling welke rijen (de items van
// een groep lijnen: Voor, Bij, Toevoegen of Weghalen), welke kolom (een veld van hun lijst, of hun voorraad), hoe (Zet
// op, Tel bij, Tel af) en met wat (een veld van het formulier, de datum, het bedrag, de hoeveelheid of de prijs van de
// lijn, of een vaste waarde). Schilderwerk zet de Kleur van de Ruimte; een Tankbeurt zet de Km-stand van de Wagen.
//
// Bij het bewaren rekent de Worker uit wat een gebeurtenis zo doet (`effectsOf`, de tabel `effects`: afgeleid, altijd
// opnieuw op te bouwen uit de gebeurtenissen en hun formulieren). De waarde van een cel is wat in het item stond, of
// de laatste Zet, plus wat er daarna bij en af ging, in volgorde van de datum en enkel wat gebeurd is (`foldCell`).
// Zo verbetert een gebeurtenis die je aanpast of verwijdert de lijst vanzelf. Een cel die het logboek invult, pas je
// in het item aan met een Aanpassing: een gebeurtenis die de nieuwe waarde zet (`ADJUST`).
//
// De voorraad is zo'n cel (`STOCK`): een aankoop telt bij, gebruik telt af en een telling zet, omgerekend naar de
// eenheid van het item (shared/stock.ts). Geld ook (`BALANCE`): in een lijst met een saldo per persoon (`ledger`) telt
// wie betaalde het bedrag bij, wie deelt zijn deel af, en wie een overdracht krijgt het bedrag af (Wie moet wie).
// Wat een vertrekpunt (Aankoop, Gebruik, …) doet, staat in `presetDoes`.

import type { Attributes, FieldDef, FieldValue, Share } from "./fields.ts";
import { sharesOf } from "./ledger.ts";
import type { LineRole } from "./model.ts";

// ---------- handelingen ----------

export type Op = "zet" | "bij" | "af";
export const OPS: Record<Op, { label: string }> = {
  zet: { label: "Zet op" },
  bij: { label: "Tel bij" },
  af: { label: "Tel af" },
};
export const isOp = (v: unknown): v is Op => typeof v === "string" && Object.hasOwn(OPS, v);

/** De voorraad van het item: de kolom die zijn lijst telt (zie `stock` op een lijst), in eender welke lijst. */
export const STOCK = "$voorraad";
/** Het saldo van een persoon: de kolom van de lijst met een saldo per persoon (`ledger`; geen lijst: die van de gebeurtenis). */
export const BALANCE = "$saldo";
/** Elk ingevuld veld van de gebeurtenis op de kolom met dezelfde sleutel (enkel voor een Aanpassing). */
export const EACH = "*";

/**
 * Welke rijen een handeling raakt: de items van de lijnen met deze rol, of de rij van een persoon in een lijst met een
 * saldo per persoon: wie betaalde, wie deelt (elk met zijn deel) of naar wie het gaat.
 */
export type Rows = { from: "lines"; role: LineRole } | { from: "payer" } | { from: "sharers" } | { from: "to" };
export type PersonRows = Exclude<Rows["from"], "lines">;
export const PERSON_ROWS: Record<PersonRows, { label: string }> = {
  payer: { label: "Wie betaalde" },
  sharers: { label: "Wie deelt" },
  to: { label: "Naar wie" },
};
const isPersonRows = (v: unknown): v is PersonRows => typeof v === "string" && Object.hasOwn(PERSON_ROWS, v);

/** Waar de waarde vandaan komt. */
export type Value =
  | { from: "qty" }
  | { from: "price" }
  | { from: "amount" }
  | { from: "at" }
  | { from: "field"; key: string }
  | { from: "fixed"; value: number | string };
export type ValueFrom = Value["from"];
export const VALUE_FROM: Record<ValueFrom, { label: string }> = {
  field: { label: "Een veld" },
  at: { label: "De datum" },
  qty: { label: "Hoeveel" },
  price: { label: "De prijs" },
  amount: { label: "Het bedrag" },
  fixed: { label: "Een vaste waarde" },
};
/** Waarmee een handeling op de rij van een persoon kan: het bedrag (bij wie deelt: zijn deel), een veld of een vaste waarde. */
export const PERSON_VALUES: ValueFrom[] = ["amount", "field", "fixed"];

/** Eén handeling: wat een formulier met een kolom van de items van een groep lijnen (of van personen) doet. */
export type Handeling = {
  rows: Rows;
  /**
   * Enkel items in deze lijst (en dan is `field` een veld van die lijst). Null enkel met `STOCK` (elke lijst) of
   * `BALANCE` (de lijst van de gebeurtenis).
   */
  list: string | null;
  field: string;
  op: Op;
  value: Value;
};

export const MAX_DOES = 20;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ROLES: LineRole[] = ["in", "uit", "voor", "bij"];

/** Getallen waarmee je kan tellen (Tel bij, Tel af). */
export const COUNTABLE: FieldDef["type"][] = ["number", "money", "duration", "score", "year"];

/** Wat een lijst kent: haar velden, of ze voorraad telt en een saldo per persoon bijhoudt (om handelingen na te kijken en te tonen). */
export type ListColumns = { id: string; name: string; stock: boolean; ledger?: boolean; fields: Pick<FieldDef, "key" | "label" | "type" | "unit">[] };

/**
 * Handelingen van buiten nakijken. `lists`: de lijsten waarin jij items mag aanpassen (lid of beheerder), met hun
 * velden; `fields`: de velden van het formulier. Gooit een fout met uitleg.
 */
export function cleanDoes(raw: unknown, lists: ListColumns[], fields: FieldDef[]): Handeling[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("Wat het formulier doet, klopt niet");
  if (raw.length > MAX_DOES) throw new Error(`Hoogstens ${MAX_DOES} handelingen per formulier`);
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const from = ((o.rows ?? {}) as Record<string, unknown>).from;
    const role = ((o.rows ?? {}) as Record<string, unknown>).role;
    const person = isPersonRows(from);
    if (!person && !(from === "lines" && ROLES.includes(role as LineRole))) throw new Error("Kies welke items het formulier aanpast");
    const rows: Rows = person ? { from } : { from: "lines", role: role as LineRole };
    if (!isOp(o.op)) throw new Error("Kies wat het formulier doet");
    const field = typeof o.field === "string" ? o.field : "";
    let list: string | null = null;
    let type: FieldDef["type"] | "stock";
    if (field === STOCK) {
      if (person) throw new Error("Een persoon heeft geen voorraad");
      type = "stock";
      if (typeof o.list === "string" && o.list) {
        const l = lists.find((x) => x.id === o.list);
        if (!l || !l.stock) throw new Error("Die lijst telt geen voorraad, of je mag er niets aanpassen");
        list = l.id;
      }
    } else if (field === BALANCE) {
      if (!person) throw new Error("Een saldo hoort bij een persoon");
      type = "money";
      const l = lists.find((x) => x.id === o.list);
      if (!l || !l.ledger) throw new Error("Kies een lijst met een saldo per persoon waarin je mag aanpassen");
      list = l.id;
    } else {
      const l = lists.find((x) => x.id === o.list);
      if (!l) throw new Error("Kies een lijst waarin je mag aanpassen");
      if (person && !l.ledger) throw new Error(`${l.name} houdt geen saldo per persoon bij`);
      const f = KEY_RE.test(field) ? l.fields.find((x) => x.key === field) : undefined;
      if (!f) throw new Error(`Kies een kolom van ${l.name}`);
      if (f.type === "calc") throw new Error(`${f.label} rekent de app zelf uit`);
      list = l.id;
      type = f.type;
    }
    if (o.op !== "zet" && type !== "stock" && !COUNTABLE.includes(type)) throw new Error("Tellen kan enkel bij een getal");
    const value = cleanValue(o.value, fields, o.op);
    if (person && !PERSON_VALUES.includes(value.from)) throw new Error("Bij een persoon tel je met het bedrag, een veld of een vaste waarde");
    return { rows, list, field, op: o.op, value };
  });
}

function cleanValue(raw: unknown, fields: FieldDef[], op: Op): Value {
  const v = (raw ?? {}) as Record<string, unknown>;
  switch (v.from) {
    case "qty":
    case "price":
    case "amount":
      return { from: v.from };
    case "at":
      if (op !== "zet") throw new Error("Een datum kan je enkel zetten");
      return { from: "at" };
    case "field": {
      const f = fields.find((x) => x.key === v.key);
      if (!f) throw new Error("Kies een veld van het formulier");
      if (op !== "zet" && !COUNTABLE.includes(f.type)) throw new Error(`${f.label} is geen getal om mee te tellen`);
      return { from: "field", key: f.key };
    }
    case "fixed":
      if (typeof v.value === "number" && Number.isFinite(v.value)) return { from: "fixed", value: v.value };
      if (typeof v.value === "string" && v.value.trim() && op === "zet") return { from: "fixed", value: v.value.trim().slice(0, 200) };
      throw new Error("Vul de vaste waarde in");
    default:
      throw new Error("Kies waarmee het formulier aanpast");
  }
}

/**
 * Wat een vertrekpunt doet (een nieuw formulier begint ermee; een formulier zonder eigen onderdelen doet het ook).
 * `ledger`: de lijst met een saldo per persoon waar het geld komt; zonder die lijst houdt het geen saldo bij.
 */
export function presetDoes(base: string, ledger: string | null = null): Handeling[] {
  const qty: Value = { from: "qty" };
  const amount: Value = { from: "amount" };
  const lines = (role: LineRole, op: Op): Handeling => ({ rows: { from: "lines", role }, list: null, field: STOCK, op, value: qty });
  const money = (from: PersonRows, op: Op): Handeling[] => (ledger ? [{ rows: { from }, list: ledger, field: BALANCE, op, value: amount }] : []);
  switch (base) {
    case "aankoop":
      return [lines("in", "bij"), ...money("payer", "bij"), ...money("sharers", "af")];
    case "gebruik":
      return [lines("uit", "af")];
    case "dienst":
      return [...money("payer", "bij"), ...money("sharers", "af")];
    case "meting":
      return [lines("voor", "zet")];
    case "overdracht":
      return [...money("payer", "bij"), ...money("to", "af")];
    default:
      return [];
  }
}

/**
 * Het formulier waarmee je een cel rechtstreeks aanpast (in het item): het zet elk ingevuld veld op dat item, en een
 * hoeveelheid zet zijn voorraad (− en + in een lijst die telt).
 */
export const ADJUST = "aanpassing";
export const ADJUST_DOES: Handeling[] = [
  { rows: { from: "lines", role: "voor" }, list: null, field: EACH, op: "zet", value: { from: "field", key: EACH } },
  { rows: { from: "lines", role: "voor" }, list: null, field: STOCK, op: "zet", value: { from: "qty" } },
];

/**
 * Raakt een lijn met deze rol een cel van een item in deze lijst? Dan moet wie bewaart die lijst mogen wijzigen.
 * `counts`: de lijst telt voorraad.
 */
export function touchesCell(does: Handeling[], role: LineRole, list: string, counts: boolean): boolean {
  return does.some((h) => h.rows.from === "lines" && h.rows.role === role && (h.field === STOCK ? counts && (!h.list || h.list === list) : h.list === list || h.field === EACH));
}

/** Wat lijnen met deze rol met de voorraad van hun item doen (Tel bij, Tel af, Zet), of niets. */
export const stockOp = (does: Handeling[], role: LineRole): Op | null =>
  does.find((h) => h.rows.from === "lines" && h.rows.role === role && h.field === STOCK)?.op ?? null;

/** In welke lijsten een formulier een saldo bijhoudt (handelingen op personen). */
export const ledgerLists = (does: Handeling[]): string[] => [...new Set(does.flatMap((h) => (h.rows.from !== "lines" && h.list ? [h.list] : [])))];

// ---------- wat een gebeurtenis doet ----------

/** Eén verandering van een cel door een gebeurtenis. */
export type Effect = {
  item_id: string;
  /** Een veld van de lijst van het item, of `STOCK`. */
  field: string;
  op: Op;
  /** Een getal (tellen, of een getal zetten); bij de voorraad: hoeveel (leeg = één, of één verpakking). */
  num: number | null;
  /** Wat er gezet wordt als het geen getal is. */
  val: FieldValue | null;
  unit: string | null;
  expires: string | null;
};

export type EffectLine = {
  role: LineRole;
  item_id: string | null;
  /** De lijst van het item. */
  item_list: string | null;
  amount: number | null;
  unit: string | null;
  price: number | null;
  expires: string | null;
  owner?: string | null;
};

export type EffectEvent = {
  at: string;
  amount: number | null;
  data: Attributes;
  lines: EffectLine[];
  paid_by?: string | null;
  split?: Share[] | null;
  to_person?: string | null;
  created_by?: string;
};

/** Een lijst met een saldo per persoon: haar saldokolom en de rij van elke persoon. */
export type Ledger = { field: string; rows: Map<string, string> };

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Wie een handeling op personen raakt, met het bedrag voor elk (cent): wie betaalde, wie deelt (zijn deel), naar wie. */
export function personAmounts(from: PersonRows, e: EffectEvent): Map<string, number> {
  const out = new Map<string, number>();
  // Zonder betaler valt er niets te verrekenen.
  if (e.amount === null || !e.paid_by) return out;
  if (from === "payer") out.set(e.paid_by, e.amount);
  else if (from === "to") {
    if (e.to_person && e.to_person !== e.paid_by) out.set(e.to_person, e.amount);
  } else {
    const shares = sharesOf({ amount: e.amount, paid_by: e.paid_by, split: e.split ?? null, created_by: e.created_by ?? e.paid_by, lines: e.lines.map((l) => ({ price: l.price, owner: l.owner ?? null })) });
    for (const [id, cents] of shares) out.set(id, cents);
  }
  return out;
}

/**
 * Wat een gebeurtenis doet met de cellen van de items in haar lijnen, en met het saldo van personen. `ledgers`: de
 * lijsten met een saldo per persoon (haar saldokolom en de rij van elke persoon).
 */
export function effectsOf(does: Handeling[], e: EffectEvent, ledgers: Map<string, Ledger> = new Map()): Effect[] {
  const out: Effect[] = [];
  for (const h of does) {
    if (h.rows.from !== "lines") {
      const ledger = h.list ? ledgers.get(h.list) : undefined;
      if (!ledger) continue;
      const field = h.field === BALANCE ? ledger.field : h.field;
      for (const [person, cents] of personAmounts(h.rows.from, e)) {
        const item = ledger.rows.get(person);
        if (!item) continue;
        const v = h.value;
        const value: FieldValue | undefined = v.from === "amount" ? cents : v.from === "fixed" ? v.value : v.from === "field" ? e.data[v.key] : undefined;
        if (isEmpty(value)) continue;
        const num = typeof value === "number" ? value : null;
        if (h.op !== "zet" && num === null) continue;
        out.push({ item_id: item, field, op: h.op, num, val: num === null ? (value as FieldValue) : null, unit: null, expires: null });
      }
      continue;
    }
    const role = h.rows.role;
    for (const l of e.lines) {
      if (l.role !== role || !l.item_id) continue;
      if (h.list && l.item_list !== h.list) continue;
      if (h.field === EACH) {
        for (const [key, v] of Object.entries(e.data)) {
          if (!KEY_RE.test(key)) continue;
          out.push({ item_id: l.item_id, field: key, op: "zet", num: typeof v === "number" ? v : null, val: isEmpty(v) ? null : v, unit: null, expires: null });
        }
        continue;
      }
      const base = { item_id: l.item_id, field: h.field, op: h.op, unit: null, expires: null };
      const v = h.value;
      if (v.from === "qty") {
        // Een telling zonder hoeveelheid zegt niets; erbij of eraf zonder hoeveelheid is één (of één verpakking).
        if (h.op === "zet" && l.amount === null) continue;
        out.push({ ...base, num: l.amount, val: null, unit: l.unit, expires: h.op === "bij" ? l.expires : null });
        continue;
      }
      const value: FieldValue | null | undefined =
        v.from === "price" ? l.price : v.from === "amount" ? e.amount : v.from === "at" ? e.at : v.from === "fixed" ? v.value : e.data[v.key];
      // Een leeg veld doet niets (wie de kleur niet invult, wist ze niet).
      if (isEmpty(value)) continue;
      const num = typeof value === "number" ? value : null;
      if (h.op !== "zet" && num === null) continue;
      out.push({ ...base, num, val: num === null ? (value as FieldValue) : null });
    }
  }
  return out;
}

// ---------- de waarde van een cel ----------

/** Een verandering met haar plaats in de tijd (om te sorteren). */
export type CellEntry = Pick<Effect, "op" | "num" | "val" | "unit" | "expires"> & { at: string; created_at: string; position: number; event_id: string };

export const byTime = (a: Pick<CellEntry, "at" | "created_at" | "position">, b: Pick<CellEntry, "at" | "created_at" | "position">) =>
  a.at.localeCompare(b.at) || a.created_at.localeCompare(b.created_at) || a.position - b.position;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * De waarde van een cel: wat er in het item stond (`start`), of de laatste Zet, plus wat er daarna bij en af ging.
 * `from`: de gebeurtenis die de cel het laatst veranderde. Zonder veranderingen: `start`.
 */
export function foldCell(entries: CellEntry[], start: FieldValue | undefined): { value: FieldValue | undefined; from: string | null } {
  let value: FieldValue | undefined = start;
  let from: string | null = null;
  for (const e of [...entries].sort(byTime)) {
    from = e.event_id;
    if (e.op === "zet") {
      value = e.val ?? e.num ?? undefined;
      continue;
    }
    const now = typeof value === "number" ? value : 0;
    const n = e.num ?? 1;
    value = round(e.op === "bij" ? now + n : now - n);
  }
  return { value, from };
}
