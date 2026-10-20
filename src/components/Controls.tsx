import type { CSSProperties, ReactNode } from "react";
import type { FlatNode, TreeNode } from "../../shared/tree";
import { TONES, type Member, type Tone } from "../../shared/types";
import { formatNumber, parseQuantity } from "../format";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Motion";

/** Keuze uit enkele opties, met een wit vlak dat naar de gekozen optie schuift. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ "--n": options.length } as CSSProperties}>
      <span className="segmented-thumb" style={{ "--i": index } as CSSProperties} aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="segment"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Keuzelijst voor een boom (categorieën, plaatsen); subniveaus springen in. */
export function TreeSelect({
  nodes,
  value,
  onChange,
  empty,
  disabled,
  className,
  label,
}: {
  nodes: FlatNode<TreeNode>[];
  value: string | null;
  onChange: (id: string | null) => void;
  empty: string;
  /** Opties die niet gekozen mogen worden (bv. een categorie onder zichzelf hangen). */
  disabled?: Set<string>;
  className?: string;
  label?: string;
}) {
  return (
    <select className={className} aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{empty}</option>
      {nodes.map((n) => (
        <option key={n.id} value={n.id} disabled={disabled?.has(n.id)}>
          {"    ".repeat(n.depth) + n.name}
        </option>
      ))}
    </select>
  );
}

export function ToneSwatches({ value, onChange }: { value: Tone | null; onChange: (tone: Tone) => void }) {
  return (
    <div className="tone-swatches" role="radiogroup" aria-label="Kleur">
      {TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          aria-label={tone}
          className={`tone-swatch tone-${tone}`}
          onClick={() => onChange(tone)}
        >
          {value === tone && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );
}

export function Avatar({
  member,
  size,
}: {
  member: Pick<Member, "name" | "color"> | undefined;
  size?: "sm" | "lg";
}) {
  return (
    <span className={`avatar ${size ?? ""} tone-${member?.color ?? "butter"}`} aria-hidden="true">
      {member?.name.charAt(0).toUpperCase() ?? "?"}
    </span>
  );
}

/** Hoeveelheid met − en + knoppen; je kan ook gewoon typen (1,5). */
export function QuantityField({
  value,
  onChange,
  min = 0,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  label: string;
}) {
  const parsed = parseQuantity(value);
  const current = parsed === null || Number.isNaN(parsed) ? 0 : parsed;
  const step = (delta: number) => onChange(formatNumber(Math.max(min, Math.round((current + delta) * 1000) / 1000)));

  return (
    <div className="quantity-field">
      <button type="button" className="btn btn-outline btn-icon" onClick={() => step(-1)} aria-label="Eén minder" disabled={current <= min}>
        <Icon name="minus" />
      </button>
      <input
        inputMode="decimal"
        value={value}
        aria-label={label}
        aria-invalid={Number.isNaN(parsed)}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="btn btn-outline btn-icon" onClick={() => step(1)} aria-label="Eén meer">
        <Icon name="plus" />
      </button>
    </div>
  );
}

/** Aan/uit-schakelaar met een label ervoor. */
export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="switch-field">
      <span style={{ display: "grid", gap: 2 }}>
        <span className="label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)} />
    </label>
  );
}

export type AlertTone = "busy" | "ok" | "partial" | "none";

const ALERT_ICONS: Record<AlertTone, IconName> = { busy: "loader", ok: "sparkles", partial: "alert", none: "alert" };

/** Korte melding in een formulier: bezig, gelukt, half gelukt of niet gelukt. */
export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  return (
    <p className={`alert alert-${tone}`} role="status">
      {tone === "busy" ? <Spinner /> : <Icon name={ALERT_ICONS[tone]} size={16} />}
      <span>{children}</span>
    </p>
  );
}

/** Knop die tijdens het opslaan een draaiend icoontje toont. */
export function SubmitButton({ busy, children, className = "btn btn-primary" }: { busy: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="submit" className={className} disabled={busy}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}
