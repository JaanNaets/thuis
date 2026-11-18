import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { appPath, sameDestination, type AppSettings, type Destination } from "../../shared/apps";
import { canEdit, canManage, fillsLists, type ListDetail } from "../../shared/model";
import { api, useApi } from "../api";
import { CardHead, Tabs } from "../components/Controls";
import { PeopleCard } from "../components/People";
import { usePalette } from "../components/CommandPalette";
import { ListPlaceSwitches } from "../components/ListPlaces";
import { Icon, type IconName } from "../components/Icon";
import { EventLog } from "../components/Log";
import { LogButtons } from "../components/LogButtons";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { ItemsView } from "../components/ItemsView";
import { useToast } from "../components/Toast";
import { listIcon } from "../lists";
import { Link, useNavigate } from "../router";
import { PhoneAdd } from "../shell";

type Tab = "items" | "logboek" | "gepland";

/**
 * Een lijst: haar items, haar logboek (wat er gebeurde, ook elders met haar items) en wat gepland staat. Opzij wie
 * erbij kan (rechtstreeks of via een tag) en haar tags. Zie STIJLBOEK.md → Patronen per scherm.
 */
export function ListPage() {
  const { id } = useParams();
  const { data: detail, error, reload } = useApi<ListDetail>(`/lists/${id}`);
  const [params, setParams] = useSearchParams();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const palette = usePalette();
  if (error && !detail) return <p className="error page">{error}</p>;
  if (!detail) return <p className="page muted">Laden…</p>;
  const { list, role } = detail;
  // Gepland als er iets gepland staat of een formulier dat deze lijst invult gepland begint; dan ook vóór het logboek.
  const plans = detail.kinds.some((k) => k.planned && fillsLists(k).includes(list.id));
  const planTab = detail.counts.planned || plans ? [{ value: "gepland" as const, label: "Gepland" }] : [];
  const logTab = [{ value: "logboek" as const, label: "Logboek" }];
  const tabs: { value: Tab; label: string }[] = [
    ...(list.one ? [{ value: "items" as const, label: list.name }] : []),
    ...(plans ? [...planTab, ...logTab] : [...logTab, ...planTab]),
  ];
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : tabs[0].value;
  const edit = canEdit(role) && !list.archived;
  // Toevoegen: hetzelfde palet als de + overal, maar enkel met wat in deze lijst kan (op Items eerst een item).
  const addHere = () => palette("add", "", { list: list.id, item: tab === "items", planned: tab === "gepland" });
  const addLabel = tab === "gepland" ? "Plannen" : "Toevoegen";
  const primary = edit && (
    <button type="button" className="btn btn-primary" onClick={addHere}>
      <Icon name="plus" size={16} /> {addLabel}
    </button>
  );

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
          <PeopleCard people={detail.people} />
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
          {tab === "items" && <ItemsView key={list.id} list={list} role={role} onChanged={reload} />}
          {tab !== "items" && edit && <LogButtons listId={list.id} planned={tab === "gepland"} row />}
          {tab !== "items" && (
            <EventLog key={`${list.id}-${tab}`} path={`/lists/${list.id}/events`} home={list.id} planned={tab === "gepland"} edit={edit} onChanged={reload} empty={tab === "gepland" ? "Niets gepland" : "Nog niets gelogd"} />
          )}
        </div>
      </div>
      <Sheet open={menu} title={list.name} onClose={() => setMenu(false)}>
        <ul className="rows sheet-menu">
          {canManage(role) && menuLink("sliders", "Instellen", `/lijsten/${list.id}/instellingen`)}
          {edit && menuLink("note", "Nieuw formulier", `/formulieren/nieuw?lijst=${list.id}`)}
          {edit && list.one && menuLink("upload", "Importeren", `/lijsten/${list.id}/importeren`)}
          {edit && menuLink("scan", "QR-sticker", `/lijsten/${list.id}/sticker${tab === "items" ? "?item=1" : ""}`)}
          {menuLink("links", "Verbanden", `/lijsten?lijst=${list.id}`)}
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
        <ListPlaceSwitches list={list.id} />
      </Sheet>
      {edit && <PhoneAdd label={addLabel} onClick={addHere} />}
    </div>
  );
}

export { listIcon };
