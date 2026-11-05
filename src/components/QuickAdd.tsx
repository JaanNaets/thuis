// Snel toevoegen op je overzicht: het slimme invulveld van het formulier (QuickInput, shared/quickfill.ts) in een blok,
// met Bewaar: wat je typt, gaat meteen in de lijst zonder het formulier te openen, met Ongedaan maken in de melding.
// Mist er iets verplichts, dan wordt de knop Verder en opent het formulier met je tekst. Wat het blok invult: eerst
// wat de velden zelf invullen (vandaag, jij), dan je geheugen (`remember`), dan wat een gekozen item overneemt
// (`copy`), dan je tekst en je keuzes. Alles gaat daarna door de gewone route (POST /projects/:id/items, prepareData).

import { useEffect, useMemo, useRef, useState } from "react";
import { applyFieldDefaults, cleanValue, refLists, type AmountEntry, type Attributes, type FieldDef, type FieldValue, type Names } from "../../shared/fields";
import { addPath } from "../../shared/quickadd";
import { hasPiece, moveTargets, moveValue, quickFill, withoutPieces, wordAt, type QuickResult, type Suggestion } from "../../shared/quickfill";
import type { ItemDetail, ItemInput, ItemRef, ItemTypeView, ProjectDetail } from "../../shared/types";
import { api, useApi } from "../api";
import { REFRESH_EVENT } from "../device";
import { today } from "../format";
import { enqueue, isOffline } from "../outbox";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { Icon } from "./Icon";
import { chipValue, QuickChips, QuickInput, type QuickChip, type QuickSource } from "./QuickInput";
import { useToast } from "./Toast";

const MULTIPLE = ["multi", "people", "items", "amounts"];
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

export function QuickAdd({ projectId, typeId }: { projectId: string; typeId: string }) {
  const { data: project } = useApi<ProjectDetail>(`/projects/${projectId}`);
  const type = project?.types.find((t) => t.id === typeId && t.can_create);
  return (
    <section className="card dash-card quick-add">
      <Link to={addPath({ project_id: projectId, type_id: typeId })} className="dash-head">
        <span className="row-media">
          <Icon name="plus" size={16} />
        </span>
        <span className="row-main">
          <span className="row-title">{type ? `${type.name} toevoegen` : "Toevoegen"}</span>
          {project && (
            <span className="row-meta">
              <span>{project.project.name}</span>
            </span>
          )}
        </span>
        <Icon name="next" size={16} className="row-chevron" />
      </Link>
      {project && type && <QuickAddForm project={project} type={type} />}
    </section>
  );
}

