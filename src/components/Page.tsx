import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { greeting } from "../device";
import { Icon } from "./Icon";

export type Tone = "peach" | "butter" | "sage" | "mint" | "sky" | "lilac" | "rose";

/** Kop van een hoofdscherm: begroeting, grote titel, korte samenvatting en (op tablet) een actieknop. */
export function PageHero({
  title,
  summary,
  tone,
  action,
}: {
  title: string;
  summary?: ReactNode;
  tone: Tone;
  action?: ReactNode;
}) {
  return (
    <header className={`hero tone-${tone}`}>
      <div>
        <p className="eyebrow">{greeting()}</p>
        <h1>
          <span className="mark">{title}</span>
        </h1>
        {summary && <p className="hero-summary">{summary}</p>}
      </div>
      {action && <div className="hero-action">{action}</div>}
    </header>
  );
}

/** Kop van een detail- of formulierscherm, met terugknop. */
export function PageHeader({ title, back, actions }: { title: string; back: string | -1; actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      <button
        type="button"
        className="icon-button"
        onClick={() => (back === -1 ? navigate(-1) : navigate(back))}
        aria-label="Terug"
      >
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
      {actions}
    </header>
  );
}

export function EmptyState({ icon, tone, children }: { icon: "receipt" | "card"; tone: Tone; children: ReactNode }) {
  return (
    <div className={`empty tone-${tone}`}>
      <span className="empty-mark">
        <Icon name={icon} size={34} />
      </span>
      <p>{children}</p>
    </div>
  );
}

const CATEGORY_TONES: Tone[] = ["peach", "butter", "sage", "mint", "sky", "lilac", "rose"];

/** Elke categorie krijgt altijd dezelfde pastelkleur. */
export function toneForCategory(category: string | null): Tone {
  if (!category) return "butter";
  let hash = 0;
  for (const ch of category.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_TONES[hash % CATEGORY_TONES.length];
}
