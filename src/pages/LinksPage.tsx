import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  betweenLists,
  groupLinkLists,
  LINK_GROUPS,
  LINK_KINDS,
  LINK_ORDER,
  LINK_SORTS,
  litBy,
  searchLinks,
  sortLinkLists,
  VIEW_ORDER,
  viewNode,
  viewOf,
  VIEWS,
  type LinkGroupBy,
  type LinkKind,
  type LinkSort,
  type LinksResponse,
} from "../../shared/links";
import { useApi } from "../api";
import { FilterSelect, FilterToggle, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { LinkList, type ListGroup } from "../components/LinkList";
import { lastText, LinkMapView, LinkSwatch, listMeta, plural, type MapColumn } from "../components/LinkMap";
import { LinkDetail, LinkProblems, LinkSearch, SelectionCard, selectionLit } from "../components/LinkParts";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { useWide } from "../device";
import { groupByTag } from "../lists";
import { useSession } from "../session";

type View = "kaart" | "lijst";

const toggled = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

/**
 * Verbanden (`/verbanden`, zie STIJLBOEK.md → Verbanden): hoe al je lijsten met elkaar en met de weergaven samenhangen,
 * zoals jij ze ziet. Op tablet als metrokaart of als lijst, op gsm enkel als lijst (een gekozen lijst krijgt er een
 * eigen scherm met een schema). Zoeken licht op de kaart op wat overeenkomt en filtert de lijst; in de lijst klap je
 * groepen en lijsten open en dicht, groepeer en sorteer je, en kies je lijsten om te zien wat ze verbindt. De weergave,
 * de gekozen lijst, je selectie, groeperen en sorteren staan in het adres (`?weergave=lijst&lijst=…&keuze=a,b`), zodat
 * terug ook echt terug is.
 */
export function LinksPage() {
  const { lists, tags } = useSession();
  const { data, error } = useApi<LinksResponse>("/insights/links");
  const [params, setParams] = useSearchParams();
  const [off, setOff] = useState<Set<LinkKind>>(new Set());
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [jumpTo, setJumpTo] = useState<string | null>(null);

  const wide = useWide();
  const view: View = !wide || params.get("weergave") === "lijst" ? "lijst" : "kaart";
  const set = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: !push });
  };
  const groupBy: LinkGroupBy = Object.hasOwn(LINK_GROUPS, params.get("groep") ?? "") ? (params.get("groep") as LinkGroupBy) : "tag";
  const sort: LinkSort = Object.hasOwn(LINK_SORTS, params.get("sort") ?? "") ? (params.get("sort") as LinkSort) : "eigen";

  const byId = new Map(lists.map((l) => [l.id, l]));
  const chosen = (params.get("keuze") ?? "").split(",").filter((id) => byId.has(id));
  const only = params.get("enkel") === "1" && chosen.length > 0;
  const scope = only ? new Set(chosen) : null;

  // Elke lijst één keer: in de kolom van haar eerste tag (met "Enkel deze tonen" enkel je selectie).
  const placed = new Set<string>();
  const columns: MapColumn[] = groupByTag(lists, tags)
    .map((g) => ({
      key: g.tag?.id ?? "zonder",
      name: g.tag?.name ?? "Zonder tag",
      tone: g.tag ? (g.tag.color ?? "sky") : null,
      lists: g.lists.filter((l) => !placed.has(l.id) && (!scope || scope.has(l.id)) && (placed.add(l.id), true)),
    }))
    .filter((c) => c.lists.length);
  const shownLists = columns.flatMap((c) => c.lists);
  const columnOf = new Map(columns.flatMap((c) => c.lists.map((l) => [l.id, c.name])));

  const all = data?.links ?? [];
  const inScope = (id: string) => !scope || scope.has(id) || viewOf(id) !== null;
  const links = all.filter((l) => !off.has(l.kind) && inScope(l.from) && inScope(l.to));
  const kinds = LINK_ORDER.filter((k) => all.some((l) => l.kind === k));
  const hits = data && query.trim() ? searchLinks(query, { lists: shownLists, kinds: data.kinds, links }) : [];
  const lit = query.trim() ? litBy(hits) : chosen.length ? selectionLit(links, chosen) : null;
  const asked = params.get("lijst");
  const selected = asked && (byId.has(asked) || (viewOf(asked) && links.some((l) => l.from === asked || l.to === asked))) ? asked : null;
  // Op gsm is een gekozen lijst een eigen scherm: terug is dan echt terug.
  const select = (id: string | null) => set({ lijst: id }, !wide && id !== null);

  const last = (id: string) => data?.counts[id]?.last ?? null;
  const metaOf = (id: string) => {
    const v = viewOf(id);
    if (v) return plural(new Set(links.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : []))).size, "lijst", "lijsten");
    const list = byId.get(id);
    return list && data ? [columnOf.get(id), listMeta(list, data.counts), lastText(last(id))].filter(Boolean).join(" · ") : "";
  };

  // De groepen van de lijst.
  const sorted = sortLinkLists(shownLists, sort, links, last);
  const order = new Map(sorted.map((l, i) => [l.id, i]));
  const bySort = (ids: string[]) => [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const shown = query.trim() ? litBy(hits).nodes : null;
  const viewIds = VIEW_ORDER.map(viewNode).filter((n) => links.some((l) => l.from === n || l.to === n));
  const groups: ListGroup[] = (
    groupBy === "tag"
      ? [
          ...columns.map((c) => ({
            key: c.key,
            name: c.name,
            tone: c.tone,
            ids: bySort(c.lists.map((l) => l.id)),
          })),
          ...(viewIds.length ? [{ key: "weergaven", name: "Weergaven", ids: viewIds }] : []),
        ]
      : groupLinkLists(
          sorted.map((l) => l.id),
          links,
          groupBy,
        )
  )
    .map((g) => ({
      ...g,
      ids: shown ? g.ids.filter((id) => shown.has(id)) : g.ids,
    }))
    .filter((g) => g.ids.length);
  const hasLinks = (id: string) => links.some((l) => l.from === id || l.to === id) || (data?.own[id]?.length ?? 0) > 0;
  const expandAll = () => {
    setClosed(new Set());
    setOpen(new Set(groups.flatMap((g) => g.ids).filter(hasLinks)));
  };
  const collapseAll = () => {
    setOpen(new Set());
    setClosed(new Set(groups.map((g) => g.key)));
  };
  const choose = (ids: string[], on: boolean) => {
    const next = on ? [...new Set([...chosen, ...ids])] : chosen.filter((id) => !ids.includes(id));
    set({
      keuze: next.join(",") || null,
      enkel: next.length ? params.get("enkel") : null,
    });
  };
  // Naar een ander eind springen: zijn groep open, zijn rij open, en ernaartoe schuiven (na het tekenen).
  const jump = (id: string) => {
    const group = groups.find((g) => g.ids.includes(id));
    if (!group) {
      if (wide) set({ weergave: null, lijst: id });
      else select(id);
      return;
    }
    setClosed((s) => new Set([...s].filter((k) => k !== group.key)));
    if (hasLinks(id)) setOpen((s) => new Set([...s, id]));
    setJumpTo(id);
  };
  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`lm-row-${jumpTo}`);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({
      block: "center",
      behavior: still ? "auto" : "smooth",
    });
    el?.querySelector<HTMLElement>(".lm-row-main")?.focus({
      preventScroll: true,
    });
    setJumpTo(null);
  }, [jumpTo]);

  // Op gsm: één gekozen lijst als eigen scherm.
  if (!wide && selected && data) {
    const back = new URLSearchParams(params);
    back.delete("lijst");
    const v = viewOf(selected);
    const name = v ? VIEWS[v].label : (byId.get(selected)?.name ?? "");
    return (
      <div className="page">
        <PageHead
          title={name}
          back={{
            to: `/verbanden${back.size ? `?${back}` : ""}`,
            label: "Verbanden",
          }}
          description={metaOf(selected)}
        />
        <LinkDetail id={selected} data={data} links={links} byId={byId} onSelect={select} meta="" phone />
      </div>
    );
  }

  const between = betweenLists(all);
  const broken = new Set(data?.problems.map((p) => `${p.list}|${p.to}`));
  const summary = data
    ? [
        plural(lists.length, "lijst", "lijsten"),
        `${plural(between.length, "verband", "verbanden")} tussen lijsten`,
        broken.size ? `${broken.size} werkt niet voor iedereen` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const selection = data && chosen.length > 0 && (
    <SelectionCard ids={chosen} data={data} links={links} byId={byId} onRemove={(id) => choose([id], false)} onSelect={select} />
  );

  return (
    <div className="page">
      <PageHead title="Verbanden" description={summary} />
      {error && <p className="error">{error}</p>}
      {!data && !error && <SkeletonRows rows={4} />}
      {data && !lists.length && <EmptyState icon="links" title="Nog geen lijsten" />}
      {data && lists.length > 0 && (
        <>
          <div className="lm-toolbar">
            {wide && (
              <Tabs<View>
                label="Weergave"
                value={view}
                onChange={(v) => set({ weergave: v === "lijst" ? "lijst" : null })}
                tabs={[
                  { value: "kaart", label: "Kaart" },
                  { value: "lijst", label: "Lijst" },
                ]}
              />
            )}
            <LinkSearch query={query} onQuery={setQuery} hits={hits} popover={view === "kaart"} onPick={(h) => select(h.select)} />
          </div>
          {kinds.length > 1 && (
            <div className="filters lm-filters" role="group" aria-label="Soorten verbanden">
              {kinds.map((k) => (
                <FilterToggle key={k} on={!off.has(k)} onChange={(on) => setOff((cur) => new Set(on ? [...cur].filter((x) => x !== k) : [...cur, k]))}>
                  <LinkSwatch kind={k} /> {LINK_KINDS[k].label}
                </FilterToggle>
              ))}
            </div>
          )}

          {!selected && !chosen.length && <LinkProblems problems={data.problems} byId={byId} />}

          {view === "kaart" && (
            <>
              <LinkMapView
                columns={columns}
                links={links}
                views={!off.has("view")}
                counts={data.counts}
                problems={data.problems}
                selected={selected}
                lit={lit}
                onSelect={select}
              />
              {selected ? (
                <LinkDetail id={selected} data={data} links={links} byId={byId} onSelect={select} onClose={() => select(null)} meta={metaOf(selected)} />
              ) : (
                selection
              )}
            </>
          )}

          {view === "lijst" && (
            <>
              <div className="lm-tools">
                <FilterSelect
                  label="Groeperen"
                  value={groupBy === "tag" ? null : groupBy}
                  all={LINK_GROUPS.tag}
                  options={(["soort", "weergave"] as const).map((g) => ({
                    value: g,
                    label: LINK_GROUPS[g],
                  }))}
                  onChange={(v) => set({ groep: v })}
                />
                <FilterSelect
                  label="Sorteren"
                  value={sort === "eigen" ? null : sort}
                  all={LINK_SORTS.eigen}
                  options={(["naam", "verbanden", "laatst"] as const).map((s) => ({ value: s, label: LINK_SORTS[s] }))}
                  onChange={(v) => set({ sort: v })}
                />
                <span className="lm-tools-gap" />
                {wide ? (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={expandAll}>
                      <Icon name="chevrons" size={15} /> Alles uitklappen
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={collapseAll}>
                      <Icon name="collapse" size={15} /> Alles inklappen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={open.size ? "Alles inklappen" : "Alles uitklappen"}
                    onClick={open.size ? collapseAll : expandAll}
                  >
                    <Icon name={open.size ? "collapse" : "chevrons"} />
                  </button>
                )}
                <button
                  type="button"
                  className={`btn ${selecting ? "btn-primary" : "btn-outline"} ${wide ? "btn-sm" : "btn-icon"}`}
                  aria-pressed={selecting}
                  aria-label={wide ? undefined : "Selecteren"}
                  onClick={() => setSelecting((s) => !s)}
                >
                  <Icon name={selecting ? "check" : "checkbox"} size={wide ? 15 : 18} />
                  {wide && (selecting ? " Klaar" : " Selecteren")}
                </button>
              </div>
              <div className={wide && selection ? "lm-split" : undefined}>
                {!wide && selection}
                {groups.length ? (
                  <LinkList
                    groups={groups}
                    data={data}
                    links={links}
                    byId={byId}
                    open={open}
                    closed={closed}
                    onToggle={(id) => setOpen((s) => toggled(s, id))}
                    onToggleGroup={(key) => setClosed((s) => toggled(s, key))}
                    selecting={selecting}
                    chosen={chosen}
                    onChoose={choose}
                    wide={wide}
                    onMap={(id) => set({ weergave: null, lijst: id })}
                    onDetail={select}
                    onJump={jump}
                    hits={hits}
                    query={query.trim()}
                  />
                ) : (
                  <EmptyState
                    icon="search"
                    title="Niets gevonden"
                    action={
                      <button type="button" className="btn btn-outline" onClick={() => setQuery("")}>
                        Wissen
                      </button>
                    }
                  />
                )}
                {wide && selection && <div className="lm-split-side">{selection}</div>}
              </div>
            </>
          )}

          {chosen.length > 0 && (
            <div className="lm-selbar" role="toolbar" aria-label="Je selectie">
              <span className="lm-selbar-count">{chosen.length} geselecteerd</span>
              {wide && view === "lijst" && (
                <button type="button" className="btn btn-sm lm-selbar-button" onClick={() => set({ weergave: null, lijst: null })}>
                  <Icon name="links" size={15} /> Samen op de kaart
                </button>
              )}
              <button type="button" className="btn btn-sm lm-selbar-button" aria-pressed={only} onClick={() => set({ enkel: only ? null : "1" })}>
                <Icon name="sliders" size={15} /> {only ? "Alles tonen" : "Enkel deze tonen"}
              </button>
              <button type="button" className="btn btn-sm lm-selbar-ghost" onClick={() => set({ keuze: null, enkel: null })}>
                Wissen
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
