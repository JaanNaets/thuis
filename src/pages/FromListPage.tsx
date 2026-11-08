// Toevoegen uit andere lijst (zie shared/transfer.ts en STIJLBOEK.md): kies een lijst, welke dingen meegaan
// (voorwaarden zoals in een weergave), wat er per veld in komt (een veld van de bron, een vaste waarde of het origineel),
// hoe keuzes vertalen en of ze uit de bron weg moeten. Een voorbeeld toont wat erbij komt; de server rekent het opnieuw
// uit. Wat je koos, blijft per paar lijsten bewaard (in dit toestel).

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { formatFieldValue, refLists, type FieldDef } from "../../shared/fields";
import { canEdit, type List, type ListDetail, type ThingRef, type ThingRow } from "../../shared/model";
import { canCarry, canPointBack, cleanPlan, fillable, guessPlan, toTranslate, transferRows, type FieldSource, type TransferPlan } from "../../shared/transfer";
import type { Person } from "../../shared/types";
import { kindOf, NAME, viewFields, type ViewContext } from "../../shared/views";
import { api, useApi } from "../api";
import { Alert, SubmitButton, Switch } from "../components/Controls";
import { attributesDraft, buildAttributes, FieldInputs, namesFrom, type AttributeDraft } from "../components/Fields";
import { ConditionsEditor, type Choices } from "../components/Filters";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { formatNumber, today } from "../format";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { allEdit } from "./ThingForm";

type ThingList = { things: ThingRow[]; people: Person[]; refs: ThingRef[] };
type Result = { created: number; skipped: { name: string; error: string }[] };