function QuickAddForm({ project, type }: { project: ProjectDetail; type: ItemTypeView }) {
  const { person } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const projectId = project.project.id;
  const fields = useMemo(() => type.fields.filter((f) => f.type !== "calc" && type.field_access[f.key] === "edit"), [type]);
  const people = useMemo(() => project.members.map((m) => m.person), [project]);
  const remembers = fields.some((f) => f.remember);
  const { data: remembered } = useApi<{ data: Attributes }>(remembers ? `/projects/${projectId}/items/remembered?type=${type.id}` : null);
  const [note, setNote] = useState("");
  const [picks, setPicks] = useState<Suggestion[]>([]);
  // De tekst en keuzes van nu (een keuze komt meteen na een nieuwe tekst, nog voor het scherm bijwerkt).
  const latest = useRef({ note, picks });
  latest.current = { note, picks };
  const [result, setResult] = useState<QuickResult | null>(null);
  const [copy, setCopy] = useState<{ id: string; name: string; data: Attributes } | null>(null);
  const [busy, setBusy] = useState(false);
  const itemNames = useRef(new Map<string, string>());
  const inCache = useRef(new Map<string, ItemRef[]>());
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const defOf = (key: string) => fields.find((f) => f.key === key);
  const source = useMemo<QuickSource>(() => ({ fields, people, names: [], nameLabel: type.name_label ?? "Naam" }), [fields, people, type]);
  const logbook = type.fields.some((f) => f.type === "date" && f.today);

  async function itemsIn(f: FieldDef, text: string): Promise<ItemRef[]> {
    if (!/\p{L}{2}/u.test(text)) return [];
    const path = `/items?type=${refLists(f).join(",")}&in=${encodeURIComponent(text)}&limit=50`;
    const hit = inCache.current.get(path);
    if (hit) return hit;
    const found = await api.get<{ items: ItemRef[] }>(path).then((r) => r.items, () => []);
    inCache.current.set(path, found);
    return found;
  }

  async function run(text: string, list: Suggestion[]) {
    const n = ++seq.current;
    const rest = withoutPieces(text, list.map((p) => p.text));
    const open = fields.filter((f) => !list.some((p) => p.field === f.key && !MULTIPLE.includes(f.type)));
    const refs = open.filter((f) => ["item", "items", "amounts"].includes(f.type) && refLists(f).length);
    const options = new Map(await Promise.all(refs.map(async (f) => [f.key, await itemsIn(f, rest)] as const)));
    if (n !== seq.current) return;
    for (const found of options.values()) for (const o of found) itemNames.current.set(o.id, o.name);
    setResult(quickFill(rest, open, { today: today(), people, items: (k) => options.get(k) ?? [], skip: [type.name, type.plural] }));
  }

  function schedule(text: string, list: Suggestion[], ms = 250) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(text, list), ms);
  }

  function onNote(text: string) {
    setNote(text);
    const kept = latest.current.picks.filter((p) => hasPiece(text, p.text));
    if (kept.length !== latest.current.picks.length) setPicks(kept);
    latest.current = { note: text, picks: kept };
    schedule(text, kept);
  }

  function onPick(s: Suggestion) {
    if (s.move) return move(s.move, s.field);
    if (typeof s.value === "string") itemNames.current.set(s.value, s.text);
    const def = defOf(s.field);
    const list = [...latest.current.picks.filter((p) => p.field !== s.field || (def && MULTIPLE.includes(def.type))), s];
    setPicks(list);
    latest.current = { ...latest.current, picks: list };
    schedule(latest.current.note, list, 0);
  }

  /** Een waarde van de tekst (of een keuze) naar een ander veld: daarna telt ze als gekozen. */
  function move(fromKey: string, toKey: string) {
    const from = defOf(fromKey);
    const to = defOf(toKey);
    if (!from || !to) return;
    const picked = latest.current.picks.find((p) => p.field === fromKey);
    const raw = picked ? picked.value : result?.data[fromKey];
    const text = picked ? picked.text : result?.parts[fromKey]?.[0];
    if (raw === undefined || !text) return;
    const list = [...latest.current.picks.filter((p) => p !== picked && p.field !== toKey), { field: toKey, label: to.label, text, value: moveValue(from, to, raw) }];
    setPicks(list);
    latest.current = { ...latest.current, picks: list };
    schedule(latest.current.note, list, 0);
  }

  // Wat de velden zelf invullen, je geheugen en je tekst, zonder wat een gekozen item overneemt.
  const own = useMemo(() => {
    const start: Attributes = Object.fromEntries(fields.filter((f) => f.today).map((f) => [f.key, today()]));
    const data: Attributes = {
      ...applyFieldDefaults(fields, start, people.map((p) => p.id), person.id, true),
      ...Object.fromEntries(Object.entries(remembered?.data ?? {}).filter(([k]) => defOf(k)?.remember)),
      ...(result?.data ?? {}),
    };
    for (const p of picks) {
      const def = defOf(p.field);
      if (!def) continue;
      const now = data[def.key];
      if (def.type === "items" || def.type === "people") data[def.key] = [...new Set([...(Array.isArray(now) ? (now as string[]) : []), String(p.value)])];
      else if (def.type === "amounts") data[def.key] = [...(Array.isArray(now) ? (now as AmountEntry[]) : []), { item: String(p.value) }];
      else if (def.type === "multi") data[def.key] = [...new Set([...(Array.isArray(now) ? (now as string[]) : []), String(p.value)])];
      else data[def.key] = p.value;
    }
    return data;
  }, [fields, people, remembered, result, picks]);

  // Overnemen (`copy`): het gekozen item halen, één keer per item.
  const copyField = fields.find((f) => f.type === "item" && f.copy && typeof own[f.key] === "string");
  const copyId = copyField ? (own[copyField.key] as string) : null;
  useEffect(() => {
    if (!copyId || !copyField) return setCopy(null);
    if (copy?.id === copyId) return;
    let stale = false;
    api.get<ItemDetail>(`/items/${copyId}`).then(
      (source) => {
        if (stale) return;
        const data: Attributes = {};
        for (const f of fields) {
          if (f.key === copyField.key) continue;
          const v = source.data[f.key];
          const clean = v === undefined ? null : cleanValue(f, v);
          if (clean !== null && clean !== undefined) data[f.key] = clean;
        }
        setCopy({ id: copyId, name: source.name, data });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [copyId]);

  // Alles samen: wat je typte of koos, wint van wat overgenomen wordt; hoeveelheden rekenen mee met de porties.
  const data = useMemo(() => {
    if (!copy || copy.id !== copyId) return own;
    const typed = new Set([...Object.keys(result?.data ?? {}), ...picks.map((p) => p.field)]);
    const out: Attributes = { ...own };
    for (const [k, v] of Object.entries(copy.data)) if (!typed.has(k)) out[k] = v;
    for (const f of fields) {
      const base = copy.data[f.key];
      const per = f.per ? copy.data[f.per] : undefined;
      const here = f.per ? out[f.per] : undefined;
      if (f.type !== "amounts" || typed.has(f.key) || !Array.isArray(base) || typeof per !== "number" || typeof here !== "number" || per <= 0) continue;
      out[f.key] = (base as AmountEntry[]).map((e) => (e.amount !== undefined ? { ...e, amount: Math.round((e.amount * here * 1000) / per) / 1000 } : e));
    }
    return out;
  }, [own, copy, copyId, result, picks]);

  const itemPick = picks.find((p) => defOf(p.field)?.type === "item");
  const name = result?.name ?? itemPick?.text ?? (copy?.id === copyId ? copy?.name : undefined) ?? "";
  const missing = type.fields.some((f) => f.required && type.field_access[f.key] === "edit" && empty(data[f.key])) || (!logbook && !name.trim());
  const typed = Boolean(note.trim());

  // Het rijtje: wat je tekst en je keuzes invulden.
  const chips = useMemo(() => {
    const names: Names = { person: (id) => people.find((x) => x.id === id)?.name ?? "?", item: (id) => itemNames.current.get(id) ?? "…" };
    const out: (QuickChip & { pieces: string[]; order: number })[] = [];
    const order = (k: string) => (k === "name" ? -1 : fields.findIndex((f) => f.key === k));
    const targets = (k: string, v: FieldValue) => moveTargets(fields, k, v).map((f) => ({ key: f.key, label: f.label }));
    if (result?.name) out.push({ key: "name", label: type.name_label ?? "Naam", value: result.name, targets: [], pieces: result.parts.name ?? [], order: -1 });
    for (const [k, v] of Object.entries(result?.data ?? {})) {
      const def = defOf(k);
      if (def) out.push({ key: k, label: def.label, value: chipValue(def, v, names), targets: MULTIPLE.includes(def.type) ? [] : targets(k, v), pieces: result?.parts[k] ?? [], order: order(k) });
    }
    picks.forEach((p, i) => {
      const def = defOf(p.field);
      if (!def) return;
      const shown = ["item", "items", "amounts", "person", "people", "select", "multi"].includes(def.type) ? p.text : chipValue(def, p.value, names);
      out.push({ key: MULTIPLE.includes(def.type) ? `${p.field}#${i}` : p.field, label: def.label, value: shown, targets: MULTIPLE.includes(def.type) ? [] : targets(p.field, p.value), pieces: [p.text], order: order(p.field) });
    });
    return out.sort((a, b) => a.order - b.order);
  }, [result, picks]);

  const movesFor = (word: string): Suggestion[] => {
    const chip = chips.find((c) => c.targets.length && c.pieces.some((x) => hasPiece(x, word)));
    return chip ? chip.targets.map((t) => ({ field: t.key, label: t.label, text: chip.value, value: "", move: chip.key })) : [];
  };

  function tab(caret: number, back: boolean): boolean {
    const w = wordAt(note, caret) ?? (note[caret - 1] === " " ? wordAt(note, caret - 1) : null);
    const chip = w && chips.find((c) => c.targets.length && c.pieces.some((x) => hasPiece(x, w.word)));
    if (!chip) return false;
    const place = (k: string) => fields.findIndex((f) => f.key === k);
    const ring = [chip.key, ...chip.targets.map((t) => t.key)].sort((a, b) => place(a) - place(b));
    move(chip.key, ring[(ring.indexOf(chip.key) + (back ? -1 : 1) + ring.length) % ring.length]);
    return true;
  }

  function reset() {
    seq.current++;
    clearTimeout(timer.current);
    setNote("");
    setPicks([]);
    setResult(null);
    setCopy(null);
  }

  async function save() {
    if (missing) return navigate(addPath({ project_id: projectId, type_id: type.id }, note));
    clearTimeout(timer.current);
    const input: ItemInput = { type_id: type.id, name: name.trim(), data, tag_ids: [] };
    setBusy(true);
    try {
      const saved = await api.post<ItemDetail>(`/projects/${projectId}/items`, input);
      reset();
      window.dispatchEvent(new Event(REFRESH_EVENT));
      toast(
        `${saved.name} bewaard`,
        "check",
        type.can_delete
          ? {
              label: "Ongedaan maken",
              run: async () => {
                try {
                  await api.delete(`/items/${saved.id}`);
                  window.dispatchEvent(new Event(REFRESH_EVENT));
                  toast(`${saved.name} ongedaan gemaakt`);
                } catch (err) {
                  toast((err as Error).message, "alert");
                }
              },
            }
          : undefined,
      );
    } catch (err) {
      if (isOffline(err)) {
        await enqueue(projectId, input, null);
        reset();
        toast("Bewaard op dit toestel; het gaat mee zodra je internet hebt");
      } else toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quick-add-body">
      <div className="picker-row">
        <QuickInput
          value={note}
          onChange={onNote}
          onEnter={() => typed && save()}
          onPick={onPick}
          moves={movesFor}
          onTab={tab}
          source={source}
          label={`${type.name} toevoegen`}
          placeholder="Typ wat je weet"
        />
        <button type="button" className="btn btn-primary" style={{ flex: "none" }} disabled={!typed || busy} onClick={save}>
          {typed && missing ? "Verder" : "Bewaar"}
        </button>
      </div>
      <QuickChips chips={chips} onMove={move} onRemove={(key) => onNote(withoutPieces(note, chips.find((c) => c.key === key)?.pieces ?? []))} />
    </div>
  );
}
