import { useRef, useState } from "react";
import {
  FIELD_ROLES,
  FIELD_TYPES,
  fieldKey,
  formatFieldValue,
  parseFieldText,
  type Attributes,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type OwnerShare,
} from "../../shared/fields";
import type { LabelScan, Member, PurchaseDetail } from "../../shared/types";
import { api, apiUrl } from "../api";
import { centsToInput } from "../format";
import { prepareForReading, prepareUpload } from "../image";
import { Alert, Avatar, Segmented, Switch } from "./Controls";
import { Icon } from "./Icon";

// ---------- waarden van de eigen velden invullen ----------

/** Wat in de velden staat terwijl je typt: tekst, twee jaartallen (van–tot), een score of ja/nee. */
export type AttributeDraft = Record<string, string | [string, string] | number | boolean | null>;

export function attributesDraft(defs: FieldDef[], attributes: Attributes): AttributeDraft {
  const draft: AttributeDraft = {};
  for (const def of defs) {
    const v = attributes[def.key];
    if (def.type === "year_range") {
      const [from, to] = Array.isArray(v) ? (v as [number | null, number | null]) : [null, null];
      draft[def.key] = [from ? String(from) : "", to ? String(to) : ""];
    } else if (def.type === "score") draft[def.key] = typeof v === "number" ? v : null;
    else if (def.type === "bool") draft[def.key] = v === true;
    else if (def.type === "money") draft[def.key] = typeof v === "number" ? centsToInput(v) : "";
    else if (def.type === "multi") draft[def.key] = Array.isArray(v) ? v.join(", ") : "";
    else if (def.type === "number") draft[def.key] = typeof v === "number" ? String(v).replace(".", ",") : "";
    else draft[def.key] = v === undefined || v === null ? "" : String(v);
  }
  return draft;
}

/** Eén waarde lezen; undefined = niet te lezen (het veld kleurt rood). */
function draftValue(def: FieldDef, raw: AttributeDraft[string] | undefined): FieldValue | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  if (def.type === "score") return typeof raw === "number" ? raw : null;
  if (def.type === "bool") return raw === true ? true : null;
  if (def.type === "year_range") {
    const [from, to] = Array.isArray(raw) ? raw : ["", ""];
    if (!from.trim() && !to.trim()) return null;
    const year = (s: string) => (s.trim() ? (parseFieldText({ ...def, type: "year" }, s) as number | undefined) : null);
    const a = year(from);
    const b = year(to);
    if (a === undefined || b === undefined) return undefined;
    return a !== null && b !== null && b < a ? [b, a] : [a, b];
  }
  return parseFieldText(def, String(raw));
}

export function buildAttributes(defs: FieldDef[], draft: AttributeDraft): { attributes: Attributes } | { error: string } {
  const attributes: Attributes = {};
  for (const def of defs) {
    const value = draftValue(def, draft[def.key]);
    if (value === undefined) return { error: `${def.label} is niet geldig.` };
    if (value !== null) attributes[def.key] = value;
  }
  return { attributes };
}

/** Velden die kort zijn, staan per twee naast elkaar. */
const WIDE: FieldType[] = ["text", "multi", "year_range", "bool"];

/**
 * De eigen velden van een project in een formulier. `auto`: velden die de app invulde (etiket), zacht blauw
 * tot je ze aanpast. `suggestions`: waarden die al voorkomen (streek, land), als voorstel bij het typen.
 */
