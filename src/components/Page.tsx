import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "../router";
import { TONES, type Tone } from "../../shared/types";
import { useSession } from "../session";
import { Avatar } from "./Controls";
import { Icon, type IconName } from "./Icon";

export type { Tone };

type Back = { to: string | -1; label: string };

function BackLink({ back, className, children }: { back: Back; className?: string; children: ReactNode }) {
  const navigate = useNavigate();
  if (back.to === -1) {
    return (
      <button type="button" className={className} onClick={() => navigate(-1)}>
        {children}
      </button>
    );
  }
  return (
    <Link to={back.to} className={className}>
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
 * - `primary`: de hoofdactie van het scherm. Op tablet rechtsboven in de paneelbalk; op een gsm doet de zwevende + knop dat.
 *
 * Op een gsm verschijnt bovenaan een kleine titelbalk zodra de grote titel uit beeld schuift.
 */
export function PageHead({
  title,
  badge,
  description,
  back,
  actions,
  primary,
}: {
  title: string;
  badge?: ReactNode;
  description?: ReactNode;
  back?: Back;
  actions?: ReactNode;
  primary?: ReactNode;
}) {
  const { membership, email } = useSession();
  const me = membership?.member;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  // Zodra de onderkant van de grote titel onder de balk schuift. Eén meting per frame.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = titleRef.current;
      if (el) setCompact(el.getBoundingClientRect().bottom < 50);
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
          {back ? <BackLink back={back}>{back.label}</BackLink> : <Link to="/">Thuis</Link>}
          <Icon name="next" size={14} className="sep" />
          <span className="current">{title}</span>
        </nav>
        <div className="panel-actions">
          {primary}
          {me && (
            <>
              <span className="panel-sep" />
              <Link to="/meer" className="panel-avatar" title={`${me.name} · ${email}`} aria-label="Instellingen">
                <Avatar member={me} />
              </Link>
            </>
          )}
        </div>
      </div>

      {back && (
        <BackLink back={back} className="crumb">
          <Icon name="back" size={16} /> {back.label}
        </BackLink>
      )}
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

      <div className="topbar" data-visible={compact} aria-hidden={!compact}>
        <div className="topbar-side">
          {back && (
            <BackLink back={back} className="btn btn-ghost btn-icon btn-sm">
              <Icon name="back" />
            </BackLink>
          )}
        </div>
        <span className="topbar-title">{title}</span>
        <div className="topbar-side" />
      </div>
    </>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={18} />
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
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
