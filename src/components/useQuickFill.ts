// De motor van snel invullen (zie shared/quickfill.ts), voor het formulier (ItemForm) en het blok Snel toevoegen op je
// overzicht (QuickAdd): wat je typt, live lezen met code (met de items die in je tekst staan, van de server), je
// keuzes (een item, een keuze, een verplaatste waarde), het rijtje met wat ingevuld is, verplaatsen naar een ander veld
// (de keuzes of Tab) en weghalen. Wat er met de waarden gebeurt, beslist wie de motor gebruikt: het formulier zet ze
// in zijn velden en zet terug wat er stond (`onResult`, `onPick`, `onUnpick`), het blok stelt er de gegevens mee samen.

import { useMemo, useRef, useState } from "react";
import { refLists, type FieldDef, type FieldValue, type Names } from "../../shared/fields";
import { hasPiece, moveTargets, moveValue, quickFill, withoutPieces, wordAt, type QuickResult, type Suggestion } from "../../shared/quickfill";
import type { ItemRef } from "../../shared/types";
import { api } from "../api";
import { today } from "../format";
import { chipValue, type QuickChip } from "./QuickInput";

/** Velden met meer waarden: een keuze komt erbij in plaats van de vorige te vervangen. */
const MULTIPLE = ["multi", "people", "items", "amounts"];
/** Hoe lang de motor wacht na een toets voor hij leest. */
const SETTLE_MS = 250;

export type QuickFillOptions = {
  /** De velden die snel invullen mag vullen (die je mag wijzigen, zonder berekeningen). */
  fields: FieldDef[];
  people: { id: string; name: string }[];
  /** Woorden die hier niets betekenen (de naam van de lijst). */
  skip: string[];
  nameLabel: string;
  /** Tekst om mee te beginnen (?tekst=). */
  initial?: string;
  /** Mag de code dit veld nu vullen? (Het formulier: niet wat je zelf invulde.) Een gekozen veld nooit. */
  open?: (f: FieldDef) => boolean;
  /** Mag de naam uit de tekst komen? (Het formulier: niet als je ze zelf typte.) */
  nameOpen?: () => boolean;
  /** Mag een waarde naar dit veld verplaatst worden? */
  canMoveTo?: (key: string, picks: Suggestion[]) => boolean;
  /** Elke nieuwe lezing (het formulier zet ze live in de velden). */
  onResult?: (result: QuickResult, picks: Suggestion[]) => void;
  /** Een keuze telt (het formulier zet ze in haar veld); `onUnpick`: ze vervalt (terug wat er stond). */
  onPick?: (s: Suggestion, picks: Suggestion[]) => void;
  onUnpick?: (s: Suggestion) => void;
};

export type QuickFillChip = QuickChip & { pieces: string[]; order: number };

