// Onderdelen van Verbanden die kaart en lijst delen: het zoekveld met treffers, een rij per ander eind, wat een lijst
// binnenkrijgt en doorgeeft (als paneel, op gsm als eigen scherm, of ingeklapt in de lijst), wat voor iemand niet
// werkt, en wat een selectie lijsten met elkaar verbindt.

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AGENDA_NOTE,
  betweenLists,
  betweenSelection,
  HIT_GROUPS,
  linkKey,
  VIEW_ORDER,
  viewOf,
  viewsOf,
  VIEWS,
  type HitGroup,
  type Link as LinkDef,
  type LinkHit,
  type LinkProblem,
  type LinksResponse,
} from "../../shared/links";
import type { ListNode } from "../../shared/model";
import { formatDay } from "../format";
import { Link } from "../router";
import { Avatar } from "./Controls";
import { Icon } from "./Icon";
import { byOther, cut, endOf, LinkSchema, LinkSwatch, total, VIEW_ICONS } from "./LinkMap";

// ---------- zoeken ----------

const PER_GROUP = 5;

const foldChar = (c: string) =>
  c
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** De woorden uit je zoekvraag in een tekst gemarkeerd (zonder hoofdletters of accenten). */
export function Mark({ text, query }: { text: string; query: string }) {
  const words = foldChar(query).split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const chars = [...text];
  // Per teken van de gevouwen tekst: bij welk teken van het origineel het hoort.
  let folded = "";
  const from: number[] = [];
  chars.forEach((c, i) => {
    const f = foldChar(c);
    folded += f;
    for (let k = 0; k < f.length; k++) from.push(i);
  });
  const on = new Array<boolean>(chars.length).fill(false);
  for (const w of words) {
    for (let at = folded.indexOf(w); at >= 0; at = folded.indexOf(w, at + 1)) {
      for (let k = at; k < at + w.length; k++) on[from[k]] = true;
    }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i === chars.length || on[i] !== on[start]) {
      const piece = chars.slice(start, i).join("");
      parts.push(on[start] ? <mark key={start}>{piece}</mark> : piece);
      start = i;
    }
  }
  return <>{parts}</>;
}

/**
 * Zoeken in je verbanden. Met `popover` (de kaart) liggen de treffers onder het veld, per groep; pijltjes kiezen, Enter
 * opent, Escape sluit (en wist bij een tweede keer). Zonder (de lijst) filtert de lijst zelf.
 */
