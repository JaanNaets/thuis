import { useSearchParams } from "react-router";
import { AGENDA_NOTE, LINK_KINDS, LINK_ORDER, VIEW_ORDER, viewOf, VIEWS, type Link, type LinkKind, type LinksResponse, type ViewKey } from "../../shared/links";
import { ROLES, type ListNode } from "../../shared/model";
import { useApi } from "../api";
import { CardHead, FilterSelect, FilterToggle } from "../components/Controls";
import { Icon } from "../components/Icon";
import { LinkLegend, LinkMap, VIEW_ICONS, type MapColumn } from "../components/LinkMap";
import { SkeletonRows, stagger } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { groupByTag, listIcon, listTone } from "../lists";
import { Link as RouterLink } from "../router";
import { useSession } from "../session";

const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/**
 * Verbanden (`/verbanden`, zie STIJLBOEK.md → Verbanden): hoe al je lijsten met elkaar en met de weergaven samenhangen,
 * zoals jij ze ziet. Op tablet een kaart; daaronder (en op gsm enkel) per lijst wat ze verbindt, wat ze met haar eigen
 * dingen doet en wie erbij is. `?lijst=` kiest een lijst of weergave, `?soort=` een soort verband.
 */
export function LinksPage() {
  const { lists, tags } = useSession();
  const { data, error } = useApi<LinksResponse>("/insights/links");
  const [params, setParams] = useSearchParams();
  const kind = (LINK_ORDER as string[]).includes(params.get("soort") ?? "") ? (params.get("soort") as LinkKind) : null;
  const onlyProblems = params.get("werkt") === "niet";
  const set = (key: string, value: string | null) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  // Elke lijst één keer: in de kolom van haar eerste tag.
  const placed = new Set<string>();
  const columns: MapColumn[] = groupByTag(lists, tags)
    .map((g) => ({
      key: g.tag?.id ?? "zonder",
      name: g.tag?.name ?? "Zonder tag",
      lists: g.lists.filter((l) => !placed.has(l.id) && (placed.add(l.id), true)),
    }))
    .filter((c) => c.lists.length);
  const shownLists = columns.flatMap((c) => c.lists);
  const byId = new Map(lists.map((l) => [l.id, l]));

  const links = (data?.links ?? []).filter((l) => !kind || l.kind === kind);
  const views = VIEW_ORDER.filter((v) => links.some((l) => l.from === `view:${v}` || l.to === `view:${v}`));
  const asked = params.get("lijst");
  const selected = asked && (byId.has(asked) || viewOf(asked)) ? asked : null;
  const problems = (data?.problems ?? []).filter((p) => !selected || p.list === selected || p.to === selected);
  const nameOf = (id: string) => byId.get(id)?.name ?? (viewOf(id) ? VIEWS[viewOf(id)!].label : "");

  const cards = selected && viewOf(selected) ? [] : (selected ? shownLists.filter((l) => l.id === selected) : shownLists);

  return (
    <div className="page">
      <PageHead title="Verbanden" />
      <div className="filters">
        <FilterSelect
          label="Lijst"
          all="Alle"
          value={selected}
          onChange={(v) => set("lijst", v)}
          options={[
            ...shownLists.map((l) => ({ value: l.id, label: l.name })),
            ...VIEW_ORDER.map((v) => ({ value: `view:${v}`, label: VIEWS[v].label })),
          ]}
        />
        <FilterSelect label="Soort" all="Alle" value={kind} onChange={(v) => set("soort", v)} options={LINK_ORDER.map((k) => ({ value: k, label: LINK_KINDS[k].label }))} />
        {(data?.problems.length ?? 0) > 0 && (
          <FilterToggle on={onlyProblems} onChange={(on) => set("werkt", on ? "niet" : null)}>
            <Icon name="alert" size={14} /> Werkt niet voor iedereen
          </FilterToggle>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <SkeletonRows rows={6} />}

      {data && problems.length > 0 && (
        <section className="card link-problems">
          <CardHead title="Werkt niet voor iedereen" />
          <ul className="rows">
            {problems.map((p) => (
              <li key={`${p.list}${p.to}${p.person}`}>
                <RouterLink to={`/lijsten/${data.people[p.to]?.some((x) => x.role === "beheerder") && byId.get(p.to)?.role === "beheerder" ? p.to : p.list}/instellingen?tab=mensen`} className="row">
                  <span className="cell-main">
                    <span className="row-media lm-problem-icon">
                      <Icon name="alert" size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{p.name}</span>
                      <span className="row-meta">
                        Kan in {nameOf(p.list)} bewerken, maar ziet {nameOf(p.to)} niet
                      </span>
                    </span>
                  </span>
                  <Icon name="next" size={16} className="row-chevron" />
                </RouterLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && !onlyProblems && (
        <>
          {shownLists.length === 0 ? (
            <EmptyState icon="links" title="Nog geen lijsten" />
          ) : (
            <section className="card linkmap-card only-tablet">
              <LinkLegend kinds={LINK_ORDER.filter((k) => !kind || k === kind).map((k) => ({ kind: k, label: LINK_KINDS[k].label }))} />
              <LinkMap columns={columns} views={views} links={links} selected={selected} onSelect={(id) => set("lijst", id)} />
            </section>
          )}

          {selected && viewOf(selected) && <ViewCard view={viewOf(selected)!} links={links} nameOf={nameOf} byId={byId} onSelect={(id) => set("lijst", id)} />}

          <div className="link-cards stagger">
            {cards.map((l, i) => (
              <ListCard key={l.id} list={l} data={data} links={links} nameOf={nameOf} byId={byId} onSelect={(id) => set("lijst", id)} style={stagger(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Eén verband als rij: het andere eind (een lijst of weergave), de richting, de soort en wat het doet. */
function LinkRow({ link, from, nameOf, byId, onSelect }: { link: Link; from: string; nameOf: (id: string) => string; byId: Map<string, ListNode>; onSelect: (id: string) => void }) {
  const out = link.from === from;
  const other = out ? link.to : link.from;
  const view = viewOf(other);
  const list = byId.get(other);
  return (
    <li>
      <button type="button" className="row" onClick={() => onSelect(other)}>
        <span className="cell-main">
          <span className={`row-media${list ? ` tone-${listTone(list)}` : ""}`}>
            <Icon name={view ? VIEW_ICONS[view] : list ? listIcon(list) : "links"} size={16} />
          </span>
          <span className="row-main">
            <span className="row-title link-row-title">
              <Icon name={out ? "next" : "prev"} size={14} className="link-dir" />
              <span className="sr-only">{out ? "naar" : "van"}</span>
              {nameOf(other)}
              <svg width="20" height="6" aria-hidden="true" className="link-kind">
                <path d="M 1 3 L 19 3" className={`lm-line lm-${link.kind}`} data-on="true" />
              </svg>
            </span>
            <span className="row-meta">{link.texts.join(" · ")}</span>
          </span>
        </span>
        {link.count !== null && <span className="row-end num">{link.count}×</span>}
      </button>
    </li>
  );
}

function ListCard({
  list,
  data,
  links,
  nameOf,
  byId,
  onSelect,
  style,
}: {
  list: ListNode;
  data: LinksResponse;
  links: Link[];
  nameOf: (id: string) => string;
  byId: Map<string, ListNode>;
  onSelect: (id: string) => void;
  style: React.CSSProperties;
}) {
  const mine = links.filter((l) => l.from === list.id || l.to === list.id);
  const own = data.own[list.id] ?? [];
  const people = data.people[list.id] ?? [];
  const counts = data.counts[list.id];
  return (
    <section className="card" style={style}>
      <CardHead
        title={list.name}
        description={counts ? `${list.one ? `${plural(counts.things, "ding", "dingen")} · ` : ""}${plural(counts.events, "gebeurtenis", "gebeurtenissen")}` : undefined}
        action={
          <RouterLink to={`/lijsten/${list.id}`} className="btn btn-outline btn-sm">
            Openen
          </RouterLink>
        }
      />
      <ul className="rows">
        {mine.map((l) => (
          <LinkRow key={`${l.kind}${l.from}${l.to}`} link={l} from={list.id} nameOf={nameOf} byId={byId} onSelect={onSelect} />
        ))}
        {own.length > 0 && (
          <li>
            <div className="row">
              <span className="cell-main">
                <span className={`row-media tone-${listTone(list)}`}>
                  <Icon name="repeat" size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">In de lijst zelf</span>
                  <span className="row-meta">{own.join(" · ")}</span>
                </span>
              </span>
            </div>
          </li>
        )}
        {people.length > 0 && (
          <li>
            <div className="row">
              <span className="cell-main">
                <span className="row-media">
                  <Icon name="users" size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">Wie</span>
                  <span className="row-meta">{people.map((p) => `${p.name}, ${ROLES[p.role].label.toLowerCase()}${p.via ? ` via ${p.via}` : ""}`).join(" · ")}</span>
                </span>
              </span>
            </div>
          </li>
        )}
        {!mine.length && !own.length && (
          <li>
            <div className="row">
              <span className="cell-main">
                <span className="row-title muted">Nog geen verbanden</span>
              </span>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

function ViewCard({ view, links, nameOf, byId, onSelect }: { view: ViewKey; links: Link[]; nameOf: (id: string) => string; byId: Map<string, ListNode>; onSelect: (id: string) => void }) {
  const id = `view:${view}`;
  const mine = links.filter((l) => l.from === id || l.to === id);
  const to = VIEWS[view].to;
  return (
    <section className="card">
      <CardHead
        title={VIEWS[view].label}
        action={
          to ? (
            <RouterLink to={to} className="btn btn-outline btn-sm">
              Openen
            </RouterLink>
          ) : undefined
        }
      />
      <ul className="rows">
        {mine.map((l) => (
          <LinkRow key={`${l.kind}${l.from}${l.to}`} link={l} from={id} nameOf={nameOf} byId={byId} onSelect={onSelect} />
        ))}
        {view === "agenda" && (
          <li>
            <div className="row">
              <span className="cell-main">
                <span className="row-media">
                  <Icon name="calendar" size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">Al je lijsten</span>
                  <span className="row-meta">{AGENDA_NOTE}</span>
                </span>
              </span>
            </div>
          </li>
        )}
        {!mine.length && view !== "agenda" && (
          <li>
            <div className="row">
              <span className="cell-main">
                <span className="row-title muted">Nog geen verbanden</span>
              </span>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}
