import type { ReactNode } from "react";
import type { FlatNode, TreeNode } from "../../shared/tree";
import { TONES, type Member, type Tone } from "../../shared/types";
import { formatNumber, parseQuantity } from "../format";
import { Icon } from "./Icon";

/** Een rij knoppen waarvan er één gekozen is (zoals radioknoppen, maar groot genoeg voor een vinger). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; tone?: Tone }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`segment ${o.tone ? `tone-${o.tone}` : ""}`}
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
}: {
  nodes: FlatNode<TreeNode>[];
  value: string | null;
  onChange: (id: string | null) => void;
  empty: string;
  /** Opties die niet gekozen mogen worden (bv. een categorie onder zichzelf hangen). */
  disabled?: Set<string>;
  className?: string;
}) {
  return (
    <select className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
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
          {value === tone && <Icon name="check" size={18} />}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ member, size = "normal" }: { member: Pick<Member, "name" | "color"> | undefined; size?: "normal" | "small" }) {
  return (
    <span className={`avatar ${size} tone-${member?.color ?? "butter"}`} aria-hidden="true">
      {member?.name.charAt(0).toUpperCase() ?? "?"}
    </span>
  );
}

/** Hoeveelheid met grote − en + knoppen; je kan ook gewoon typen (1,5). */
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
      <button type="button" className="icon-button" onClick={() => step(-1)} aria-label="Eén minder" disabled={current <= min}>
        <Icon name="minus" />
      </button>
      <input
        inputMode="decimal"
        value={value}
        aria-label={label}
        aria-invalid={Number.isNaN(parsed)}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="icon-button" onClick={() => step(1)} aria-label="Eén meer">
        <Icon name="plus" />
      </button>
    </div>
  );
}
