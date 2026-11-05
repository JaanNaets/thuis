// Snel toevoegen op je overzicht: het slimme invulveld van het formulier (QuickInput, shared/quickfill.ts) in een blok,
// met Bewaar: wat je typt, gaat meteen in de lijst zonder het formulier te openen, met Ongedaan maken in de melding.
// Mist er iets verplichts, dan wordt de knop Verder en opent het formulier met je tekst. Wat het blok invult: eerst
// wat de velden zelf invullen (vandaag, jij), dan je geheugen (`remember`), dan wat een gekozen item overneemt
// (`copy`), dan je tekst en je keuzes. Alles gaat daarna door de gewone route (POST /projects/:id/items, prepareData).

import { useEffect, useMemo, useState } from "react";
import { applyFieldDefaults, cleanValue, type AmountEntry, type Attributes } from "../../shared/fields";
import { addPath } from "../../shared/quickadd";
import type { QuickResult, Suggestion } from "../../shared/quickfill";
import type { ItemDetail, ItemInput, ItemTypeView, ProjectDetail } from "../../shared/types";
import { api, useApi } from "../api";
import { REFRESH_EVENT } from "../device";
import { today } from "../format";
import { enqueue, isOffline } from "../outbox";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { Icon } from "./Icon";
import { QuickChips, QuickInput, type QuickSource } from "./QuickInput";
import { useQuickFill } from "./useQuickFill";
import { useToast } from "./Toast";

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
  const [copy, setCopy] = useState<{ id: string; name: string; data: Attributes } | null>(null);
  const [busy, setBusy] = useState(false);
  const defOf = (key: string) => fields.find((f) => f.key === key);
  const source = useMemo<QuickSource>(() => ({ fields, people, names: [], nameLabel: type.name_label ?? "Naam" }), [fields, people, type]);
  const logbook = type.fields.some((f) => f.type === "date" && f.today);
  const engine = useQuickFill({ fields, people, skip: [type.name, type.plural], nameLabel: type.name_label ?? "Naam" });
  const { note, picks, result } = engine;

  /**
   * Wat het blok bewaart: wat de velden zelf invullen, je geheugen, wat een gekozen item overneemt (`copy`), je tekst
   * en je keuzes (die winnen); hoeveelheden uit een recept rekenen mee met de porties.
   */
  function compose(read: QuickResult | null, list: Suggestion[], copied: typeof copy): Attributes {
    const start: Attributes = Object.fromEntries(fields.filter((f) => f.today).map((f) => [f.key, today()]));
    const data: Attributes = {
      ...applyFieldDefaults(fields, start, people.map((p) => p.id), person.id, true),
      ...Object.fromEntries(Object.entries(remembered?.data ?? {}).filter(([k]) => defOf(k)?.remember)),
    };
    const typed = new Set([...Object.keys(read?.data ?? {}), ...list.map((p) => p.field)]);
    if (copied) for (const [k, v] of Object.entries(copied.data)) if (!typed.has(k)) data[k] = v;
    Object.assign(data, read?.data ?? {});
    for (const p of list) {
      const def = defOf(p.field);
      if (!def) continue;
      const now = data[def.key];
      if (def.type === "items" || def.type === "people") data[def.key] = [...new Set([...(Array.isArray(now) ? (now as string[]) : []), String(p.value)])];
      else if (def.type === "amounts") data[def.key] = [...(Array.isArray(now) ? (now as AmountEntry[]) : []), { item: String(p.value) }];
      else if (def.type === "multi") data[def.key] = [...new Set([...(Array.isArray(now) ? (now as string[]) : []), String(p.value)])];
      else data[def.key] = p.value;
    }
    if (copied)
      for (const f of fields) {
        const base = copied.data[f.key];
        const per = f.per ? copied.data[f.per] : undefined;
        const here = f.per ? data[f.per] : undefined;
        if (f.type !== "amounts" || typed.has(f.key) || !Array.isArray(base) || typeof per !== "number" || typeof here !== "number" || per <= 0) continue;
        data[f.key] = (base as AmountEntry[]).map((e) => (e.amount !== undefined ? { ...e, amount: Math.round((e.amount * here * 1000) / per) / 1000 } : e));
      }
    return data;
  }

  /** De naam: wat overbleef, anders een gekozen item, anders het overgenomen item. */
  const nameOf = (read: QuickResult | null, list: Suggestion[], copied: typeof copy) =>
    read?.name ?? list.find((p) => defOf(p.field)?.type === "item")?.text ?? copied?.name ?? "";

  // Overnemen (`copy`): het gekozen item halen, één keer per item.
  const own = compose(result, picks, null);
  const copyField = fields.find((f) => f.type === "item" && f.copy && typeof own[f.key] === "string");
  const copyId = copyField ? (own[copyField.key] as string) : null;
  useEffect(() => {
    if (!copyId || !copyField) return setCopy(null);
    if (copy?.id === copyId) return;
    let stale = false;
    api.get<ItemDetail>(`/items/${copyId}`).then(
      (item) => {
        if (stale) return;
        const data: Attributes = {};
        for (const f of fields) {
          if (f.key === copyField.key) continue;
          const v = item.data[f.key];
          const clean = v === undefined ? null : cleanValue(f, v);
          if (clean !== null && clean !== undefined) data[f.key] = clean;
        }
        setCopy({ id: copyId, name: item.name, data });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [copyId]);

  const copied = copy && copy.id === copyId ? copy : null;
  const missingIn = (data: Attributes, name: string) =>
    type.fields.some((f) => f.required && type.field_access[f.key] === "edit" && empty(data[f.key])) || (!logbook && !name.trim());
  const missing = missingIn(compose(result, picks, copied), nameOf(result, picks, copied));
  const typed = Boolean(note.trim());

  async function save() {
    // Wat je nog typte, eerst lezen.
    const read = engine.pending() ? await engine.flush() : engine.latest().result;
    const list = engine.latest().picks;
    const data = compose(read, list, copied);
    const name = nameOf(read, list, copied);
    if (missingIn(data, name)) return navigate(addPath({ project_id: projectId, type_id: type.id }, engine.latest().note));
    const input: ItemInput = { type_id: type.id, name: name.trim(), data, tag_ids: [] };
    setBusy(true);
    try {
      const saved = await api.post<ItemDetail>(`/projects/${projectId}/items`, input);
      engine.reset();
      setCopy(null);
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
        engine.reset();
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
          onChange={engine.change}
          onEnter={() => typed && save()}
          onPick={engine.pick}
          moves={engine.moves}
          onTab={engine.tab}
          source={source}
          label={`${type.name} toevoegen`}
          placeholder="Typ wat je weet"
        />
        <button type="button" className="btn btn-primary" style={{ flex: "none" }} disabled={!typed || busy} onClick={save}>
          {typed && missing ? "Verder" : "Bewaar"}
        </button>
      </div>
      <QuickChips chips={engine.chips} onMove={engine.move} onRemove={engine.remove} />
    </div>
  );
}
