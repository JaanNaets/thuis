import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FlatNode, TreeNode } from "../../shared/tree";
import { TONES, type Person, type Tone } from "../../shared/types";
import { formatNumber, parseQuantity } from "../format";
import { Icon, type IconName } from "./Icon";
import { Num, Spinner } from "./Motion";

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
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ "--n": options.length } as CSSProperties}>
      <span className="segmented-thumb" style={{ "--i": index } as CSSProperties} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="segment" onClick={() => onChange(o.value)}>
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

export function Avatar({ member, size }: { member: Pick<Person, "name" | "color"> | undefined; size?: "sm" | "lg" }) {
  return (
    <span className={`avatar ${size ?? ""} tone-${member?.color ?? "butter"}`} aria-hidden="true">
      {member?.name.charAt(0).toUpperCase() ?? "?"}
    </span>
  );
}

/** Hoeveelheid met − en + knoppen; je kan ook gewoon typen (1,5). */
export function QuantityField({ value, onChange, min = 0, label }: { value: string; onChange: (value: string) => void; min?: number; label: string }) {
  const parsed = parseQuantity(value);
  const current = parsed === null || Number.isNaN(parsed) ? 0 : parsed;
  const step = (delta: number) => onChange(formatNumber(Math.max(min, Math.round((current + delta) * 1000) / 1000)));

  return (
    <div className="quantity-field">
      <button type="button" className="btn btn-outline btn-icon" onClick={() => step(-1)} aria-label="Eén minder" disabled={current <= min}>
        <Icon name="minus" />
      </button>
      <input inputMode="decimal" value={value} aria-label={label} aria-invalid={Number.isNaN(parsed)} onChange={(e) => onChange(e.target.value)} />
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

/** Tabs met tellers; een lijn schuift naar de actieve tab. */
export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: T;
  tabs: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<{ x: number; w: number }>();
  const widths = tabs.map((t) => `${t.label}${t.count ?? ""}`).join("|");

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (el) setLine({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, widths]);

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} className="tab" onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && (
            <span className="tab-count">
              <Num value={t.count} />
            </span>
          )}
        </button>
      ))}
      {line && <span className="tabs-indicator" style={{ width: line.w, transform: `translateX(${line.x}px)` }} />}
    </div>
  );
}

/** Filterpil: "Plaats  Keuken ⌄". Het hele vlak opent de gewone keuzelijst van het toestel. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  all,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string; depth?: number }[];
  onChange: (value: string | null) => void;
  /** Tekst voor "geen filter", bv. "Alle". */
  all: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <label className={`filter ${value ? "active" : ""}`}>
      <span className="filter-label">{label}</span>
      <span className="filter-value">{current?.label ?? all}</span>
      <Icon name="down" size={14} />
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {"\u00a0\u00a0\u00a0\u00a0".repeat(o.depth ?? 0) + o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Filter dat je aan- of uitzet ("Bezit", "Archief"). */
export function FilterToggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className="filter" aria-pressed={on} onClick={() => onChange(!on)}>
      {children}
    </button>
  );
}

/**
 * Niveaumeter: tien streepjes die vollopen tot twee keer het minimum.
 * Groen = genoeg, oranje = onder het minimum, rood = op.
 */
export function LevelMeter({ quantity, min }: { quantity: number; min: number }) {
  const filled = quantity <= 0 ? 0 : Math.max(1, Math.min(10, Math.round((quantity / (min * 2)) * 10)));
  const state = quantity <= 0 ? "out" : quantity < min ? "low" : "";
  return (
    <span className={`meter ${state}`} title={`${formatNumber(quantity)} van minimum ${formatNumber(min)}`}>
      <span className="meter-bars" aria-hidden="true">
        {Array.from({ length: 10 }, (_, k) => (
          <i key={k} className={k < filled ? "on" : ""} style={{ "--k": k } as CSSProperties} />
        ))}
      </span>
    </span>
  );
}

/** Kop van een kaart of sectie: titel, korte uitleg en eventueel een actie rechts. */
export function CardHead({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="card-head">
      <div style={{ minWidth: 0 }}>
        <h2 className="card-title">{title}</h2>
        {description && <p className="card-desc">{description}</p>}
      </div>
      {action}
    </header>
  );
}