export function LinkSearch({
  query,
  onQuery,
  hits,
  popover,
  onPick,
}: {
  query: string;
  onQuery: (q: string) => void;
  hits: LinkHit[];
  popover: boolean;
  onPick: (hit: LinkHit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const groups = (Object.keys(HIT_GROUPS) as HitGroup[])
    .map((g) => ({
      g,
      hits: hits.filter((h) => h.group === g).slice(0, PER_GROUP),
    }))
    .filter((x) => x.hits.length);
  const flat = groups.flatMap((x) => x.hits);
  const show = popover && open && query.trim().length > 0;
  const pick = (h: LinkHit) => {
    onPick(h);
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (show) setOpen(false);
      else onQuery("");
      return;
    }
    if (!show) {
      if (e.key === "ArrowDown" && popover) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      pick(flat[active]);
    }
  };

  return (
    <div className="lm-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <label className="search">
        <Icon name="search" size={16} />
        <input
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          placeholder="Zoek een lijst, ding, formulier of weergave"
          aria-label="Zoeken in verbanden"
          role={popover ? "combobox" : undefined}
          aria-expanded={popover ? show : undefined}
          aria-controls={popover ? `${id}-hits` : undefined}
          aria-autocomplete={popover ? "list" : undefined}
          aria-activedescendant={show && flat[active] ? `${id}-${active}` : undefined}
          onChange={(e) => {
            onQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {query && (
        <span className="lm-search-end">
          <span className="lm-search-count" aria-live="polite">
            {hits.length === 1 ? "1 treffer" : `${hits.length} treffers`}
          </span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Zoekvraag wissen" onClick={() => onQuery("")}>
            <Icon name="close" size={14} />
          </button>
        </span>
      )}
      {show && (
        <div className="lm-hits" id={`${id}-hits`} role="listbox" aria-label="Treffers">
          {groups.length ? (
            groups.map(({ g, hits: some }) => (
              <div key={g} role="group" aria-label={HIT_GROUPS[g]}>
                <div className="lm-hits-head" aria-hidden="true">
                  {HIT_GROUPS[g]}
                </div>
                {some.map((h) => {
                  const i = flat.indexOf(h);
                  return (
                    <div
                      key={h.key}
                      id={`${id}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="lm-hit-row"
                      onPointerDown={(e) => e.preventDefault()}
                      onPointerMove={() => setActive(i)}
                      onClick={() => pick(h)}
                    >
                      <span className="lm-hit-title">
                        <Mark text={h.title} query={query} />
                      </span>
                      {h.detail && (
                        <span className="lm-hit-detail">
                          <Mark text={h.detail} query={query} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <p className="lm-hits-empty">Niets gevonden</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- wat een lijst binnenkrijgt en doorgeeft ----------

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Wat een lijst (of weergave) binnenkrijgt, doorgeeft, in welke weergaven ze staat en wat ze met haar eigen dingen doet. */
export function linkParts(id: string, links: LinkDef[], data: LinksResponse) {
  const mine = links.filter((l) => l.from === id || l.to === id);
  const isView = (l: LinkDef) => viewOf(l.from === id ? l.to : l.from) !== null;
  return {
    mine,
    incoming: byOther(
      mine.filter((l) => l.to === id && !isView(l)),
      id,
    ),
    outgoing: byOther(
      mine.filter((l) => l.from === id && !isView(l)),
      id,
    ),
    views: byOther(mine.filter(isView), id).sort(([a], [b]) => VIEW_ORDER.indexOf(viewOf(a)!) - VIEW_ORDER.indexOf(viewOf(b)!)),
    own: data.own[id] ?? [],
  };
}

const thingsOf = (ls: LinkDef[]) => ls.flatMap((l) => l.things ?? []).sort((a, b) => b.count - a.count);
const lastOf = (ls: LinkDef[]) => ls.reduce<string | null>((a, l) => later(a, l.last), null);

function Chips({ links, max }: { links: LinkDef[]; max: number }) {
  const things = thingsOf(links);
  if (!things.length) return null;
  return (
    <span className="lm-chips">
      {things.slice(0, max).map((t) => (
        <span key={t.name} className="lm-chip">
          {t.name} <span className="num">{t.count}</span>
        </span>
      ))}
      {things.length > max && <span className="lm-chip">+{things.length - max}</span>}
    </span>
  );
}

/** Eén rij per ander eind (een lijst of weergave), met wat de verbanden doen, hoe vaak, wanneer laatst en met welke dingen. */
export function LinkEndRow({ other, links, byId, onSelect }: { other: string; links: LinkDef[]; byId: Map<string, ListNode>; onSelect: (id: string) => void }) {
  const end = endOf(other, byId);
  if (!end) return null;
  const count = total(links);
  const last = lastOf(links);
  const view = viewOf(other) !== null;
  return (
    <li>
      <button type="button" className="row lm-end" onClick={() => onSelect(other)}>
        <span className="lm-end-lead">
          {view ? (
            <span className="row-media lm-view-media">
              <Icon name={end.icon} size={14} />
            </span>
          ) : (
            [...new Set(links.map((l) => l.kind))].map((k) => <LinkSwatch key={k} kind={k} />)
          )}
        </span>
        <span className="row-main">
          <span className="row-title">{end.name}</span>
          <span className="lm-end-text">{links.flatMap((l) => l.texts).join(" · ")}</span>
          <Chips links={links} max={5} />
        </span>
        <span className="lm-end-side">
          {count > 0 && <span className="row-end">{count}×</span>}
          {last && <span className="lm-end-last">{formatDay(last)}</span>}
        </span>
      </button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lm-section">
      <h3 className="lm-cap">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Eén gekozen lijst of weergave: wat erin toekomt en waar ze naartoe gaat (per ander eind één rij), de weergaven, wat
 * ze met haar eigen dingen doet en wie erbij is. Op tablet één kaart in twee kolommen (onder de kaart); op gsm
 * (`phone`) een eigen scherm: het schema bovenaan, dan elk deel in een eigen kaart.
 */
export function LinkDetail({
  id,
  data,
  links,
  byId,
  onSelect,
  onClose,
  meta,
  phone = false,
}: {
  id: string;
  data: LinksResponse;
  links: LinkDef[];
  byId: Map<string, ListNode>;
  onSelect: (id: string) => void;
  onClose?: () => void;
  /** De regel onder de naam (tag, dingen, laatst). */
  meta: string;
  phone?: boolean;
}) {
  const view = viewOf(id);
  const list = byId.get(id);
  const end = endOf(id, byId);
  const { mine, incoming, outgoing, views, own } = linkParts(id, links, data);
  const people = list ? (data.people[id] ?? []) : [];
  const problems = data.problems.filter((p) => p.list === id || p.to === id);
  const to = view ? VIEWS[view].to : list ? `/lijsten/${list.id}` : null;

  const rows = (entries: [string, LinkDef[]][]) => (
    <ul className="rows">
      {entries.map(([other, ls]) => (
        <LinkEndRow key={other} other={other} links={ls} byId={byId} onSelect={onSelect} />
      ))}
    </ul>
  );
  const box = (content: ReactNode) => (phone ? <section className="card">{content}</section> : content);
  const part = (title: string, entries: [string, LinkDef[]][]) => entries.length > 0 && <Section title={title}>{box(rows(entries))}</Section>;
  const ownPart = own.length > 0 && (
    <Section title="In de lijst zelf">
      {box(
        <ul className="rows">
          {own.map((t) => (
            <li key={t}>
              <div className="row lm-end">
                <span className="lm-end-lead">
                  <Icon name="repeat" size={14} />
                </span>
                <span className="row-main">
                  <span className="lm-end-text">{t}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>,
      )}
    </Section>
  );
  const agenda = view === "agenda" && <Section title="Al je lijsten">{box(<p className="lm-note">{AGENDA_NOTE}</p>)}</Section>;
  const who = people.length > 0 && (
    <Section title="Wie">
      {box(
        <div className="lm-people">
          {people.map((p) => (
            <span key={p.id} className="lm-person">
              <Avatar member={{ name: p.name, color: null }} size="sm" />
              {p.name}
            </span>
          ))}
        </div>,
      )}
    </Section>
  );
  const nothing = !mine.length && !own.length && view !== "agenda" && <p className="lm-note">Nog geen verbanden</p>;

  if (phone) {
    return (
      <div className="lm-detail lm-detail-phone">
        {(incoming.length > 0 || outgoing.length > 0 || views.length > 0) && (
          <section className="card lm-schema-card">
            <LinkSchema id={id} incoming={incoming} outgoing={outgoing} views={viewsOf(links, id)} problems={data.problems} byId={byId} onSelect={onSelect} />
          </section>
        )}
        <LinkProblems problems={problems} byId={byId} />
        {part("Komt van", incoming)}
        {part("Gaat naar", outgoing)}
        {part("Weergaven", views)}
        {ownPart}
        {agenda}
        {who}
        {nothing}
        {to && (
          <Link to={to} className="btn btn-outline lm-open">
            {view ? `Naar ${VIEWS[view].label}` : `${list?.name ?? ""} openen`}
          </Link>
        )}
      </div>
    );
  }

  return (
    <section className="card lm-detail" aria-label={end?.name}>
      <header className="lm-detail-head">
        {end && (
          <span className={`row-media${end.tone ? ` tone-${end.tone}` : ""}`}>
            <Icon name={end.icon} size={16} />
          </span>
        )}
        <div className="lm-detail-title">
          <h2 className="card-title">{end?.name}</h2>
          {meta && <p className="card-desc">{meta}</p>}
        </div>
        <div className="lm-detail-actions">
          {to && (
            <Link to={to} className="btn btn-outline btn-sm">
              Openen
            </Link>
          )}
          {onClose && (
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Sluiten" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>
      {problems.length > 0 && <LinkProblems problems={problems} byId={byId} inline />}
      <div className="lm-detail-grid">
        <div>
          {part("Komt van", incoming)}
          {part("Gaat naar", outgoing)}
          {ownPart}
          {agenda}
          {nothing}
        </div>
        {(views.length > 0 || who) && (
          <div>
            {part("Weergaven", views)}
            {who}
          </div>
        )}
      </div>
    </section>
  );
}

/** Ingeklapt in de lijst: per ander eind één regel, de weergaven als chips. Een tik springt naar dat eind. */
export function LinkInline({
  id,
  data,
  links,
  byId,
  onJump,
}: {
  id: string;
  data: LinksResponse;
  links: LinkDef[];
  byId: Map<string, ListNode>;
  onJump: (id: string) => void;
}) {
  const { incoming, outgoing, views, own } = linkParts(id, links, data);
  const sub = ([other, ls]: [string, LinkDef[]]) => {
    const end = endOf(other, byId);
    if (!end) return null;
    const count = total(ls);
    const last = lastOf(ls);
    return (
      <button key={other} type="button" className="lm-sub" onClick={() => onJump(other)}>
        <span className="lm-sub-lead">
          {[...new Set(ls.map((l) => l.kind))].map((k) => (
            <LinkSwatch key={k} kind={k} />
          ))}
        </span>
        <span className="lm-sub-main">
          <span className="lm-sub-title">
            <strong>{end.name}</strong> <span className="lm-sub-text">{ls.flatMap((l) => l.texts).join(" · ")}</span>
          </span>
          <Chips links={ls} max={4} />
        </span>
        {count > 0 && <span className="num lm-sub-count">{count}×</span>}
        {last && <span className="lm-sub-last">{formatDay(last)}</span>}
      </button>
    );
  };
  return (
    <div className="lm-inline">
      {incoming.length > 0 && (
        <>
          <div className="lm-cap">Komt van</div>
          {incoming.map(sub)}
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <div className="lm-cap">Gaat naar</div>
          {outgoing.map(sub)}
        </>
      )}
      {(views.length > 0 || own.length > 0) && (
        <>
          <div className="lm-cap">{views.length ? "Weergaven" : "In de lijst zelf"}</div>
          <div className="lm-chips lm-inline-chips">
            {views.map(([other, ls]) => {
              const end = endOf(other, byId);
              const count = total(ls);
              return (
                end && (
                  <button key={other} type="button" className="lm-chip lm-chip-button" onClick={() => onJump(other)}>
                    <Icon name={end.icon} size={12} /> {end.name}
                    {count > 0 && <span className="num">{count}×</span>}
                  </button>
                )
              );
            })}
            {own.map((t) => (
              <span key={t} className="lm-chip lm-chip-line">
                {views.length ? `In de lijst zelf: ${t}` : t}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- wat niet werkt ----------

/**
 * Verbanden die voor iemand niet werken: wie in een lijst kan bewerken maar een lijst niet ziet waar die van afhangt.
 * Eén regel per persoon, met een knop naar de mensen van de lijst die je beheert (wie de ontbrekende lijst beheert, kan
 * hem toevoegen). `inline`: zonder eigen kaart (in het paneel).
 */
export function LinkProblems({ problems, byId, inline = false }: { problems: LinkProblem[]; byId: Map<string, ListNode>; inline?: boolean }) {
  if (!problems.length) return null;
  const name = (id: string) => byId.get(id)?.name ?? "";
  const list = (
    <ul className="lm-problems-list">
      {problems.map((p) => {
        const add = byId.get(p.to)?.role === "beheerder";
        return (
          <li key={`${p.list}|${p.to}|${p.person}`} className="lm-problem">
            <span className="lm-problem-icon">
              <Icon name="alert" size={15} />
            </span>
            <span className="lm-problem-text">
              {p.name} ziet {name(p.to)} niet
            </span>
            <Link to={`/lijsten/${add ? p.to : p.list}/instellingen?tab=mensen`} className="btn btn-outline btn-sm">
              {add ? `${p.name} toevoegen` : `Mensen van ${cut(name(p.list), 18)}`}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return inline ? (
    <div className="lm-problems lm-problems-inline">{list}</div>
  ) : (
    <section className="card lm-problems" aria-label="Werkt niet voor iedereen">
      {list}
    </section>
  );
}

// ---------- een selectie ----------

const TOGETHER = ["", "", "beide", "alle drie", "alle vier", "alle vijf", "alle zes", "alle zeven", "alle acht", "alle negen", "alle tien"];
const S_W = 360;

/** Een klein schema van je selectie: de lijsten op een rij, de verbanden ertussen als lijn of boog, met hoe vaak. */
function SelectionSchema({ ids, links, byId }: { ids: string[]; links: LinkDef[]; byId: Map<string, ListNode> }) {
  const x = (i: number) => (S_W * (i + 0.5)) / ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const lift = (l: LinkDef) => {
    const gap = Math.abs(index.get(l.from)! - index.get(l.to)!);
    return gap <= 1 && l.kind === "log" ? 0 : 14 + (gap - 1) * 16 + (l.kind === "ref" ? 10 : 0);
  };
  const top = Math.max(0, ...links.map(lift));
  const y = 22 + top;
  const height = y + 40;
  return (
    <svg
      viewBox={`0 0 ${S_W} ${height}`}
      width="100%"
      className="lm-selection-schema"
      role="img"
      aria-label={links.map((l) => `${byId.get(l.from)?.name} naar ${byId.get(l.to)?.name}`).join(", ")}
    >
      {links.map((l) => {
        const a = x(index.get(l.from)!);
        const b = x(index.get(l.to)!);
        const h = lift(l);
        return (
          <path
            key={`${l.kind}${l.from}${l.to}`}
            d={h ? `M ${a} ${y} C ${a} ${y - h * 1.3}, ${b} ${y - h * 1.3}, ${b} ${y}` : `M ${a} ${y} H ${b}`}
            className={`lm-line lm-${l.kind}`}
          />
        );
      })}
      {links.map((l) => {
        const n = l.count ?? 0;
        if (!n) return null;
        const mid = (x(index.get(l.from)!) + x(index.get(l.to)!)) / 2;
        const label = `${n}×`;
        const w = label.length * 7 + 10;
        return (
          <g key={`n${l.kind}${l.from}${l.to}`} className="lm-count">
            <rect x={mid - w / 2} y={y - lift(l) - 9} width={w} height={18} rx={9} />
            <text x={mid} y={y - lift(l) + 4} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
      {ids.map((id, i) => (
        <g key={id}>
          <rect className="lm-station lm-mixed" x={x(i) - 8} y={y - 8} width={16} height={16} rx={8} strokeWidth={3} />
          <text x={x(i)} y={y + 28} textAnchor="middle" className="lm-name">
            {cut(byId.get(id)?.name ?? "", Math.max(6, Math.floor(S_W / ids.length / 7.5)))}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Tussen je selectie: de verbanden tussen twee ervan, de weergaven waar ze samen in staan, en wat niet werkt. */
export function SelectionCard({
  ids,
  data,
  links,
  byId,
  onRemove,
  onSelect,
}: {
  ids: string[];
  data: LinksResponse;
  links: LinkDef[];
  byId: Map<string, ListNode>;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { links: between, views } = betweenSelection(links, ids);
  const problems = data.problems.filter((p) => ids.includes(p.list) || ids.includes(p.to));
  const name = (id: string) => byId.get(id)?.name ?? "";
  const together = (lists: string[]) => (lists.length === ids.length && TOGETHER[lists.length] ? TOGETHER[lists.length] : lists.map(name).join(", "));
  return (
    <section className="card lm-selection" aria-label="Tussen je selectie">
      <h2 className="card-title">Tussen je selectie</h2>
      <div className="lm-chips">
        {ids.map((id) => (
          <button key={id} type="button" className="lm-chip lm-chip-button lm-chip-line" aria-label={`${name(id)} uit je selectie`} onClick={() => onRemove(id)}>
            {name(id)} <Icon name="close" size={12} />
          </button>
        ))}
      </div>
      {ids.length > 1 && (
        <>
          {between.length > 0 && ids.length <= 6 && <SelectionSchema ids={ids} links={between} byId={byId} />}
          <Section title="Verbanden">
            {between.length ? (
              <ul className="rows">
                {between.map((l) => (
                  <li key={`${l.kind}${l.from}${l.to}`}>
                    <button type="button" className="row lm-end" onClick={() => onSelect(l.from)}>
                      <span className="lm-end-lead">
                        <LinkSwatch kind={l.kind} />
                      </span>
                      <span className="row-main">
                        <span className="row-title">
                          {name(l.from)} → {name(l.to)}
                        </span>
                        <span className="lm-end-text">{l.texts.join(" · ")}</span>
                      </span>
                      {(l.count ?? 0) > 0 && (
                        <span className="lm-end-side">
                          <span className="row-end">{l.count}×</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lm-note">Geen verbanden tussen deze lijsten</p>
            )}
          </Section>
          {views.length > 0 && (
            <Section title="Samen in">
              <ul className="lm-together">
                {views.map((v) => (
                  <li key={v.view}>
                    <Icon name={VIEW_ICONS[v.view]} size={14} />
                    <span className="lm-together-name">{VIEWS[v.view].label}</span>
                    <span className="lm-together-lists">{together(v.lists)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      {problems.length > 0 && <LinkProblems problems={problems} byId={byId} inline />}
    </section>
  );
}

/** Wat tussen lijsten loopt (voor de kaart met je selectie). */
export const selectionLit = (links: LinkDef[], ids: string[]) => ({
  nodes: new Set(ids),
  links: new Set(
    betweenLists(links)
      .filter((l) => ids.includes(l.from) && ids.includes(l.to))
      .map(linkKey),
  ),
});
