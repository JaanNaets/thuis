import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { LIST_PLACES, mutedBy, type AppSettings, type ListPlace } from "../../shared/apps";
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
  type LinkPersonView,
  type LinkSort,
  type LinksResponse,
} from "../../shared/links";
import { canManage, type ListNode, type Tag } from "../../shared/model";
import { fold } from "../../shared/targets";
import { api, useApi } from "../api";
import { Avatar, FilterSelect, FilterToggle, Segmented, Switch } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { LinkList, type ListGroup } from "../components/LinkList";
import { lastText, LinkMapView, LinkSwatch, listMeta, plural, type MapColumn } from "../components/LinkMap";
import { LinkDetail, LinkProblems, LinkSearch, SelectionCard, selectionLit } from "../components/LinkParts";
import { useListPlaces } from "../components/ListPlaces";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useSortable } from "../components/Sortable";
import { useToast } from "../components/Toast";
import { useWide } from "../device";
import { groupByTag, listIcon, listTone } from "../lists";
import { Link } from "../router";
import { useSession } from "../session";

type View = "kaart" | "lijst";

/** Zoveel mensen naast een lijst; de rest wordt "+2". */
const PEOPLE_SHOWN = 3;

const toggled = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

/** Stilzetten per lijst (of tag), meteen bewaard met PUT /me/muted. */
function useMuted() {
  const toast = useToast();
  const { data: settings, mutate } = useApi<AppSettings>("/me/app");
  async function set(id: string, muted: boolean) {
    if (!settings) return;
    try {
      const res = await api.put<{ muted: string[] }>("/me/muted", { id, muted });
      mutate({ ...settings, muted: res.muted });
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return { muted: settings?.muted ?? null, set };
}

type Places = ReturnType<typeof useListPlaces>;
type Muting = ReturnType<typeof useMuted>;

/**
 * Lijsten (`/lijsten`, zie STIJLBOEK.md → Lijsten): al je lijsten op één plek, en hoe ze samenhangen, zoals jij ze
 * ziet. Als lijst (per tag, of per soort verband of weergave): de naam opent de lijst, ▸ klapt open met wat ze
 * binnenkrijgt en doorgeeft, en rechts staat waar ze voor jou staat (menu, +, meldingen) en wie er nog bij is; op een
 * gsm zit dat in ⋯. Op tablet ook als metrokaart. Zoeken licht op de kaart op wat overeenkomt en filtert de lijst. De
 * weergave, de gekozen lijst, je selectie, groeperen en sorteren staan in het adres (`?weergave=kaart&lijst=…&keuze=`),
 * zodat terug ook echt terug is. Ook verborgen en (met Archief) gearchiveerde lijsten staan hier altijd.
 */
export function ListsPage() {
  const { lists, tags, person: me } = useSession();
  const { data, error } = useApi<LinksResponse>("/insights/links");
  const places = useListPlaces();
  const muting = useMuted();
  const [params, setParams] = useSearchParams();
  const [off, setOff] = useState<Set<LinkKind>>(new Set());
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [archive, setArchive] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [menu, setMenu] = useState<"page" | "order" | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const wide = useWide();
  const set = (patch: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: !push });
  };
  const asked = params.get("lijst");
  // Op tablet begint het als lijst; de kaart met `?weergave=kaart`, of als er een lijst gekozen is (van ⋯ → Verbanden).
  const view: View = wide && (params.get("weergave") === "kaart" || (asked !== null && params.get("weergave") !== "lijst")) ? "kaart" : "lijst";
  const groupBy: LinkGroupBy = Object.hasOwn(LINK_GROUPS, params.get("groep") ?? "") ? (params.get("groep") as LinkGroupBy) : "tag";
  const sort: LinkSort = Object.hasOwn(LINK_SORTS, params.get("sort") ?? "") ? (params.get("sort") as LinkSort) : "eigen";

  const byId = new Map(lists.map((l) => [l.id, l]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
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
  const archived = lists.filter((l) => l.archived);
  const live = lists.filter((l) => !l.archived);

  const all = data?.links ?? [];
  const inScope = (id: string) => !scope || scope.has(id) || viewOf(id) !== null;
  const links = all.filter((l) => !off.has(l.kind) && inScope(l.from) && inScope(l.to));
  const kinds = LINK_ORDER.filter((k) => all.some((l) => l.kind === k));
  const hits = data && query.trim() ? searchLinks(query, { lists: shownLists, kinds: data.kinds, links }) : [];
  const lit = query.trim() ? litBy(hits) : chosen.length ? selectionLit(links, chosen) : null;
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
  const q = fold(query.trim());
  const groups: ListGroup[] = [
    ...(groupBy === "tag"
      ? [
          ...columns.map((c) => ({
            key: c.key,
            name: c.name,
            tone: c.tone,
            ids: bySort(c.lists.map((l) => l.id)),
            to: c.key === "zonder" ? undefined : `/tags/${c.key}`,
          })),
          ...(viewIds.length ? [{ key: "weergaven", name: "Weergaven", ids: viewIds }] : []),
        ]
      : groupLinkLists(
          sorted.map((l) => l.id),
          links,
          groupBy,
        )
    ).map((g) => ({
      ...g,
      ids: shown ? g.ids.filter((id) => shown.has(id)) : g.ids,
    })),
    ...(archive && !scope ? [{ key: "archief", name: "Gearchiveerd", tone: null, ids: archived.filter((l) => !q || fold(l.name).includes(q)).map((l) => l.id) }] : []),
  ].filter((g) => g.ids.length);
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
      if (wide) set({ weergave: "kaart", lijst: id });
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

  // Waar een lijst voor jou niet staat (in de grijze regel; op een brede tablet tonen de pillen het).
  const states = (id: string) => {
    const l = byId.get(id);
    if (!l) return [];
    const menuOn = places.shown(id, "menu");
    const addOn = places.shown(id, "add");
    return [
      l.archived ? "" : !menuOn && !addOn ? "verborgen" : !menuOn ? "niet in het menu" : !addOn ? "niet bij de +" : "",
      data?.alerts.includes(id) && muting.muted && mutedBy(muting.muted, l) ? "stil" : "",
      l.role === "gast" ? "enkel kijken" : "",
    ].filter(Boolean);
  };
  const end = (id: string, group: ListGroup) => {
    const l = byId.get(id);
    if (!l || !data) return null;
    const others = l.tags.filter((t) => t !== group.key).flatMap((t) => tagById.get(t) ?? []);
    return <RowEnd list={l} others={others} data={data} me={me.id} muting={muting} places={places} onMore={() => setOpened(id)} />;
  };
  const current = opened ? byId.get(opened) : undefined;

  const newList = (
    <Link to="/lijsten/nieuw" className="btn btn-primary">
      <Icon name="plus" size={16} /> Nieuwe lijst
    </Link>
  );
  const sheets = (
    <>
      <Sheet open={menu !== null} title={menu === "order" ? "Volgorde" : "Lijsten"} onClose={() => setMenu(null)}>
        {menu === "order" ? (
          <ListOrder lists={live} onDone={() => setMenu(null)} />
        ) : (
          <ul className="rows sheet-menu">
            <MenuRow icon="plus" label="Nieuwe lijst" action="/lijsten/nieuw" onDone={() => setMenu(null)} />
            {live.length > 1 && <MenuRow icon="grip" label="Volgorde" action={() => setMenu("order")} />}
            {view === "lijst" && data && live.length > 1 && (
              <MenuRow
                icon="checkbox"
                label="Selecteren"
                action={() => {
                  setSelecting(true);
                  setMenu(null);
                }}
              />
            )}
          </ul>
        )}
      </Sheet>
      <Sheet open={current !== undefined} title={current?.name ?? "Lijst"} onClose={() => setOpened(null)}>
        {current && (
          <ListSheet
            list={current}
            data={data}
            muting={muting}
            places={places}
            links={
              wide
                ? { label: "Op de kaart", go: () => set({ weergave: "kaart", lijst: current.id }, true) }
                : { label: "Verbanden", go: () => select(current.id) }
            }
            onClose={() => setOpened(null)}
          />
        )}
      </Sheet>
    </>
  );

  // Op gsm: één gekozen lijst als eigen scherm.
  if (!wide && selected && data) {
    const back = new URLSearchParams(params);
    back.delete("lijst");
    const v = viewOf(selected);
    const name = v ? VIEWS[v].label : (byId.get(selected)?.name ?? "");
    return (
      <div className="page">
        <PageHead title={name} back={{ to: `/lijsten${back.size ? `?${back}` : ""}`, label: "Lijsten" }} description={metaOf(selected)} />
        <LinkDetail id={selected} data={data} links={links} byId={byId} onSelect={select} meta="" phone />
      </div>
    );
  }

  const between = betweenLists(all);
  const broken = new Set(data?.problems.map((p) => `${p.list}|${p.to}`));
  const summary = data
    ? [
        plural(live.length, "lijst", "lijsten"),
        between.length ? `${plural(between.length, "verband", "verbanden")} tussen lijsten` : "",
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
      <PageHead
        top
        title="Lijsten"
        description={summary}
        primary={newList}
        actions={
          <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu("page")}>
            <Icon name="dots" size={16} />
          </button>
        }
      />
      {error && <p className="error">{error}</p>}
      {!lists.length && <EmptyState icon="listLines" title="Nog geen lijsten" action={newList} />}
      {lists.length > 0 && !data && !error && <SkeletonRows rows={6} />}
      {data && lists.length > 0 && (
        <>
          <div className="lm-toolbar">
            {wide && (
              <Segmented<View>
                label="Weergave"
                value={view}
                onChange={(v) => set(v === "kaart" ? { weergave: "kaart" } : { weergave: null, lijst: null })}
                options={[
                  { value: "lijst", label: "Lijst" },
                  { value: "kaart", label: "Kaart" },
                ]}
              />
            )}
            <LinkSearch query={query} onQuery={setQuery} hits={hits} popover={view === "kaart"} onPick={(h) => select(h.select)} />
          </div>
          {view === "kaart" && kinds.length > 1 && (
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
                  options={(["soort", "weergave"] as const).map((g) => ({ value: g, label: LINK_GROUPS[g] }))}
                  onChange={(v) => set({ groep: v })}
                />
                <FilterSelect
                  label="Sorteren"
                  value={sort === "eigen" ? null : sort}
                  all={LINK_SORTS.eigen}
                  options={(["naam", "verbanden", "laatst"] as const).map((s) => ({ value: s, label: LINK_SORTS[s] }))}
                  onChange={(v) => set({ sort: v })}
                />
                {archived.length > 0 && (
                  <FilterToggle on={archive} onChange={setArchive}>
                    <Icon name="archive" size={14} /> Archief
                  </FilterToggle>
                )}
                <span className="lm-tools-gap" />
                {selecting ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setSelecting(false)}>
                    <Icon name="check" size={15} /> Klaar
                  </button>
                ) : wide ? (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={expandAll}>
                      <Icon name="chevrons" size={15} /> Alles uitklappen
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={collapseAll}>
                      <Icon name="collapse" size={15} /> Alles inklappen
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={open.size ? "Alles inklappen" : "Alles uitklappen"} onClick={open.size ? collapseAll : expandAll}>
                    <Icon name={open.size ? "collapse" : "chevrons"} />
                  </button>
                )}
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
                    onJump={jump}
                    hits={hits}
                    query={query.trim()}
                    end={end}
                    states={states}
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
                <button type="button" className="btn btn-sm lm-selbar-button" onClick={() => set({ weergave: "kaart", lijst: null })}>
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
      {sheets}
    </div>
  );
}

/** Een rij in een blad: naar een plek, of iets doen. */
function MenuRow({ icon, label, action, onDone }: { icon: IconName; label: string; action: string | (() => void); onDone?: () => void }) {
  const inner = (
    <span className="cell-main">
      <span className="row-media">
        <Icon name={icon} size={16} />
      </span>
      <span className="row-title">{label}</span>
    </span>
  );
  return (
    <li>
      {typeof action === "string" ? (
        <Link to={action} className="row" onClick={onDone}>
          {inner}
        </Link>
      ) : (
        <button type="button" className="row" onClick={action}>
          {inner}
        </button>
      )}
    </li>
  );
}

/** Rechts in de rij van een lijst: op een brede tablet haar andere tags, de mensen en de pillen; altijd ⋯. */
function RowEnd({
  list,
  others,
  data,
  me,
  muting,
  places,
  onMore,
}: {
  list: ListNode;
  others: Tag[];
  data: LinksResponse;
  me: string;
  muting: Muting;
  places: Places;
  onMore: () => void;
}) {
  const { tags } = useSession();
  const people = (data.people[list.id] ?? []).filter((p) => p.id !== me);
  const alerts = data.alerts.includes(list.id);
  const quiet = muting.muted ? mutedBy(muting.muted, list) : null;
  return (
    <>
      {others.length > 0 && (
        <span className="lo-tags lo-wide">
          {others.map((t) => (
            <Link key={t.id} to={`/tags/${t.id}`} className="tag static">
              {t.name}
            </Link>
          ))}
        </span>
      )}
      <People people={people} />
      {!list.archived && (
        <span className="place-pills lo-wide">
          {(Object.keys(LIST_PLACES) as ListPlace[]).map((p) => (
            <FilterToggle key={p} on={places.shown(list.id, p)} onChange={(on) => places.set(list.id, p, on)}>
              {p === "menu" ? "Menu" : "Toevoegen"}
            </FilterToggle>
          ))}
          {alerts &&
            muting.muted &&
            (quiet && quiet !== "list" ? (
              <button type="button" className="filter" aria-pressed="false" disabled title={`Stil via ${tags.find((t) => t.id === quiet)?.name ?? "een tag"}`}>
                Meldingen
              </button>
            ) : (
              <FilterToggle on={!quiet} onChange={(on) => muting.set(list.id, !on)}>
                Meldingen
              </FilterToggle>
            ))}
        </span>
      )}
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${list.name}: meer`} aria-haspopup="dialog" onClick={onMore}>
        <Icon name="dots" size={16} />
      </button>
    </>
  );
}

/** Wie er nog bij een lijst is (zonder jou), als letters naast elkaar. */
function People({ people }: { people: LinkPersonView[] }) {
  if (!people.length) return null;
  const rest = people.length - PEOPLE_SHOWN;
  return (
    <span className="lo-people lo-wide" title={people.map((p) => p.name).join(", ")}>
      {people.slice(0, PEOPLE_SHOWN).map((p) => (
        <Avatar key={p.id} member={{ name: p.name, color: p.color }} size="sm" />
      ))}
      {rest > 0 && <span className="lo-people-more">+{rest}</span>}
    </span>
  );
}

/** ⋯ van een lijst: openen, instellen, haar verbanden, en waar ze voor jou staat. */
function ListSheet({
  list,
  data,
  muting,
  places,
  links,
  onClose,
}: {
  list: ListNode;
  data: LinksResponse | undefined;
  muting: Muting;
  places: Places;
  /** Haar verbanden: op tablet op de kaart, op gsm een eigen scherm. */
  links: { label: string; go: () => void };
  onClose: () => void;
}) {
  const { tags } = useSession();
  const alerts = data?.alerts.includes(list.id) ?? false;
  const quiet = muting.muted ? mutedBy(muting.muted, list) : null;
  const viaTag = quiet && quiet !== "list" ? tags.find((t) => t.id === quiet) : undefined;
  return (
    <>
      <ul className="rows sheet-menu">
        <MenuRow icon="external" label="Openen" action={`/lijsten/${list.id}`} onDone={onClose} />
        {canManage(list.role) && <MenuRow icon="sliders" label="Instellen" action={`/lijsten/${list.id}/instellingen`} onDone={onClose} />}
        <MenuRow
          icon="links"
          label={links.label}
          action={() => {
            onClose();
            links.go();
          }}
        />
      </ul>
      {!list.archived && (
        <div className="sheet-switches">
          {(Object.keys(LIST_PLACES) as ListPlace[]).map((p) => (
            <Switch key={p} label={LIST_PLACES[p]} checked={places.shown(list.id, p)} onChange={(on) => places.set(list.id, p, on)} />
          ))}
          {alerts && muting.muted && !viaTag && <Switch label="Meldingen" checked={!quiet} onChange={(on) => muting.set(list.id, !on)} />}
          {alerts && viaTag && (
            <button type="button" className="btn btn-outline" onClick={() => muting.set(viaTag.id, false)}>
              {viaTag.name} weer laten melden
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Je volgorde van de lijsten (in het menu en in de keuzelijsten), bewaard met PUT /me/order. */
function ListOrder({ lists, onDone }: { lists: ListNode[]; onDone: () => void }) {
  const { reloadMe } = useSession();
  const toast = useToast();
  const [order, setOrder] = useState(() => lists.map((l) => l.id));
  const [busy, setBusy] = useState(false);
  const byId = new Map(lists.map((l) => [l.id, l]));
  const sortable = useSortable(order, setOrder, (id) => byId.get(id)?.name ?? "Lijst");
  const changed = order.some((id, i) => lists[i]?.id !== id);
  async function save() {
    setBusy(true);
    try {
      await api.put("/me/order", { ids: order });
      reloadMe();
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <ul className="rows sort-list">
        {order.map((id) => {
          const l = byId.get(id);
          if (!l) return null;
          return (
            <li key={id} {...sortable.itemProps(id)}>
              <div className="row">
                <button {...sortable.handleProps(id)}>
                  <Icon name="grip" size={16} />
                </button>
                <span className="cell-main">
                  <span className={`row-media tone-${listTone(l)}`}>
                    <Icon name={listIcon(l)} size={16} />
                  </span>
                  <span className="row-title">{l.name}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {sortable.status}
      <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={save}>
        Bewaren
      </button>
    </div>
  );
}
