import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "../router";
import { TONES, type Tone } from "../../shared/types";
import { useSession } from "../session";
import { Avatar } from "./Controls";
import { Icon, type IconName } from "./Icon";

export type { Tone };

type Back = { to: string | -1; label: string };

function BackLink({ back, className, label, children }: { back: Back; className?: string; label?: string; children: ReactNode }) {
  const navigate = useNavigate();
  if (back.to === -1) {
    return (
      <button type="button" className={className} aria-label={label} onClick={() => navigate(-1)}>
        {children}
      </button>
    );
  }
  return (
    <Link to={back.to} className={className} aria-label={label}>
      {children}
    </Link>
  );
}

/**
 * Kop van elk scherm (zie STIJLBOEK.md → Paginakop).
 *
 * - `badge`: korte status naast de titel ("2 bijna op");
 * - `description`: korte uitleg; op tablet klein en grijs naast de titel;
 * - `back`: waar "terug" naartoe gaat; wordt ook het eerste stuk van het kruimelpad;
 * - `actions`: acties op het item zelf (bv. Bewerken), rechts naast de titel;
 * - `primary`: de hoofdactie van het scherm. Op tablet rechtsboven in de paneelbalk; op een gsm doet de + in de
 *   onderbalk dat (`useAddAction`).
 *
 * Op een gsm staat bovenaan de kop (48 px, op de schil): terug of het merk links, zoeken en jouw letter rechts. Zodra
 * de grote titel onder de kop schuift, verschijnt hij klein in het midden van de kop.
 */
export function PageHead({
  title,
  badge,
  description,
  back,
  top = false,
  actions,
  primary,
}: {
  title: string;
  badge?: ReactNode;
  description?: ReactNode;
  back?: Back;
  /** Een plek uit het menu (een bord, Verbanden): geen kruimelpad ervoor. */
  top?: boolean;
  actions?: ReactNode;
  primary?: ReactNode;
}) {
  const { person: me, openSearch, boards } = useSession();
  // Het beginscherm: je eerste bord.
  const home = boards[0]?.name ?? "Overzicht";
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  // Zodra de onderkant van de grote titel onder de balk schuift. Eén meting per frame.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = titleRef.current;
      const head = document.querySelector(".phone-head")?.getBoundingClientRect().bottom ?? 48;
      if (el) setCompact(el.getBoundingClientRect().bottom < head);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="panel-bar">
        <nav className="breadcrumb" aria-label="Kruimelpad">
          {/* Een plek uit het menu staat op zichzelf; de rest komt van je beginscherm (of van waar je kwam). */}
          {(back || !top) && (
            <>
              {back ? <BackLink back={back}>{back.label}</BackLink> : <Link to="/">{home}</Link>}
              <Icon name="next" size={14} className="sep" />
            </>
          )}
          <span className="current">{title}</span>
        </nav>
        <div className="panel-actions">
          {primary}
          {me.id && (
            <>
              <span className="panel-sep" />
              <Link to="/ik" className="panel-avatar" title={`${me.name} · ${me.email ?? ""}`} aria-label="Jouw gegevens">
                <Avatar member={me} />
              </Link>
            </>
          )}
        </div>
      </div>

      <header className="phone-head" data-compact={compact}>
        {back ? (
          <BackLink back={back} className="phone-head-button" label={`Terug naar ${back.label}`}>
            <Icon name="back" size={20} />
          </BackLink>
        ) : (
          <Link to="/" className="phone-head-brand">
            <span className="brand-mark">
              <Icon name="home" size={15} />
            </span>
            <span>Thuis</span>
          </Link>
        )}
        <span className="phone-head-title" aria-hidden="true">
          {title}
        </span>
        <div className="phone-head-actions">
          <button type="button" className="phone-head-button" aria-label="Zoeken" onClick={openSearch}>
            <Icon name="search" size={18} />
          </button>
          {me.id && (
            <Link to="/ik" className="phone-head-avatar" aria-label="Jouw gegevens">
              <Avatar member={me} />
            </Link>
          )}
        </div>
      </header>
      <header className="page-head">
        <div className="page-title">
          <h1 ref={titleRef}>
            {title}
            {badge}
          </h1>
          {description && <p className="page-desc">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
    </>
  );
}

/** Een lege lijst: een icoon, wat er nog niet is, en hooguit één knop om te beginnen. Geen uitleg. */
export function EmptyState({ icon, title, action }: { icon: IconName; title: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={18} />
      </span>
      <strong>{title}</strong>
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

/** Iets zonder eigen kleur krijgt op basis van zijn naam altijd dezelfde kleur. */
export function toneForCategory(category: string | null): Tone {
  if (!category) return "butter";
  let hash = 0;
  for (const ch of category.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}
