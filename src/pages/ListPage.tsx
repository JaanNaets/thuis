import { useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "react-router";
import { appPath, sameDestination, type AppSettings, type Destination } from "../../shared/apps";
import { canEdit, canManage, ROLES, type EventView, type ListDetail } from "../../shared/model";
import { api, useApi } from "../api";
import { Avatar, CardHead, Tabs } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { LogList, type EventPage } from "../components/Log";
import { SkeletonRows } from "../components/Motion";
import { EmptyState, PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { ThingsView } from "../components/ThingsView";
import { useToast } from "../components/Toast";
import { listIcon } from "../lists";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { PhoneAdd } from "../shell";

type Tab = "dingen" | "logboek" | "gepland";

/**
 * Een lijst: haar dingen, haar logboek (wat er gebeurde, ook elders met haar dingen) en wat gepland staat. Opzij wie
 * erbij kan (rechtstreeks of via een tag) en haar tags. Zie STIJLBOEK.md → Patronen per scherm.
 */
export function ListPage() {
  const { id } = useParams();
  const { data: detail, error, reload } = useApi<ListDetail>(`/lists/${id}`);
  const [params, setParams] = useSearchParams();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  if (error && !detail) return <p className="error page">{error}</p>;
  if (!detail) return <p className="page muted">Laden…</p>;
  const { list, role } = detail;
  const tabs: { value: Tab; label: string }[] = [
    ...(list.one ? [{ value: "dingen" as const, label: list.name }] : []),
    { value: "logboek", label: "Logboek" },
    ...(detail.counts.planned ? [{ value: "gepland" as const, label: "Gepland" }] : []),
  ];
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : tabs[0].value;
  const edit = canEdit(role) && !list.archived;
  const primary =
    edit &&
    (tab === "dingen" ? (
      <Link to={`/lijsten/${list.id}/nieuw`} className="btn btn-primary">
        <Icon name="plus" size={16} /> {list.one} toevoegen
      </Link>
    ) : (
      <Link to={`/lijsten/${list.id}/loggen${tab === "gepland" ? "?gepland=1" : ""}`} className="btn btn-primary">
        <Icon name="plus" size={16} /> {tab === "gepland" ? "Plannen" : "Loggen"}
      </Link>
    ));

  const menuLink = (icon: IconName, label: string, to: string) => (
    <li key={label}>
      <Link to={to} className="row" onClick={() => setMenu(false)}>
        <span className="cell-main">
          <span className="row-media">
            <Icon name={icon} size={16} />
          </span>
          <span className="row-title">{label}</span>
        </span>
      </Link>
    </li>
  );

  /** Een eigen app voor deze lijst (of de app die er al is), en dan naar haar pagina om ze op je beginscherm te zetten. */
  async function homeScreen() {
    setMenu(false);
    try {
      const to: Destination = { kind: "list", list: list.id };
      let settings = await api.get<AppSettings>("/me/app");
      let app = settings.apps.find((a) => sameDestination(a.to, to));
      if (!app) {
        settings = await api.put<AppSettings>("/me/app", { settings: { ...settings, apps: [...settings.apps, { name: list.name.slice(0, 30), to }] } });
        app = settings.apps.find((a) => sameDestination(a.to, to));
      }
      if (app) navigate(appPath(app.id));
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  return (
    <div className="page">
      <PageHead
        title={list.name}
        badge={list.archived ? <span className="badge badge-muted">Gearchiveerd</span> : undefined}
        actions={
          <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu(true)}>
            <Icon name="dots" size={16} />
          </button>
        }
        primary={primary || undefined}
      />
      {tabs.length > 1 && <Tabs label="Weergaven" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />}
      <div className="split split-main-first">
        <aside className="split-aside">
          <PeopleCard detail={detail} />
          {detail.tags.length > 0 && (
            <section className="card">
              <CardHead title="Tags" />
              <div className="card-body tag-picker">
                {detail.tags.map((t) => (
                  <Link key={t.id} to={`/tags/${t.id}`} className="tag static">
                    {t.name}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>
        <div className="split-main">
          {tab === "dingen" && <ThingsView key={list.id} list={list} role={role} onChanged={reload} />}
          {tab !== "dingen" && <ListLog key={`${list.id}-${tab}`} listId={list.id} planned={tab === "gepland"} edit={edit} onChanged={reload} empty={tab === "gepland" ? "Niets gepland" : "Nog niets gelogd"} />}
        </div>
      </div>
      <Sheet open={menu} title={list.name} onClose={() => setMenu(false)}>
        <ul className="rows sheet-menu">
          {canManage(role) && menuLink("sliders", "Instellen", `/lijsten/${list.id}/instellingen`)}
          {edit && list.one && menuLink("upload", "Importeren", `/lijsten/${list.id}/importeren`)}
          {edit && menuLink("scan", "QR-sticker", `/lijsten/${list.id}/sticker${tab === "dingen" ? "?ding=1" : ""}`)}
          {edit && (
            <li>
              <button type="button" className="row" onClick={homeScreen}>
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name="home" size={16} />
                  </span>
                  <span className="row-title">Op je beginscherm</span>
                </span>
              </button>
            </li>
          )}
        </ul>
      </Sheet>
      {edit &&
        (tab === "dingen" ? (
          <PhoneAdd label={`${list.one} toevoegen`} to={`/lijsten/${list.id}/nieuw`} />
        ) : (
          <PhoneAdd label={tab === "gepland" ? "Plannen" : "Loggen"} to={`/lijsten/${list.id}/loggen${tab === "gepland" ? "?gepland=1" : ""}`} />
        ))}
    </div>
  );
}

/** Wie bij de lijst kan: rechtstreeks met een rol, of via een tag. */
function PeopleCard({ detail }: { detail: ListDetail }) {
  const { person: me } = useSession();
  const people = detail.people.filter((p) => p.direct !== "geen");
  if (people.length <= 1 && people[0]?.person.id === me.id) return null;
  return (
    <section className="card">
      <CardHead title="Wie" />
      <ul className="rows">
        {people.map((p) => (
          <li key={p.person.id}>
            <div className="row">
              <span className="cell-main">
                <Avatar member={p.person} />
                <span className="row-main">
                  <span className="row-title">{p.person.id === me.id ? `${p.person.name} (jij)` : p.person.name}</span>
                  <span className="row-meta">
                    <span>{p.via ? `${ROLES[p.role].label} · via ${p.via.tag}` : ROLES[p.role].label}</span>
                  </span>
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Het logboek (of wat gepland staat) van een lijst, met Meer laden en afvinken. */
export function ListLog({ listId, planned, edit, onChanged, empty }: { listId: string; planned: boolean; edit: boolean; onChanged?: () => void; empty: string }) {
  const toast = useToast();
  const [before, setBefore] = useState<string | null>(null);
  const [older, setOlder] = useState<EventPage[]>([]);
  const base = `/lists/${listId}/events?status=${planned ? "gepland" : "klaar"}&limit=40`;
  const { data, error, reload } = useApi<EventPage>(base);
  const { data: next } = useApi<EventPage>(before ? `${base}&before=${encodeURIComponent(before)}` : null);
  if (next && !older.includes(next)) setOlder((o) => [...o, next]);
  const pages = data ? [data, ...older] : [];
  const page: EventPage | undefined = data && {
    events: pages.flatMap((p) => p.events),
    things: pages.flatMap((p) => p.things),
    people: pages.flatMap((p) => p.people),
    kinds: pages.flatMap((p) => p.kinds),
    lists: pages.flatMap((p) => p.lists),
    more: pages[pages.length - 1].more,
  };
  async function tick(e: EventView) {
    try {
      await api.post(`/events/${e.id}/tick`, e.status === "gepland" ? {} : { undo: true });
      setOlder([]);
      setBefore(null);
      reload();
      onChanged?.();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  if (error) return <p className="error">{error}</p>;
  if (!page) return <SkeletonRows rows={5} />;
  if (!page.events.length) return <EmptyState icon={planned ? "check" : "note"} title={empty} />;
  const last = page.events[page.events.length - 1];
  return (
    <>
      <LogList page={page} home={listId} onTick={edit ? tick : undefined} grouped={!planned} />
      {page.more && (
        <button type="button" className="btn btn-ghost" style={{ justifySelf: "center" } as CSSProperties} onClick={() => setBefore(`${last.at}|${last.id}`)}>
          Meer laden
        </button>
      )}
    </>
  );
}

export { listIcon };
