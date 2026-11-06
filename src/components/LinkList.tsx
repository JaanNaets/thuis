// Verbanden als lijst (zie STIJLBOEK.md → Verbanden): groepen die je open- en dichtklapt, per lijst een rij die
// openklapt met wat ze binnenkrijgt en doorgeeft, en een selectiemodus met vinkjes. Op gsm de enige weergave.

import { useEffect, useRef } from "react";
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
  wide,
  onMap,
  onDetail,
  onJump,
  hits,
  query,
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
  wide: boolean;
  onMap: (id: string) => void;
  onDetail: (id: string) => void;
  onJump: (id: string) => void;
  /** Tijdens zoeken: waarom een rij er staat. */
  hits: LinkHit[];
  query: string;
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
                    wide={wide}
                    onMap={onMap}
                    onDetail={onDetail}
                    onJump={onJump}
                    hit={query ? hits.find((h) => h.nodes.includes(id) && h.group !== "lijsten") : undefined}
                    query={query}
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
  wide,
  onMap,
  onDetail,
  onJump,
  hit,
  query,
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
  wide: boolean;
  onMap: (id: string) => void;
  onDetail: (id: string) => void;
  onJump: (id: string) => void;
  hit: LinkHit | undefined;
  query: string;
}) {
  const end = endOf(id, byId);
  if (!end) return null;
  const view = viewOf(id);
  const list = byId.get(id);
  const has = links.some((l) => l.from === id || l.to === id) || (data.own[id]?.length ?? 0) > 0;
  const sum = linkSummary(links, id);
  const lists = view ? new Set(links.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : []))).size : 0;
  const summary = has
    ? [
        view && plural(lists, "lijst", "lijsten"),
        sum.in && `${sum.in} binnen`,
        sum.out && `${sum.out} buiten`,
        sum.views && plural(sum.views, "weergave", "weergaven"),
        list && listMeta(list, data.counts),
      ]
        .filter(Boolean)
        .join(" · ")
    : "Geen verbanden";
  const meta = hit ? <Mark text={`${hit.title} · ${hit.detail}`.replace(/ · $/, "")} query={query} /> : summary;
  const last = lastText(data.counts[id]?.last);
  const to = view ? null : `/lijsten/${id}`;
  const media = (
    <span className={`row-media${end.tone ? ` tone-${end.tone}` : ""}`}>
      <Icon name={end.icon} size={16} />
    </span>
  );
  const main = (
    <span className="row-main">
      <span className="row-title">
        <Mark text={end.name} query={query} />
      </span>
      <span className="row-meta">
        <span>{meta}</span>
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
    <li id={`lm-row-${id}`} className={`lm-row${expanded ? " open" : ""}${has ? "" : " lm-row-none"}`}>
      <div className="lm-row-head">
        {has ? (
          <button type="button" className="lm-row-main" aria-expanded={expanded} onClick={() => onToggle(id)}>
            <Icon name={expanded ? "down" : "next"} size={16} className="lm-chev" />
            {media}
            {main}
          </button>
        ) : (
          <div className="lm-row-main">
            <span className="lm-chev-space" />
            {media}
            {main}
          </div>
        )}
        <span className="lm-row-end">
          {wide && last && <span className="lm-row-last">{last}</span>}
          <span className="lm-row-actions">
            {wide ? (
              <>
                {!view && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMap(id)}>
                    Op de kaart
                  </button>
                )}
                {to && (
                  <Link to={to} className="btn btn-outline btn-sm">
                    Openen
                  </Link>
                )}
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-icon" aria-label={`Meer over ${end.name}`} onClick={() => onDetail(id)}>
                <Icon name="next" size={16} />
              </button>
            )}
          </span>
        </span>
      </div>
      {expanded && <LinkInline id={id} data={data} links={links} byId={byId} onJump={onJump} />}
    </li>
  );
}
