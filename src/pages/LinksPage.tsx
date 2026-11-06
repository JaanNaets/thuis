import { useState } from "react";
import { useSearchParams } from "react-router";
import { betweenLists, LINK_KINDS, LINK_ORDER, viewOf, type LinkKind, type LinksResponse } from "../../shared/links";
import { useApi } from "../api";
import { FilterToggle, Tabs } from "../components/Controls";
import { Icon } from "../components/Icon";
import { LinkDetail, LinkList, LinkMapView, LinkProblems, LinkSwatch, type MapColumn } from "../components/LinkMap";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { groupByTag } from "../lists";
import { useSession } from "../session";

type View = "kaart" | "lijst";

/**
 * Verbanden (`/verbanden`, zie STIJLBOEK.md → Verbanden): hoe al je lijsten met elkaar en met de weergaven samenhangen,
 * zoals jij ze ziet. Als metrokaart (tablet) of als lijst (gsm); een gekozen lijst of weergave toont wat erin toekomt en
 * waar ze naartoe gaat. De weergave en de keuze staan in het adres (`?weergave=lijst&lijst=…`), zodat terug ook echt
 * terug is.
 */
export function LinksPage() {
  const { lists, tags } = useSession();
  const { data, error } = useApi<LinksResponse>("/insights/links");
  const [params, setParams] = useSearchParams();
  const [off, setOff] = useState<Set<LinkKind>>(new Set());

  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const view: View = params.get("weergave") === "lijst" || (!params.get("weergave") && !wide) ? "lijst" : "kaart";
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  // Elke lijst één keer: in de kolom van haar eerste tag.
  const placed = new Set<string>();
  const columns: MapColumn[] = groupByTag(lists, tags)
    .map((g) => ({
      key: g.tag?.id ?? "zonder",
      name: g.tag?.name ?? "Zonder tag",
      tone: g.tag ? (g.tag.color ?? "sky") : null,
      lists: g.lists.filter((l) => !placed.has(l.id) && (placed.add(l.id), true)),
    }))
    .filter((c) => c.lists.length);
  const byId = new Map(lists.map((l) => [l.id, l]));

  const all = data?.links ?? [];
  const links = all.filter((l) => !off.has(l.kind));
  const kinds = LINK_ORDER.filter((k) => all.some((l) => l.kind === k));
  const asked = params.get("lijst");
  const selected = asked && (byId.has(asked) || viewOf(asked)) && links.some((l) => l.from === asked || l.to === asked) ? asked : null;
  const select = (id: string | null) => set({ lijst: id });

  // Niet op de kaart: lijsten die enkel in weergaven voorkomen, en lijsten zonder verbanden.
  const between = betweenLists(links);
  const linked = (id: string) => links.some((l) => l.from === id || l.to === id);
  const onMap = (id: string) => between.some((l) => l.from === id || l.to === id);
  const shownLists = columns.flatMap((c) => c.lists);
  const onlyViews = shownLists.filter((l) => linked(l.id) && !onMap(l.id));
  const quiet = shownLists.filter((l) => !linked(l.id));
  const names = (ls: typeof shownLists) =>
    ls.map((l, i) => (
      <span key={l.id}>
        {i > 0 && ", "}
        <button type="button" className="link-quiet" onClick={() => select(l.id)}>
          {l.name}
        </button>
      </span>
    ));

  return (
    <div className="page">
      <PageHead title="Verbanden" />
      {error && <p className="error">{error}</p>}
      {!data && !error && <SkeletonRows rows={4} />}
      {data && !all.length && <EmptyState icon="links" title="Nog geen verbanden" />}
      {data && all.length > 0 && (
        <>
          <Tabs<View>
            label="Weergave"
            value={view}
            onChange={(v) => set({ weergave: v === "lijst" ? "lijst" : "kaart" })}
            tabs={[
              { value: "kaart", label: "Kaart" },
              { value: "lijst", label: "Lijst" },
            ]}
          />
          {kinds.length > 1 && (
            <div className="filters" role="group" aria-label="Soorten verbanden">
              {kinds.map((k) => (
                <FilterToggle key={k} on={!off.has(k)} onChange={(on) => setOff((cur) => new Set(on ? [...cur].filter((x) => x !== k) : [...cur, k]))}>
                  <LinkSwatch kind={k} /> {LINK_KINDS[k].label}
                </FilterToggle>
              ))}
            </div>
          )}

          <LinkProblems problems={data.problems} byId={byId} />

          {view === "kaart" && (
            <>
              {between.length > 0 ? (
                <LinkMapView columns={columns} links={links} views={!off.has("view")} counts={data.counts} problems={data.problems} selected={selected} onSelect={select} />
              ) : (
                <p className="lm-more">Geen verbanden tussen je lijsten.</p>
              )}
              {selected && <LinkDetail id={selected} data={data} links={links} byId={byId} onSelect={select} />}
            </>
          )}
          {view === "lijst" &&
            (selected ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm lm-back" onClick={() => select(null)}>
                  <Icon name="back" size={15} /> Alles
                </button>
                <LinkDetail id={selected} data={data} links={links} byId={byId} onSelect={select} />
              </>
            ) : (
              <LinkList columns={columns} links={links} counts={data.counts} onSelect={select} />
            ))}

          {((view === "kaart" && onlyViews.length > 0) || quiet.length > 0) && (
            <div className="lm-more">
              {view === "kaart" && onlyViews.length > 0 && <p>Enkel in de weergaven: {names(onlyViews)}</p>}
              {quiet.length > 0 && <p>Zonder verbanden: {names(quiet)}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