export function FromListPage() {
  const { id } = useParams();
  const { data: detail, error } = useApi<ListDetail>(`/lists/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!detail) return null;
  if (!detail.list.one || !canEdit(detail.role)) return <p className="error page">Je kan hier niets toevoegen.</p>;
  return <FromListForm key={detail.list.id} list={detail.list} />;
}

const planKey = (target: string, source: string) => `thuis:uit-lijst:${target}:${source}`;

/** Wat je de vorige keer koos voor dit paar lijsten (nagekeken tegen de velden van nu), anders een voorstel. */
function startPlan(target: List, source: ListDetail): TransferPlan {
  try {
    const raw = localStorage.getItem(planKey(target.id, source.list.id));
    if (raw) return cleanPlan(JSON.parse(raw), source.list, target.fields);
  } catch {
    // Niets bewaard of niet meer geldig: een nieuw voorstel.
  }
  return guessPlan({ id: source.list.id, fields: source.list.fields }, { fields: target.fields });
}

/** De keuze in de kolomkeuzelijst als tekst: `field:<sleutel>`, `value`, `self` of leeg. */
const choiceOf = (s: FieldSource | undefined) => (!s ? "" : s.from === "field" ? `field:${s.key}` : s.from);

function FromListForm({ list }: { list: List }) {
  const { lists, person } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const sources = lists.filter((l) => l.one && l.id !== list.id && !l.archived);
  const [sourceId, setSourceId] = useState("");
  const { data: source } = useApi<ListDetail>(sourceId ? `/lists/${sourceId}` : null);
  const { data: sourceData } = useApi<ThingList>(sourceId ? `/lists/${sourceId}/things` : null);
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [values, setValues] = useState<AttributeDraft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();

  const targets = useMemo(() => fillable(list.fields), [list.fields]);
  useEffect(() => {
    if (!source || source.list.id !== sourceId || plan?.source === sourceId) return;
    const start = startPlan(list, source);
    setPlan(start);
    setValues(
      attributesDraft(
        targets,
        Object.fromEntries(Object.entries(start.fields).flatMap(([k, s]) => (s.from === "value" ? [[k, s.value]] : []))),
      ),
    );
    setResult(undefined);
  }, [source, sourceId, plan?.source, list, targets]);

  const ready = source && sourceData && plan && plan.source === source.list.id ? { source, sourceData, plan } : null;
  const sourceFields = ready?.source.list.fields ?? [];
  const vfields = useMemo(() => viewFields(sourceFields, ready?.source.list.one ?? "Naam"), [sourceFields, ready?.source.list.one]);
  const names = useMemo(() => namesFrom(ready?.sourceData.people ?? [], ready?.sourceData.refs ?? []), [ready?.sourceData]);
  const ctx: ViewContext = useMemo(() => ({ today: today(), me: person.id, names }), [person.id, names]);
  const items = useMemo(() => (ready?.sourceData.things ?? []).map((t) => ({ ...t, tag_ids: [] as string[] })), [ready?.sourceData]);
  const choices: Choices = (f) => {
    const kind = kindOf(f);
    if (kind === "select" || kind === "multi") return (f.options ?? []).map((o) => ({ value: o, label: o }));
    if (kind === "person" || kind === "people") return [{ value: "me", label: "Jij" }, ...(ready?.sourceData.people ?? []).filter((p) => p.id !== person.id).map((p) => ({ value: p.id, label: p.name }))];
    if (kind === "item" || kind === "items") return (ready?.sourceData.refs ?? []).filter((r) => refLists(f).includes(r.list_id)).map((r) => ({ value: r.id, label: r.name }));
    return [];
  };

  const rows = useMemo(() => (ready ? transferRows(items, ready.plan, sourceFields, list.fields, ctx) : []), [ready, items, sourceFields, list.fields, ctx]);
  const translations = useMemo(() => (ready ? toTranslate(items, ready.plan, sourceFields, list.fields, ctx) : {}), [ready, items, sourceFields, list.fields, ctx]);

  const update = (patch: Partial<TransferPlan>) => setPlan((p) => (p ? { ...p, ...patch } : p));
  const setSource = (key: string, s: FieldSource | null) =>
    setPlan((p) => {
      if (!p) return p;
      const fields = { ...p.fields };
      if (s) fields[key] = s;
      else delete fields[key];
      return { ...p, fields };
    });
  /** Een vaste waarde: wat het veld nu zegt, nagekeken zoals in een gewoon formulier. */
  function setValue(def: FieldDef, next: AttributeDraft) {
    setValues(next);
    const built = buildAttributes([def], next);
    setSource(def.key, { from: "value", value: "data" in built ? (built.data[def.key] ?? "") : "" });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !rows.length) return;
    setBusy(true);
    setError(undefined);
    try {
      try {
        localStorage.setItem(planKey(list.id, ready.plan.source), JSON.stringify(ready.plan));
      } catch {
        // Niet bewaard (privévenster): volgende keer gewoon een voorstel.
      }
      const res = await api.post<Result>(`/lists/${list.id}/things/from`, ready.plan);
      toast(`${formatNumber(res.created)} ${ready.plan.move ? "verplaatst naar" : "toegevoegd aan"} ${list.name}`);
      if (res.skipped.length === 0) {
        navigate(`/lijsten/${list.id}`, { replace: true });
        return;
      }
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const textual = sourceFields.filter((f) => canCarry({ key: "_", label: "", type: "text" }, f));
  const one = (list.one ?? "ding").toLowerCase();

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title="Toevoegen uit andere lijst" back={{ to: -1, label: list.name }} />

      <section className="card form-section">
        <label className="field">
          <span className="label">Uit</span>
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setPlan(null);
            }}
          >
            {!sourceId && <option value="">Kies een lijst…</option>}
            {sources.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {ready && (
          <ConditionsEditor label="Welke" def={ready.plan.where} fields={vfields} choices={choices} onChange={(where) => update({ where: { ...ready.plan.where, ...where } })} />
        )}
      </section>

      {ready && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Kolommen</span>
          </div>
          <ul className="column-map">
            <li className="column-map-row">
              <span className="column-map-name">
                <span className="column-map-header">Naam</span>
              </span>
              <select aria-label="Naam" value={ready.plan.name} onChange={(e) => update({ name: e.target.value })}>
                <option value={NAME}>{ready.source.list.one ?? "Naam"}</option>
                {textual.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </li>
            {targets.map((t) => {
              const current = ready.plan.fields[t.key];
              const carry = sourceFields.filter((f) => canCarry(t, f));
              const back = canPointBack(t, ready.plan.source);
              return (
                <li key={t.key} className={`column-map-row${current?.from === "value" ? " has-value" : ""}`}>
                  <span className="column-map-name">
                    <span className="column-map-header">{t.label}</span>
                  </span>
                  <select
                    aria-label={t.label}
                    value={choiceOf(current)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) setSource(t.key, null);
                      else if (v === "self") setSource(t.key, { from: "self" });
                      else if (v === "value") setValue(t, values);
                      else setSource(t.key, { from: "field", key: v.slice("field:".length) });
                    }}
                  >
                    <option value="">Leeg</option>
                    {canCarry(t, null) && <option value={`field:${NAME}`}>{ready.source.list.one ?? "Naam"}</option>}
                    {carry.map((f) => (
                      <option key={f.key} value={`field:${f.key}`}>
                        {f.label}
                      </option>
                    ))}
                    {back && <option value="self">{`${ready.source.list.one ?? "Het ding"} in ${ready.source.list.name}`}</option>}
                    <option value="value">Vaste waarde</option>
                  </select>
                  {current?.from === "value" && (
                    <div className="column-map-value">
                      <FieldInputs defs={[{ ...t, label: "Waarde" }]} value={values} onChange={(next) => setValue(t, next)} access={allEdit([t])} people={ready.sourceData.people} meId={person.id} />
                    </div>
                  )}
                  {translations[t.key] && (
                    <ul className="column-map-translate">
                      {translations[t.key].map((v) => (
                        <li key={v}>
                          <span>{v}</span>
                          <select
                            aria-label={`${v} wordt`}
                            value={ready.plan.translate[t.key]?.[v] ?? ""}
                            onChange={(e) => update({ translate: { ...ready.plan.translate, [t.key]: { ...ready.plan.translate[t.key], [v]: e.target.value } } })}
                          >
                            <option value="">Leeg</option>
                            {(t.options ?? []).map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {canEdit(ready.source.role) && <Switch label={`Weghalen uit ${ready.source.list.name}`} checked={ready.plan.move} onChange={(move) => update({ move })} />}
        </section>
      )}

      {ready && (
        <section className="card form-section">
          <div className="field">
            <span className="label">Zo komt het erin</span>
            <span className="hint">{`${formatNumber(rows.length)} ${rows.length === 1 ? one : "dingen"}`}</span>
          </div>
          {rows.length > 0 && (
            <ul className="import-preview">
              {rows.slice(0, 5).map((r) => (
                <li key={r.source_id}>
                  <span className="row-title">{r.name}</span>
                  <span className="row-meta">
                    {list.fields
                      .filter((f) => r.data[f.key] !== undefined && f.type !== "longtext" && f.type !== "item" && f.type !== "items")
                      .map((f) => `${f.label}: ${formatFieldValue(f, r.data[f.key])}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 5 && <span className="hint">en nog {formatNumber(rows.length - 5)}</span>}
        </section>
      )}

      {result && result.skipped.length > 0 && (
        <Alert tone="partial">
          {formatNumber(result.created)} gelukt, {result.skipped.length} overgeslagen:{" "}
          {result.skipped
            .slice(0, 8)
            .map((s) => `${s.name} (${s.error.toLowerCase()})`)
            .join(", ")}
          {result.skipped.length > 8 ? ", …" : ""}
        </Alert>
      )}
      {error && <p className="error">{error}</p>}

      {ready && !result && (
        <SubmitButton busy={busy} className="btn btn-primary btn-lg" disabled={!rows.length}>
          {`${formatNumber(rows.length)} ${ready.plan.move ? "verplaatsen" : "toevoegen"}`}
        </SubmitButton>
      )}
      {result && (
        <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/lijsten/${list.id}`, { replace: true })}>
          Naar {list.name}
        </button>
      )}
    </form>
  );
}
