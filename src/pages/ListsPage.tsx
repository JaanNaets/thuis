import { useState, type ReactNode } from "react";
import { LIST_PLACES, mutedBy, type AppSettings, type ListPlace } from "../../shared/apps";
import type { LinksResponse, LinkPersonView } from "../../shared/links";
import { canManage, type ListNode, type Tag } from "../../shared/model";
import { fold } from "../../shared/targets";
import { api, useApi } from "../api";
import { Avatar, FilterToggle, Switch, Tabs } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { lastText, listMeta } from "../components/LinkMap";
import { useListPlaces } from "../components/ListPlaces";
import { EmptyState, PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useSortable } from "../components/Sortable";
import { useToast } from "../components/Toast";
import { groupByTag, listIcon, listTone } from "../lists";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";

export type ListsTab = "overzicht" | "verbanden";

/** Zoveel mensen naast een lijst; de rest wordt "+2". */
const PEOPLE_SHOWN = 3;

/**
 * De kop van Lijsten: de titel, Nieuwe lijst en de tabs Overzicht en Verbanden (`/lijsten`, `/lijsten/verbanden`).
 * Verbanden gebruikt dezelfde kop, zodat het één plek is.
 */
export function ListsHead({ tab, description, actions }: { tab: ListsTab; description?: ReactNode; actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <>
      <PageHead
        top
        title="Lijsten"
        description={description}
        actions={actions}
        primary={
          <Link to="/lijsten/nieuw" className="btn btn-primary">
            <Icon name="plus" size={16} /> Nieuwe lijst
          </Link>
        }
      />
      <Tabs<ListsTab>
        label="Lijsten"
        value={tab}
        onChange={(t) => navigate(t === "verbanden" ? "/lijsten/verbanden" : "/lijsten", { replace: true })}
        tabs={[
          { value: "overzicht", label: "Overzicht" },
          { value: "verbanden", label: "Verbanden" },
        ]}
      />
    </>
  );
}

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

/**
 * Lijsten (`/lijsten`, zie STIJLBOEK.md → Lijsten): al je lijsten op één plek, per tag (elke lijst één keer, bij haar
 * eerste tag). Per lijst wat erin zit, wanneer er laatst iets gebeurde en wie er nog bij is, en waar ze voor jou staat:
 * in het menu, bij de +, en of ze je een melding stuurt. Op een gsm (en een smalle tablet) staat dat in ⋯ van de lijst.
 * Ook verborgen en gearchiveerde lijsten staan hier altijd.
 */