export function useQuickFill(options: QuickFillOptions) {
  // De opties van nu (ze veranderen elke keer het scherm bijwerkt; wat na een `await` gebeurt, wil de laatste).
  const opts = useRef(options);
  opts.current = options;
  const [note, setNote] = useState(() => (options.initial ?? "").slice(0, 300));
  const [picks, setPicks] = useState<Suggestion[]>([]);
  const [result, setResult] = useState<QuickResult | null>(null);
  const latest = useRef<{ note: string; picks: Suggestion[]; result: QuickResult | null }>({ note, picks, result });
  const itemNames = useRef(new Map<string, string>());
  const inCache = useRef(new Map<string, ItemRef[]>());
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const defOf = (key: string) => opts.current.fields.find((f) => f.key === key);
  const multiple = (key: string) => MULTIPLE.includes(defOf(key)?.type ?? "");

  async function itemsIn(f: FieldDef, text: string): Promise<ItemRef[]> {
    if (!/\p{L}{2}/u.test(text)) return [];
    // Enkel de items waarvan de naam in de tekst staat (ook in een lange lijst).
    const path = `/items?type=${refLists(f).join(",")}&in=${encodeURIComponent(text)}&limit=50`;
    const hit = inCache.current.get(path);
    if (hit) return hit;
    const found = await api.get<{ items: ItemRef[] }>(path).then((r) => r.items, () => []);
    inCache.current.set(path, found);
    return found;
  }

  /** De tekst met code lezen (zonder wat je koos); enkel de laatste lezing telt. */
  async function run(text: string, list: Suggestion[]): Promise<QuickResult | null> {
    const n = ++seq.current;
    const o = opts.current;
    const rest = withoutPieces(text, list.map((p) => p.text));
    const open = o.fields.filter((f) => (o.open ? o.open(f) : true) && !list.some((p) => p.field === f.key && !MULTIPLE.includes(f.type)));
    const refs = open.filter((f) => ["item", "items", "amounts"].includes(f.type) && refLists(f).length);
    const found = new Map(await Promise.all(refs.map(async (f) => [f.key, await itemsIn(f, rest)] as const)));
    if (n !== seq.current) return null;
    for (const items of found.values()) for (const it of items) itemNames.current.set(it.id, it.name);
    const read = quickFill(rest, open, { today: today(), people: o.people, items: (k) => found.get(k) ?? [], skip: o.skip });
    latest.current.result = read;
    setResult(read);
    o.onResult?.(read, list);
    return read;
  }

  function schedule(text: string, list: Suggestion[], ms = SETTLE_MS) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      run(text, list);
    }, ms);
  }

  function setList(list: Suggestion[]) {
    setPicks(list);
    latest.current.picks = list;
  }

  /** Nieuwe tekst: een gekozen woord dat je weer wist, vervalt ook als keuze. */
  function change(text: string) {
    setNote(text);
    latest.current.note = text;
    const list = latest.current.picks;
    const gone = list.filter((p) => !hasPiece(text, p.text));
    if (gone.length) {
      gone.forEach((p) => opts.current.onUnpick?.(p));
      setList(list.filter((p) => !gone.includes(p)));
    }
    schedule(text, latest.current.picks);
  }

  /** Een keuze uit de lijst (of een verplaatsing): telt als zelf ingevuld. */
  function pick(s: Suggestion) {
    if (s.move) return move(s.move, s.field);
    if (typeof s.value === "string") itemNames.current.set(s.value, s.text);
    const list = [...latest.current.picks.filter((p) => p.field !== s.field || multiple(s.field)), s];
    opts.current.onPick?.(s, latest.current.picks);
    setList(list);
    schedule(latest.current.note, list, 0);
  }

  /** Een waarde van de tekst (of een keuze) naar een ander veld: daarna telt ze als gekozen. */
  function move(fromKey: string, toKey: string) {
    const from = defOf(fromKey);
    const to = defOf(toKey);
    if (!from || !to) return;
    const picked = latest.current.picks.find((p) => p.field === fromKey && !multiple(fromKey));
    const raw = picked ? picked.value : latest.current.result?.data[fromKey];
    const text = picked ? picked.text : latest.current.result?.parts[fromKey]?.[0];
    if (raw === undefined || !text) return;
    let list = latest.current.picks;
    if (picked) {
      opts.current.onUnpick?.(picked);
      list = list.filter((p) => p !== picked);
    }
    const s: Suggestion = { field: toKey, label: to.label, text, value: moveValue(from, to, raw) };
    opts.current.onPick?.(s, list);
    setList([...list.filter((p) => p.field !== toKey), s]);
    schedule(latest.current.note, latest.current.picks, 0);
  }

  // Het rijtje: wat de tekst en je keuzes invulden, in de volgorde van het formulier.
  const chips = useMemo(() => {
    const o = opts.current;
    const names: Names = { person: (id) => o.people.find((x) => x.id === id)?.name ?? "?", item: (id) => itemNames.current.get(id) ?? "…" };
    const order = (k: string) => (k === "name" ? -1 : o.fields.findIndex((f) => f.key === k));
    const targets = (k: string, v: FieldValue) =>
      moveTargets(o.fields, k, v)
        .filter((f) => (o.canMoveTo ? o.canMoveTo(f.key, picks) : true))
        .map((f) => ({ key: f.key, label: f.label }));
    const out: QuickFillChip[] = [];
    if (result?.name && (o.nameOpen ? o.nameOpen() : true)) out.push({ key: "name", label: o.nameLabel, value: result.name, targets: [], pieces: result.parts.name ?? [], order: -1 });
    for (const [k, v] of Object.entries(result?.data ?? {})) {
      const def = defOf(k);
      // Een gekozen veld staat er als keuze (een lezing van net daarvoor telt niet meer).
      if (def && !multiple(k) && picks.some((p) => p.field === k)) continue;
      if (def) out.push({ key: k, label: def.label, value: chipValue(def, v, names), targets: multiple(k) ? [] : targets(k, v), pieces: result?.parts[k] ?? [], order: order(k) });
    }
    picks.forEach((p, i) => {
      const def = defOf(p.field);
      const label = def?.label ?? o.nameLabel;
      const shown = !def || ["item", "items", "amounts", "person", "people", "select", "multi"].includes(def.type) ? p.text : chipValue(def, p.value, names);
      out.push({ key: multiple(p.field) ? `${p.field}#${i}` : p.field, label, value: shown, targets: def && !multiple(p.field) ? targets(p.field, p.value) : [], pieces: [p.text], order: order(p.field) });
    });
    return out.sort((a, b) => a.order - b.order);
  }, [result, picks]);

  /** Het woord bij de cursor staat al in een veld: de andere velden waar het naartoe kan (in de keuzes). */
  function moves(word: string): Suggestion[] {
    const chip = chips.find((c) => c.targets.length && c.pieces.some((x) => hasPiece(x, word)));
    return chip ? chip.targets.map((t) => ({ field: t.key, label: t.label, text: chip.value, value: "", move: chip.key })) : [];
  }

  /** Tab bij een woord dat al in een veld staat: naar het volgende veld waar het kan (Shift+Tab: het vorige). */
  function tab(caret: number, back: boolean): boolean {
    const text = latest.current.note;
    const w = wordAt(text, caret) ?? (text[caret - 1] === " " ? wordAt(text, caret - 1) : null);
    const chip = w && chips.find((c) => c.targets.length && c.pieces.some((x) => hasPiece(x, w.word)));
    if (!chip) return false;
    const place = (k: string) => opts.current.fields.findIndex((f) => f.key === k);
    const ring = [chip.key, ...chip.targets.map((t) => t.key)].sort((a, b) => place(a) - place(b));
    move(chip.key, ring[(ring.indexOf(chip.key) + (back ? -1 : 1) + ring.length) % ring.length]);
    return true;
  }

  /** Een waarde uit het rijtje weghalen: haar woorden gaan uit je tekst. */
  function remove(chipKey: string) {
    const chip = chips.find((c) => c.key === chipKey);
    if (chip) change(withoutPieces(latest.current.note, chip.pieces));
  }

  /** Meteen lezen (Enter, opslaan, de AI): wat je nog typte, telt mee. */
  function flush(): Promise<QuickResult | null> {
    clearTimeout(timer.current);
    timer.current = undefined;
    return run(latest.current.note, latest.current.picks);
  }

  /** Opnieuw lezen (bv. als je een veld zelf invulde: dan laat de code het met rust). */
  function refresh() {
    if (latest.current.note.trim()) schedule(latest.current.note, latest.current.picks, 0);
  }

  /** Alles leeg (na bewaren). */
  function reset() {
    seq.current++;
    clearTimeout(timer.current);
    timer.current = undefined;
    setNote("");
    setList([]);
    setResult(null);
    latest.current = { note: "", picks: [], result: null };
  }

  return {
    note,
    picks,
    result,
    chips,
    change,
    pick,
    move,
    moves,
    tab,
    remove,
    flush,
    refresh,
    reset,
    /** Is er nog een lezing onderweg (getypt maar nog niet gelezen)? */
    pending: () => timer.current !== undefined,
    latest: () => latest.current,
    itemName: (id: string) => itemNames.current.get(id),
  };
}
