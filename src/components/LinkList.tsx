// Je lijsten als lijst (zie STIJLBOEK.md → Lijsten): groepen die je open- en dichtklapt, per lijst een rij (de naam
// opent de lijst, ▸ klapt open met wat ze binnenkrijgt en doorgeeft, rechts wat de pagina erbij zet: pillen, ⋯), en
// een selectiemodus met vinkjes. Op gsm de enige weergave; op tablet is de kaart de andere.

import { useEffect, useRef, type ReactNode } from "react";
import { linkSummary, viewOf, type Link as LinkDef, type LinkHit, type LinksResponse } from "../../shared/links";
import type { ListNode } from "../../shared/model";
import { Link } from "../router";
import { Icon } from "./Icon";
import { endOf, lastText, listMeta, plural } from "./LinkMap";
import { LinkInline, Mark } from "./LinkParts";

/** Een groep in de lijst: een tag, een soort verband, een weergave of de weergaven zelf. `tone`: het bolletje (null: grijs, undefined: geen). */
export type ListGroup = {
  key: string;
  name: string;
  tone?: string | null;
  ids: string[];
  /** Waar de groep naartoe gaat (de pagina van een tag). */
  to?: string;
};

/** Een vinkje dat ook "een deel" kan tonen (een groep waarvan sommige lijsten gekozen zijn). */
function GroupCheck({ all, some, label, onChange }: { all: boolean; some: boolean; label: string; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !all;
  }, [all, some]);
  return <input ref={ref} type="checkbox" className="lm-check" checked={all} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