export function ListsPage() {
  const { lists, tags, person: me } = useSession();
  const { data } = useApi<LinksResponse>("/insights/links");
  const places = useListPlaces();
  const muting = useMuted();
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState(false);
  const [menu, setMenu] = useState<"page" | "order" | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const tagById = new Map(tags.map((t) => [t.id, t]));
  const q = fold(query.trim());
  const matches = (l: ListNode) => !q || fold(l.name).includes(q) || l.tags.some((t) => fold(tagById.get(t)?.name ?? "").includes(q));

  const placed = new Set<string>();
  const groups = groupByTag(lists, tags)
    .map((g) => ({ tag: g.tag, lists: g.lists.filter((l) => matches(l) && !placed.has(l.id) && (placed.add(l.id), true)) }))
    .filter((g) => g.lists.length);
  const archived = lists.filter((l) => l.archived);
  const shownArchived = archive ? archived.filter(matches) : [];
  const live = lists.filter((l) => !l.archived);
  const current = opened ? lists.find((l) => l.id === opened) : undefined;

  const row = (l: ListNode, group: Tag | null) => (
    <ListRow
      key={l.id}
      list={l}
      others={l.tags.filter((t) => t !== group?.id).flatMap((t) => tagById.get(t) ?? [])}
      data={data}
      me={me.id}
      muted={muting.muted}
      places={places}
      onMute={muting.set}
      onMore={() => setOpened(l.id)}
    />
  );

  const menuRow = (icon: IconName, label: string, action: string | (() => void)) => (
    <li key={label}>
      {typeof action === "string" ? (
        <Link to={action} className="row" onClick={() => setMenu(null)}>
          <span className="cell-main">
            <span className="row-media">
              <Icon name={icon} size={16} />
            </span>
            <span className="row-title">{label}</span>
          </span>
        </Link>
      ) : (
        <button type="button" className="row" onClick={action}>
          <span className="cell-main">
            <span className="row-media">
              <Icon name={icon} size={16} />
            </span>
            <span className="row-title">{label}</span>
          </span>
        </button>
      )}
    </li>
  );

  return (
    <div className="page">
      <ListsHead
        tab="overzicht"
        actions={
          <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu("page")}>
            <Icon name="dots" size={16} />
          </button>
        }
      />

      {lists.length === 0 ? (
        <EmptyState
          icon="listLines"
          title="Nog geen lijsten"
          action={
            <Link to="/lijsten/nieuw" className="btn btn-primary">
              <Icon name="plus" size={16} /> Nieuwe lijst
            </Link>
          }
        />
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={16} />
              <input type="search" placeholder="Zoek een lijst of tag…" aria-label="Zoek een lijst of tag" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          {archived.length > 0 && (
            <div className="filters">
              <FilterToggle on={archive} onChange={setArchive}>
                <Icon name="archive" size={14} /> Archief
              </FilterToggle>
            </div>
          )}

          {groups.length === 0 && shownArchived.length === 0 && <EmptyState icon="search" title="Niets gevonden" />}

          <div className="lo-groups">
            {groups.map((g) => (
              <section key={g.tag?.id ?? "zonder"} className="card">
                <header className="lo-group-head">
                  {g.tag ? (
                    <Link to={`/tags/${g.tag.id}`} className="lo-group-title">
                      <span className={`dot tone-${g.tag.color ?? "sky"}`} />
                      {g.tag.name}
                      <Icon name="next" size={14} className="lo-group-chevron" />
                    </Link>
                  ) : (
                    <span className="lo-group-title">Zonder tag</span>
                  )}
                </header>
                <ul className="rows">{g.lists.map((l) => row(l, g.tag))}</ul>
              </section>
            ))}
            {shownArchived.length > 0 && (
              <section className="card">
                <header className="lo-group-head">
                  <span className="lo-group-title">Gearchiveerd</span>
                </header>
                <ul className="rows">{shownArchived.map((l) => row(l, null))}</ul>
              </section>
            )}
          </div>
        </>
      )}

      <Sheet open={menu !== null} title={menu === "order" ? "Volgorde" : "Lijsten"} onClose={() => setMenu(null)}>
        {menu === "order" ? (
          <ListOrder lists={live} onDone={() => setMenu(null)} />
        ) : (
          <ul className="rows sheet-menu">
            {menuRow("plus", "Nieuwe lijst", "/lijsten/nieuw")}
            {live.length > 1 && menuRow("grip", "Volgorde", () => setMenu("order"))}
          </ul>
        )}
      </Sheet>

      <Sheet open={current !== undefined} title={current?.name ?? "Lijst"} onClose={() => setOpened(null)}>
        {current && <ListSheet list={current} data={data} muted={muting.muted} places={places} onMute={muting.set} onClose={() => setOpened(null)} />}
      </Sheet>
    </div>
  );
}

type Places = ReturnType<typeof useListPlaces>;