export function FieldInputs({
  defs,
  value,
  onChange,
  auto,
  suggestions,
}: {
  defs: FieldDef[];
  value: AttributeDraft;
  onChange: (next: AttributeDraft, key: string) => void;
  auto?: Set<string>;
  suggestions?: Record<string, string[]>;
}) {
  const set = (key: string, v: AttributeDraft[string]) => onChange({ ...value, [key]: v }, key);
  return (
    <div className="attr-fields">
      {defs.map((def) => {
        const raw = value[def.key];
        const invalid = draftValue(def, raw) === undefined;
        const cls = auto?.has(def.key) ? "auto" : undefined;
        const label = (
          <span className="label">
            {def.label}
            {def.unit && <span className="optional"> · in {def.unit}</span>}
          </span>
        );
        const wide = WIDE.includes(def.type) ? "wide" : undefined;

        if (def.type === "bool") {
          return (
            <div key={def.key} className={`field ${wide}`}>
              <Switch checked={raw === true} onChange={(on) => set(def.key, on)} label={def.label} />
            </div>
          );
        }
        if (def.type === "score") {
          return (
            <div key={def.key} className="field">
              {label}
              <ScoreInput label={def.label} value={typeof raw === "number" ? raw : null} onChange={(v) => set(def.key, v)} />
            </div>
          );
        }
        if (def.type === "year_range") {
          const [from, to] = Array.isArray(raw) ? raw : ["", ""];
          return (
            <div key={def.key} className={`field ${wide}`}>
              {label}
              <div className="field-row">
                <input
                  inputMode="numeric"
                  className={cls}
                  aria-label={`${def.label} vanaf`}
                  placeholder="vanaf (jaar)"
                  value={from}
                  aria-invalid={invalid}
                  onChange={(e) => set(def.key, [e.target.value, to])}
                />
                <input
                  inputMode="numeric"
                  className={cls}
                  aria-label={`${def.label} tot`}
                  placeholder="tot (jaar)"
                  value={to}
                  aria-invalid={invalid}
                  onChange={(e) => set(def.key, [from, e.target.value])}
                />
              </div>
            </div>
          );
        }
        if (def.type === "select") {
          const current = typeof raw === "string" ? raw : "";
          const options = def.options ?? [];
          return (
            <label key={def.key} className="field">
              {label}
              <select className={cls} value={current} onChange={(e) => set(def.key, e.target.value)}>
                <option value="">—</option>
                {/* Een waarde uit een import die niet in de lijst staat, blijft kiesbaar. */}
                {current && !options.includes(current) && <option value={current}>{current}</option>}
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        const listId = suggestions?.[def.key]?.length ? `sugg-${def.key}` : undefined;
        return (
          <label key={def.key} className={`field ${wide ?? ""}`}>
            {label}
            <input
              className={cls}
              type={def.type === "date" ? "date" : "text"}
              inputMode={def.type === "year" ? "numeric" : def.type === "number" || def.type === "money" ? "decimal" : undefined}
              placeholder={PLACEHOLDERS[def.type]}
              list={listId}
              value={typeof raw === "string" ? raw : ""}
              aria-invalid={invalid}
              onChange={(e) => set(def.key, e.target.value)}
            />
            {listId && (
              <datalist id={listId}>
                {suggestions![def.key].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
            {def.type === "multi" && (
              <span className="hint">Gescheiden door komma's{def.options?.length ? `, bv. ${def.options.slice(0, 2).join(", ")}` : ""}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

const PLACEHOLDERS: Partial<Record<FieldType, string>> = { year: "bv. 2019", money: "€ 0,00", number: "0" };

/** Score op 5 met halve sterren: tik een ster, tik nog eens voor een halve. */
export function ScoreInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="score-input" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="score-star"
          aria-label={`${n} op 5`}
          aria-pressed={value !== null && value >= n - 0.5}
          onClick={() => onChange(value === n ? n - 0.5 : n)}
        >
          <Stars value={value ?? 0} n={n} />
        </button>
      ))}
      {value !== null && (
        <button type="button" className="link-button" onClick={() => onChange(null)}>
          Wissen
        </button>
      )}
    </div>
  );
}

function Stars({ value, n }: { value: number; n: number }) {
  if (value >= n) return <Icon name="star" size={22} className="on" />;
  if (value >= n - 0.5) return <Icon name="starHalf" size={22} className="on" />;
  return <Icon name="star" size={22} />;
}

/** Een score als kleine sterren in een lijst of fiche. */
export function ScoreStars({ value }: { value: number }) {
  return (
    <span className="score-stars" title={`${String(value).replace(".", ",")} op 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Stars key={n} value={value} n={n} />
      ))}
    </span>
  );
}

/** De ingevulde velden als regels in een `dl` (de lege vallen weg). */
export function AttributeRows({ defs, attributes }: { defs: FieldDef[]; attributes: Attributes }) {
  return (
    <>
      {defs
        .filter((d) => attributes[d.key] !== undefined)
        .map((d) => (
          <div key={d.key}>
            <dt>{d.label}</dt>
            <dd>{d.type === "score" ? <ScoreStars value={attributes[d.key] as number} /> : formatFieldValue(d, attributes[d.key])}</dd>
          </div>
        ))}
    </>
  );
}

/** Waarden die al voorkomen in tekstvelden, als voorstel bij het typen (zelfde schrijfwijze). */
export function fieldSuggestions(defs: FieldDef[], items: { attributes: Attributes }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of defs.filter((d) => d.type === "text")) {
    const values = new Set<string>();
    for (const item of items) {
      const v = item.attributes[def.key];
      if (typeof v === "string") values.add(v);
    }
    if (values.size) out[def.key] = [...values].sort((a, b) => a.localeCompare(b, "nl"));
  }
  return out;
}

// ---------- van wie is het ----------

export type OwnersDraft = { mode: "together" | "equal" | "percent"; people: string[]; values: Record<string, string> };

export function ownersDraft(owners: OwnerShare[]): OwnersDraft {
  if (owners.length === 0) return { mode: "together", people: [], values: {} };
  const equal = owners.every((o) => Math.abs(o.share - owners[0].share) < 0.02);
  return {
    mode: equal ? "equal" : "percent",
    people: owners.map((o) => o.member_id),
    values: Object.fromEntries(owners.map((o) => [o.member_id, String(Math.round(o.share * 10) / 10).replace(".", ",")])),
  };
}

const parsePercent = (s: string | undefined) => {
  const n = Number((s ?? "").replace(",", ".").replace("%", "").trim());
  return s?.trim() && Number.isFinite(n) ? n : NaN;
};

export function buildOwners(draft: OwnersDraft): { owners: OwnerShare[] } | { error: string } {
  if (draft.mode === "together" || draft.people.length === 0) return { owners: [] };
  if (draft.mode === "equal") return { owners: draft.people.map((id) => ({ member_id: id, share: 100 / draft.people.length })) };
  const shares = draft.people.map((id) => ({ member_id: id, share: parsePercent(draft.values[id]) }));
  if (shares.some((s) => !(s.share > 0))) return { error: "Geef elke eigenaar een deel in procent." };
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  if (Math.abs(total - 100) > 0.05) return { error: `Samen ${String(Math.round(total * 10) / 10).replace(".", ",")}% in plaats van 100%.` };
  return { owners: shares };
}

/**
 * Eigenaars bij een ding uit een aankoop: wie de aankoop draagt. Draagt het hele huishouden gelijk, dan is het
 * gewoon van iedereen samen.
 */
export function ownersFromPurchase(purchase: Pick<PurchaseDetail, "shares"> | undefined, residents: Member[]): OwnerShare[] {
  const shares = purchase?.shares.filter((s) => s.share_cents > 0) ?? [];
  const total = shares.reduce((sum, s) => sum + s.share_cents, 0);
  if (!total) return [];
  const everyone =
    residents.every((m) => shares.some((s) => s.member_id === m.id)) && shares.every((s) => Math.abs(s.share_cents - shares[0].share_cents) <= 1);
  return everyone ? [] : shares.map((s) => ({ member_id: s.member_id, share: Math.round((s.share_cents / total) * 1000) / 10 }));
}

const OWNER_MODES = [
  { value: "together" as const, label: "Samen" },
  { value: "equal" as const, label: "Gelijk" },
  { value: "percent" as const, label: "Procent" },
];

/**
 * Van wie is dit: van het huishouden samen (niemand apart), of van één of meer mensen, gelijk of in procent.
 * Zelfde rijen als bij het verdelen van een uitgave: tik op een avatar om iemand eigenaar te maken.
 */
export function OwnersField({ people, meId, value, onChange }: { people: Member[]; meId: string; value: OwnersDraft; onChange: (v: OwnersDraft) => void }) {
  const set = (patch: Partial<OwnersDraft>) => onChange({ ...value, ...patch });
  const toggle = (id: string) => set({ people: value.people.includes(id) ? value.people.filter((x) => x !== id) : [...value.people, id] });
  const built = buildOwners(value);

  return (
    <div className="field">
      <span className="label">Eigenaar</span>
      <Segmented
        label="Eigenaar"
        value={value.mode}
        options={OWNER_MODES}
        onChange={(mode) => set({ mode, people: mode !== "together" && value.people.length === 0 ? [meId] : value.people })}
      />
      {value.mode === "together" ? (
        <span className="hint">Van het hele huishouden, niemand apart.</span>
      ) : (
        <>
          <div className="split-rows">
            {people.map((m) => {
              const on = value.people.includes(m.id);
              const share = on && "owners" in built ? built.owners.find((o) => o.member_id === m.id)?.share : undefined;
              return (
                <div key={m.id} className="split-row" data-off={!on}>
                  <button
                    type="button"
                    className="split-toggle"
                    aria-pressed={on}
                    onClick={() => toggle(m.id)}
                    aria-label={`${m.name} is ${on ? "eigenaar" : "geen eigenaar"}`}
                  >
                    <Avatar member={m} size="sm" />
                    <span className="split-check">
                      <Icon name="check" size={10} />
                    </span>
                  </button>
                  <span className="split-name">{m.id === meId ? `${m.name} (ik)` : m.name}</span>
                  {value.mode === "percent" && on && (
                    <span className="split-input" data-unit="%">
                      <input
                        inputMode="decimal"
                        placeholder="0"
                        value={value.values[m.id] ?? ""}
                        onChange={(e) => set({ values: { ...value.values, [m.id]: e.target.value } })}
                        aria-label={`Deel van ${m.name} in procent`}
                      />
                    </span>
                  )}
                  <span className="split-share">{share !== undefined ? `${String(Math.round(share * 10) / 10).replace(".", ",")}%` : on ? "—" : ""}</span>
                </div>
              );
            })}
          </div>
          {"error" in built ? (
            <span className="hint split-status error" role="status">
              {built.error}
            </span>
          ) : (
            value.people.length === 0 && <span className="hint">Tik op wie eigenaar is. Niemand gekozen = samen.</span>
          )}
        </>
      )}
    </div>
  );
}

// ---------- de velden van een project kiezen ----------

export type FieldDraft = FieldDef & { isNew?: boolean; optionsText: string; open?: boolean };

export function fieldsDraft(defs: FieldDef[]): FieldDraft[] {
  return defs.map((d) => ({ ...d, optionsText: (d.options ?? []).join(", ") }));
}

/** Van wat in het formulier staat naar velden voor de API. Een nieuw veld krijgt een sleutel uit zijn naam. */
export function buildFields(drafts: FieldDraft[]): { fields: FieldDef[] } | { error: string } {
  const taken = drafts.filter((d) => !d.isNew).map((d) => d.key);
  const fields: FieldDef[] = [];
  for (const d of drafts) {
    const label = d.label.trim();
    if (!label) return { error: "Geef elk veld een naam (of haal het weg)." };
    const options = d.optionsText
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (d.type === "select" && options.length === 0) return { error: `Geef de keuzes voor ${label}, gescheiden door komma's.` };
    const key = d.isNew ? fieldKey(label, taken) : d.key;
    taken.push(key);
    const role = d.role && (FIELD_ROLES[d.role].types as readonly FieldType[]).includes(d.type) ? d.role : undefined;
    fields.push({
      key,
      label,
      type: d.type,
      ...((d.type === "select" || d.type === "multi") && options.length ? { options } : {}),
      ...(d.type === "number" && d.unit?.trim() ? { unit: d.unit.trim() } : {}),
      ...(d.column ? { column: true } : {}),
      ...(d.filter && FILTERABLE.includes(d.type) ? { filter: true } : {}),
      ...(role ? { role } : {}),
      ...(d.hint ? { hint: d.hint } : {}),
    });
  }
  return { fields };
}

const FILTERABLE: FieldType[] = ["text", "select", "multi", "year", "bool"];

/** De velden van een project: naam en soort, en per veld de keuzes, eenheid, kolom, filter en betekenis. */
export function FieldsEditor({ value, onChange }: { value: FieldDraft[]; onChange: (v: FieldDraft[]) => void }) {
  const [counter, setCounter] = useState(0);
  const update = (i: number, patch: Partial<FieldDraft>) => onChange(value.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const move = (i: number, delta: number) => {
    const next = [...value];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    onChange(next);
  };
  const add = () => {
    setCounter((n) => n + 1);
    onChange([...value, { key: `nieuw_${counter}`, label: "", type: "text", isNew: true, optionsText: "", open: true }]);
  };

  return (
    <div className="field">
      <span className="label">Velden</span>
      {value.length > 0 && (
        <ul className="fields-editor">
          {value.map((f, i) => {
            const roles = Object.entries(FIELD_ROLES).filter(([, r]) => (r.types as readonly FieldType[]).includes(f.type));
            return (
              <li key={f.key} className="fields-editor-row" data-open={f.open ?? false}>
                <div className="fields-editor-main">
                  <input
                    value={f.label}
                    maxLength={40}
                    placeholder="Naam van het veld"
                    aria-label="Naam van het veld"
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                  <select value={f.type} aria-label={`Soort van ${f.label || "het veld"}`} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
                    {Object.entries(FIELD_TYPES).map(([type, t]) => (
                      <option key={type} value={type}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-expanded={f.open ?? false}
                    aria-label={`Meer over ${f.label || "dit veld"}`}
                    onClick={() => update(i, { open: !f.open })}
                  >
                    <Icon name="dots" size={15} />
                  </button>
                </div>
                {f.open && (
                  <div className="fields-editor-more">
                    {(f.type === "select" || f.type === "multi") && (
                      <label className="field">
                        <span className="label">{f.type === "select" ? "Keuzes" : "Voorstellen"}</span>
                        <input
                          value={f.optionsText}
                          placeholder="Gescheiden door komma's, bv. Rood, Wit, Rosé"
                          onChange={(e) => update(i, { optionsText: e.target.value })}
                        />
                      </label>
                    )}
                    {f.type === "number" && (
                      <label className="field">
                        <span className="label">
                          Eenheid <span className="optional">· optioneel</span>
                        </span>
                        <input value={f.unit ?? ""} maxLength={12} placeholder="bv. km, cm, kg" onChange={(e) => update(i, { unit: e.target.value })} />
                      </label>
                    )}
                    {roles.length > 0 && (
                      <Switch
                        checked={Boolean(f.role)}
                        onChange={(on) => update(i, { role: on ? (roles[0][0] as FieldDef["role"]) : undefined })}
                        label={`Is het ${roles[0][1].label.toLowerCase()}`}
                        hint={f.type === "money" ? "Telt mee voor de waarde (× het aantal)." : "Voor de filter Nu drinkklaar."}
                      />
                    )}
                    <Switch checked={Boolean(f.column)} onChange={(on) => update(i, { column: on })} label="Als kolom in de lijst" />
                    {FILTERABLE.includes(f.type) && (
                      <Switch checked={Boolean(f.filter)} onChange={(on) => update(i, { filter: on })} label="Als filter boven de lijst" />
                    )}
                    <div className="btn-row">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>
                        <Icon name="up" size={14} /> Hoger
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                        <Icon name="down" size={14} /> Lager
                      </button>
                      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => onChange(value.filter((_, k) => k !== i))}>
                        <Icon name="trash" size={14} /> Weghalen
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={add}>
        <Icon name="plus" size={15} /> Veld toevoegen
      </button>
      <span className="hint">Naam en merk heeft elk ding al; hier komt wat je daarnaast wil bijhouden.</span>
    </div>
  );
}

// ---------- een etiket lezen ----------

/**
 * Foto van een etiket (of typeplaatje): de app leest naam, merk en de velden van het project.
 * `onResult` krijgt ook de foto, om bij het ding te bewaren.
 */
export function LabelScanner({ projectId, onResult }: { projectId: string; onResult: (scan: LabelScan, photo: File) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: "busy" | "ok" | "none"; text: string }>();

  async function read(file: File | undefined) {
    if (!file) return;
    setStatus({ tone: "busy", text: "Etiket lezen" });
    try {
      const [small, photo] = await Promise.all([prepareForReading(file), prepareUpload(file)]);
      const body = new FormData();
      body.set("image", small);
      body.set("project_id", projectId);
      const scan = await api.post<LabelScan>("/items/scan", body);
      onResult(scan, photo);
      setStatus(scan.message ? { tone: "none", text: scan.message } : { tone: "ok", text: "Gelezen. Kijk de blauwe velden even na." });
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  const input = (ref: typeof cameraRef, camera: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture={camera ? "environment" : undefined}
      hidden
      onChange={(e) => {
        read(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="scan-buttons">
      <div className="btn-row">
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" /> Etiket fotograferen
        </button>
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => fileRef.current?.click()}>
          <Icon name="image" /> Uit foto
        </button>
      </div>
      {input(cameraRef, true)}
      {input(fileRef, false)}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
    </div>
  );
}

// ---------- foto van een ding ----------

/** De foto van een ding (het etiket, de fiets): tonen, toevoegen, vervangen of weghalen. */
export function ItemPhoto({
  item,
  canEdit,
  onChange,
}: {
  item: { id: string; name: string; photo_version: number | null };
  canEdit: boolean;
  onChange: (version: number | null, message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("file", await prepareUpload(file));
      const { photo_version } = await api.put<{ photo_version: number }>(`/items/${item.id}/photo`, body);
      onChange(photo_version, "Foto bewaard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/items/${item.id}/photo`);
      onChange(null, "Foto weggehaald");
    } finally {
      setBusy(false);
    }
  }

  if (!item.photo_version && !canEdit) return null;
  return (
    <div className="item-photo">
      {item.photo_version ? <img src={apiUrl(`/items/${item.id}/photo?v=${item.photo_version}`)} alt={`Foto van ${item.name}`} /> : null}
      {canEdit && (
        <div className="btn-row">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={15} /> {item.photo_version ? "Andere foto" : "Foto toevoegen"}
          </button>
          {item.photo_version ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}>
              Weghalen
            </button>
          ) : null}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
