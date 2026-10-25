import { RULE_FIELDS, RULE_KINDS, type Rule, type RuleKind } from "../../shared/rules";
import type { Person } from "../../shared/types";
import { Segmented } from "./Controls";
import { buildShares, sharesDraft, SharesField, type FieldDraft, type SharesDraft } from "./Fields";

/** De regel van een lijst terwijl je ze instelt: welke soort, en welk veld welke rol heeft (sleutels van de velden). */
export type RuleDraft = { kind: RuleKind | "none"; map: Record<string, string>; shares: SharesDraft };

export function ruleDraft(rules: Rule[]): RuleDraft {
  const r = rules[0];
  if (!r) return { kind: "none", map: {}, shares: sharesDraft(undefined) };
  if (r.kind === "split") return { kind: "split", map: { amount: r.amount, payer: r.payer, for: r.for }, shares: sharesDraft(r.default) };
  return { kind: "settle", map: { amount: r.amount, from: r.from, to: r.to }, shares: sharesDraft(undefined) };
}

/**
 * Van wat er staat naar regels voor de API. `keyOf`: de sleutel die een veld na het bewaren heeft (een nieuw veld
 * krijgt pas dan een sleutel uit zijn naam).
 */
export function buildRules(draft: RuleDraft, fields: FieldDraft[], keyOf: (draftKey: string) => string | undefined): { rules: Rule[] } | { error: string } {
  if (draft.kind === "none") return { rules: [] };
  const kind = draft.kind;
  const keys: Record<string, string> = {};
  for (const need of RULE_FIELDS[kind]) {
    const field = fields.find((f) => f.key === draft.map[need.role]);
    const key = field && field.type === need.type ? keyOf(field.key) : undefined;
    if (!key) return { error: `${RULE_KINDS[kind].label}: kies een veld voor "${need.label}".` };
    keys[need.role] = key;
  }
  if (kind === "settle") {
    if (keys.from === keys.to) return { error: "Terugbetalingen: Van en Aan zijn twee verschillende velden." };
    return { rules: [{ kind, amount: keys.amount, from: keys.from, to: keys.to }] };
  }
  const shares = buildShares(draft.shares);
  if (shares === undefined) return { error: "De gewone verdeling: samen 100%, en elk een deel." };
  return { rules: [{ kind, amount: keys.amount, payer: keys.payer, for: keys.for, ...(shares.length ? { default: shares } : {}) }] };
}

const KINDS = [
  { value: "none" as const, label: "Geen" },
  { value: "split" as const, label: RULE_KINDS.split.label },
  { value: "settle" as const, label: RULE_KINDS.settle.label },
];

/**
 * De regel van een lijst kiezen: wat de app met de velden doet. Kies je een regel, dan zoekt de app zelf de
 * passende velden; wat ontbreekt, komt erbij (`onAddFields`).
 */
export function RulesEditor({
  value,
  onChange,
  fields,
  onAddFields,
  people,
  meId,
}: {
  value: RuleDraft;
  onChange: (v: RuleDraft) => void;
  fields: FieldDraft[];
  onAddFields: (added: FieldDraft[]) => void;
  people: Person[];
  meId: string;
}) {
  function choose(kind: RuleDraft["kind"]) {
    if (kind === "none") return onChange({ ...value, kind });
    const map: Record<string, string> = {};
    const added: FieldDraft[] = [];
    for (const need of RULE_FIELDS[kind]) {
      const used = Object.values(map);
      const found = fields.find((f) => f.type === need.type && !used.includes(f.key));
      const key = found?.key ?? `regel_${need.role}`;
      if (!found) added.push({ key, label: need.label, type: need.type, isNew: true, optionsText: "" });
      map[need.role] = key;
    }
    if (added.length) onAddFields(added);
    onChange({ ...value, kind, map });
  }

  return (
    <section className="card form-section">
      <div className="field">
        <span className="label">Regel</span>
        <Segmented label="Regel" value={value.kind} onChange={choose} options={KINDS} />
        <span className="hint">
          {value.kind === "none"
            ? "Een gewone lijst. Met een regel doet de app iets met de velden, zoals bijhouden wie wie nog moet."
            : RULE_KINDS[value.kind].hint}
        </span>
      </div>
      {value.kind !== "none" && (
        <div className="attr-fields">
          {RULE_FIELDS[value.kind].map((need) => (
            <label key={need.role} className="field">
              <span className="label">{need.label}</span>
              <select value={value.map[need.role] ?? ""} onChange={(e) => onChange({ ...value, map: { ...value.map, [need.role]: e.target.value } })}>
                <option value="">Kies een veld</option>
                {fields
                  .filter((f) => f.type === need.type)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label || "Nieuw veld"}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {value.kind === "split" && (
        <div className="field">
          <span className="label">
            Gewone verdeling <span className="optional">· leeg = gelijk over iedereen</span>
          </span>
          <SharesField people={people} meId={meId} value={value.shares} onChange={(shares) => onChange({ ...value, shares })} />
          <span className="hint">Een nieuwe uitgave begint hiermee; per uitgave pas je ze aan.</span>
        </div>
      )}
    </section>
  );
}
