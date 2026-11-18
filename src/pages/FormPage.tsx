// Een formulier: zijn logboek (alles wat ermee gelogd werd) en wat gepland staat, met Loggen bovenaan. Opzij wie erbij
// is en zijn tags, zoals bij een lijst. Zie STIJLBOEK.md → Patronen per scherm.

import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { mutedBy, type AppSettings } from "../../shared/apps";
import { canEdit, canManage, fillsLists, type FormDetail } from "../../shared/model";
import { logPath } from "../../shared/targets";
import { api, useApi } from "../api";
import { CardHead, Switch, Tabs } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { EventLog } from "../components/Log";
import { PageHead } from "../components/Page";
import { PeopleCard } from "../components/People";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { PhoneAdd } from "../shell";

type Tab = "logboek" | "gepland";

export function FormPage() {
  const { id } = useParams();
  const { data: detail, error, reload } = useApi<FormDetail>(`/forms/${id}`);
  const [params, setParams] = useSearchParams();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const { lists } = useSession();
  if (error && !detail) return <p className="error page">{error}</p>;
  if (!detail) return <p className="page muted">Laden…</p>;
  const { form, role } = detail;
  // Gepland eerst als het formulier gepland begint (Boodschap), anders enkel als er iets gepland staat.
  const planTab = detail.counts.planned || form.planned ? [{ value: "gepland" as const, label: "Gepland" }] : [];
  const logTab = [{ value: "logboek" as const, label: "Logboek" }];
  const tabs: { value: Tab; label: string }[] = form.planned ? [...planTab, ...logTab] : [...logTab, ...planTab];
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && tabs.some((t) => t.value === asked) ? asked : tabs[0].value;
  const edit = canEdit(role) && !detail.archived;
  const log = () => navigate(`${logPath(form)}${tab === "gepland" ? "&gepland=1" : ""}`);
  const addLabel = tab === "gepland" ? "Plannen" : "Loggen";
  const filled = fillsLists(form).flatMap((l) => lists.filter((x) => x.id === l));
  return (
    <div className="page">
      <PageHead
        title={form.name}
        badge={detail.archived ? <span className="badge badge-muted">Gearchiveerd</span> : undefined}
        actions={
          (canManage(role) || detail.notify) && (
            <button type="button" className="btn btn-outline btn-icon" aria-label="Meer opties" aria-haspopup="dialog" onClick={() => setMenu(true)}>
              <Icon name="dots" size={16} />
            </button>
          )
        }
        primary={
          edit ? (
            <button type="button" className="btn btn-primary" onClick={log}>
              <Icon name="plus" size={16} /> {addLabel}
            </button>
          ) : undefined
        }
      />
      {tabs.length > 1 && <Tabs label="Weergaven" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />}
      <div className="split split-main-first">
        <aside className="split-aside">
          <PeopleCard people={detail.people} />
          {filled.length > 0 && (
            <section className="card">
              <CardHead title="Lijsten" />
              <div className="card-body tag-picker">
                {filled.map((l) => (
                  <Link key={l.id} to={`/lijsten/${l.id}`} className="tag static">
                    {l.name}
                  </Link>
                ))}
              </div>
            </section>
          )}
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
          <EventLog key={`${form.id}-${tab}`} path={`/forms/${form.id}/events`} planned={tab === "gepland"} edit={edit} onChanged={reload} empty={tab === "gepland" ? "Niets gepland" : "Nog niets gelogd"} />
        </div>
      </div>
      <Sheet open={menu} title={form.name} onClose={() => setMenu(false)}>
        {canManage(role) && (
          <ul className="rows sheet-menu">
            <li>
              <Link to={`/formulieren/${form.id}/instellingen`} className="row" onClick={() => setMenu(false)}>
                <span className="cell-main">
                  <span className="row-media">
                    <Icon name={"sliders" as IconName} size={16} />
                  </span>
                  <span className="row-title">Instellen</span>
                </span>
              </Link>
            </li>
          </ul>
        )}
        {detail.notify && <Alerts form={form.id} tags={detail.tags} />}
      </Sheet>
      {edit && <PhoneAdd label={addLabel} onClick={log} />}
    </div>
  );
}

/**
 * Meldingen van dit formulier voor jou: aan of stil (PUT /me/muted). Staat het stil via een tag, dan laat enkel die tag
 * het weer melden.
 */
function Alerts({ form, tags }: { form: string; tags: FormDetail["tags"] }) {
  const toast = useToast();
  const { data: settings, mutate } = useApi<AppSettings>("/me/app");
  if (!settings) return null;
  const quiet = mutedBy(settings.muted, { id: form, tags: tags.map((t) => t.id) });
  const viaTag = quiet && quiet !== "self" ? tags.find((t) => t.id === quiet) : undefined;
  async function set(id: string, muted: boolean) {
    try {
      const res = await api.put<{ muted: string[] }>("/me/muted", { id, muted });
      mutate({ ...settings!, muted: res.muted });
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="sheet-switches">
      {viaTag ? (
        <button type="button" className="btn btn-outline" onClick={() => set(viaTag.id, false)}>
          {viaTag.name} weer laten melden
        </button>
      ) : (
        <Switch label="Meldingen" checked={!quiet} onChange={(on) => set(form, !on)} />
      )}
    </div>
  );
}