export function LinkList({
  groups,
  data,
  links,
  byId,
  open,
  closed,
  onToggle,
  onToggleGroup,
  selecting,
  chosen,
  onChoose,
  onJump,
  hits,
  query,
  end,
  states,
}: {
  groups: ListGroup[];
  data: LinksResponse;
  links: LinkDef[];
  byId: Map<string, ListNode>;
  /** De rijen die openstaan. */
  open: Set<string>;
  /** De groepen die dicht zijn. */
  closed: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (key: string) => void;
  selecting: boolean;
  chosen: string[];
  onChoose: (ids: string[], on: boolean) => void;
  onJump: (id: string) => void;
  /** Tijdens zoeken: waarom een rij er staat. */
  hits: LinkHit[];
  query: string;
  /** Wat rechts in de rij van een lijst staat (tags, mensen, pillen, ⋯); `group`: de groep waarin ze staat. */
  end?: (id: string, group: ListGroup) => ReactNode;
  /** Een toestand in de grijze regel ("niet in het menu"); op een brede tablet tonen de pillen dat. */
  states?: (id: string) => string[];
}) {
  const picked = new Set(chosen);
  const name = (id: string) => endOf(id, byId)?.name ?? "";
  return (
    <section className="card lm-list" aria-label="Je lijsten en hun verbanden">
      {groups.map((g) => {
        const isOpen = !!query || !closed.has(g.key);
        const people = [...new Set(data.problems.filter((p) => g.ids.includes(p.list) || g.ids.includes(p.to)).map((p) => p.name))];
        const all = g.ids.every((id) => picked.has(id));
        const some = g.ids.some((id) => picked.has(id));
        const choosable = g.ids.filter((id) => !viewOf(id));
        return (
          <div key={g.key} className="lm-group">
            <div className="lm-group-head">
              {selecting && choosable.length > 0 && <GroupCheck all={all} some={some} label={`Alles in ${g.name}`} onChange={(on) => onChoose(choosable, on)} />}
              <button type="button" className="lm-group-toggle" aria-expanded={isOpen} onClick={() => onToggleGroup(g.key)}>
                <Icon name={isOpen ? "down" : "next"} size={16} className="lm-chev" />
                {g.tone !== undefined && <span className={`dot${g.tone ? ` tone-${g.tone}` : ""}`} />}
                <span className="lm-group-name">{g.name}</span>
                <span className="group-count">{g.ids.length}</span>
                {!isOpen &&
                  (people.length ? (
                    <span className="lm-group-warn">
                      <Icon name="alert" size={14} /> Werkt niet voor {people.join(", ")}
                    </span>
                  ) : (
                    <span className="lm-group-sum">{g.ids.map(name).join(" · ")}</span>
                  ))}
              </button>
              {g.to && (
                <Link to={g.to} className="btn btn-ghost btn-icon btn-sm" aria-label={`Tag ${g.name}`}>
                  <Icon name="tag" size={15} />
                </Link>
              )}
            </div>
            {isOpen && (
              <ul className="lm-rows">
                {g.ids.map((id) => (
                  <LinkRow
                    key={id}
                    id={id}
                    data={data}
                    links={links}
                    byId={byId}
                    expanded={open.has(id)}
                    onToggle={onToggle}
                    selecting={selecting}
                    on={picked.has(id)}
                    onChoose={onChoose}
                    onJump={onJump}
                    hit={query ? hits.find((h) => h.nodes.includes(id) && h.group !== "lijsten") : undefined}
                    query={query}
                    end={end && !viewOf(id) ? end(id, g) : null}
                    states={states && !viewOf(id) ? states(id) : []}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

function LinkRow({
  id,
  data,
  links,
  byId,
  expanded,
  onToggle,
  selecting,
  on,
  onChoose,
  onJump,
  hit,
  query,
  end,
  states,
}: {
  id: string;
  data: LinksResponse;
  links: LinkDef[];
  byId: Map<string, ListNode>;
  expanded: boolean;
  onToggle: (id: string) => void;
  selecting: boolean;
  on: boolean;
  onChoose: (ids: string[], on: boolean) => void;
  onJump: (id: string) => void;
  hit: LinkHit | undefined;
  query: string;
  end: ReactNode;
  states: string[];
}) {
  const node = endOf(id, byId);
  if (!node) return null;
  const view = viewOf(id);
  const list = byId.get(id);
  const has = links.some((l) => l.from === id || l.to === id) || (data.own[id]?.length ?? 0) > 0;
  const sum = linkSummary(links, id);
  const lists = view ? new Set(links.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : []))).size : 0;
  const summary = [
    view && plural(lists, "lijst", "lijsten"),
    sum.in && `${sum.in} binnen`,
    sum.out && `${sum.out} buiten`,
    sum.views && plural(sum.views, "weergave", "weergaven"),
    list && listMeta(list, data.counts),
    lastText(data.counts[id]?.last),
  ]
    .filter(Boolean)
    .join(" · ");
  const media = (
    <span className={`row-media${node.tone ? ` tone-${node.tone}` : ""}`}>
      <Icon name={node.icon} size={16} />
    </span>
  );
  const main = (
    <span className="row-main">
      <span className="row-title">
        <Mark text={node.name} query={query} />
      </span>
      <span className="row-meta">
        <span>{hit ? <Mark text={`${hit.title} · ${hit.detail}`.replace(/ · $/, "")} query={query} /> : summary}</span>
        {!hit &&
          states.map((s) => (
            <span key={s} className="lo-state">
              {s}
            </span>
          ))}
      </span>
    </span>
  );

  if (selecting) {
    return (
      <li id={`lm-row-${id}`} className={`lm-row${on ? " chosen" : ""}`}>
        <label className="lm-row-main">
          {view ? <span className="lm-check-space" /> : <input type="checkbox" className="lm-check" checked={on} onChange={(e) => onChoose([id], e.target.checked)} />}
          {media}
          {main}
        </label>
      </li>
    );
  }

  return (
    <li id={`lm-row-${id}`} className={`lm-row${expanded ? " open" : ""}`}>
      <div className="lm-row-head">
        {has ? (
          <button type="button" className="lm-row-toggle" aria-expanded={expanded} aria-label={`Verbanden van ${node.name}`} onClick={() => onToggle(id)}>
            <Icon name={expanded ? "down" : "next"} size={16} />
          </button>
        ) : (
          <span className="lm-row-toggle" aria-hidden="true" />
        )}
        {view ? (
          <button type="button" className="lm-row-main" aria-expanded={expanded} onClick={() => onToggle(id)}>
            {media}
            {main}
          </button>
        ) : (
          <Link to={`/lijsten/${id}`} className="lm-row-main">
            {media}
            {main}
          </Link>
        )}
        {end && <span className="lm-row-end">{end}</span>}
      </div>
      {expanded && <LinkInline id={id} data={data} links={links} byId={byId} onJump={onJump} />}
    </li>
  );
}