/** Een lijst in het overzicht. Op een brede tablet staan haar andere tags, de mensen en de pillen in de rij. */
function ListRow({
  list,
  others,
  data,
  me,
  muted,
  places,
  onMute,
  onMore,
}: {
  list: ListNode;
  others: Tag[];
  data: LinksResponse | undefined;
  me: string;
  muted: string[] | null;
  places: Places;
  onMute: (id: string, muted: boolean) => void;
  onMore: () => void;
}) {
  const people = (data?.people[list.id] ?? []).filter((p) => p.id !== me);
  const alerts = data?.alerts.includes(list.id) ?? false;
  const quiet = muted ? mutedBy(muted, list) : null;
  const tagName = (id: string) => others.find((t) => t.id === id)?.name ?? "een tag";
  const meta = data ? [listMeta(list, data.counts), lastText(data.counts[list.id]?.last)].filter(Boolean) : [];
  // Waar ze voor jou niet staat: op een gsm in de grijze regel, op een brede tablet zie je het aan de pillen.
  const states = [
    !places.shown(list.id, "menu") && !places.shown(list.id, "add") ? "verborgen" : !places.shown(list.id, "menu") ? "niet in het menu" : !places.shown(list.id, "add") ? "niet bij de +" : "",
    alerts && quiet ? "stil" : "",
    list.role === "gast" ? "enkel kijken" : "",
  ].filter(Boolean);

  return (
    <li>
      <div className="row lo-row">
        <Link to={`/lijsten/${list.id}`} className="row-link">
          <span className={`row-media tone-${listTone(list)}`}>
            <Icon name={listIcon(list)} size={16} />
          </span>
          <span className="row-main">
            <span className="row-title">{list.name}</span>
            {(meta.length > 0 || states.length > 0) && (
              <span className="row-meta">
                {meta.map((m) => (
                  <span key={m}>{m}</span>
                ))}
                {states.map((s) => (
                  <span key={s} className="lo-state">
                    {s}
                  </span>
                ))}
              </span>
            )}
          </span>
        </Link>
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
        <span className="place-pills lo-wide">
          {(Object.keys(LIST_PLACES) as ListPlace[]).map((p) => (
            <FilterToggle key={p} on={places.shown(list.id, p)} onChange={(on) => places.set(list.id, p, on)}>
              {p === "menu" ? "Menu" : "Toevoegen"}
            </FilterToggle>
          ))}
          {alerts &&
            (quiet && quiet !== "list" ? (
              <button type="button" className="filter" aria-pressed="false" disabled title={`Stil via ${tagName(quiet)}`}>
                Meldingen
              </button>
            ) : (
              <FilterToggle on={!quiet} onChange={(on) => onMute(list.id, !on)}>
                Meldingen
              </FilterToggle>
            ))}
        </span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${list.name}: meer`} aria-haspopup="dialog" onClick={onMore}>
          <Icon name="dots" size={16} />
        </button>
      </div>
    </li>
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

/** ⋯ van een lijst: openen, instellen, verbanden, en waar ze voor jou staat. */
function ListSheet({
  list,
  data,
  muted,
  places,
  onMute,
  onClose,
}: {
  list: ListNode;
  data: LinksResponse | undefined;
  muted: string[] | null;
  places: Places;
  onMute: (id: string, muted: boolean) => void;
  onClose: () => void;
}) {
  const { tags } = useSession();
  const alerts = data?.alerts.includes(list.id) ?? false;
  const quiet = muted ? mutedBy(muted, list) : null;
  const viaTag = quiet && quiet !== "list" ? tags.find((t) => t.id === quiet) : undefined;
  const link = (icon: IconName, label: string, to: string) => (
    <li key={label}>
      <Link to={to} className="row" onClick={onClose}>
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-title">{label}</span>
        </span>
      </Link>
    </li>
  );
  return (
    <>
      <ul className="rows sheet-menu">
        {link("external", "Openen", `/lijsten/${list.id}`)}
        {canManage(list.role) && link("sliders", "Instellen", `/lijsten/${list.id}/instellingen`)}
        {link("links", "Verbanden", `/lijsten/verbanden?lijst=${list.id}`)}
      </ul>
      {!list.archived && (
        <div className="sheet-switches">
          {(Object.keys(LIST_PLACES) as ListPlace[]).map((p) => (
            <Switch key={p} label={LIST_PLACES[p]} checked={places.shown(list.id, p)} onChange={(on) => places.set(list.id, p, on)} />
          ))}
          {alerts && !viaTag && muted && <Switch label="Meldingen" checked={!quiet} onChange={(on) => onMute(list.id, !on)} />}
          {alerts && viaTag && (
            <button type="button" className="btn btn-outline" onClick={() => onMute(viaTag.id, false)}>
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
