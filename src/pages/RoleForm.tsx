import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { ACCESS_LEVELS, PROJECT_RIGHTS, type Access, type ProjectRight, type Rights } from "../../shared/access";
import type { ItemType, ProjectDetail, RoleInput } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { CardHead, Segmented, SubmitButton, Switch } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";

type FullType = ItemType & { project_name: string };

const LEVELS = (Object.keys(ACCESS_LEVELS) as Access[]).map((a) => ({ value: a, label: ACCESS_LEVELS[a].label }));
const WITH_DEFAULT = [{ value: "default" as const, label: "Standaard" }, ...LEVELS];

/** Een rol: wat je met het project mag, de standaard voor alles, en uitzonderingen per lijst en per veld. */
export function RoleFormPage() {
  const { id, roleId } = useParams();
  const { data: p, error } = useApi<ProjectDetail>(`/projects/${id}`);
  const { data: types, error: typesError } = useApi<FullType[]>(`/projects/${id}/all-types`);
  if (error || typesError) return <p className="error page">{error ?? typesError}</p>;
  if (!p || !types) return null;
  const existing = roleId ? p.roles.find((r) => r.id === roleId && r.project_id === p.project.id) : undefined;
  if (roleId && !existing) return <p className="error page">Die rol bestaat niet (meer), of hoort bij een project erboven.</p>;
  return <RoleForm project={p} types={types} existing={existing} />;
}

function RoleForm({ project: p, types, existing }: { project: ProjectDetail; types: FullType[]; existing?: ProjectDetail["roles"][number] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(existing?.name ?? "");
  const [rights, setRights] = useState<Rights>(existing?.rights ?? { manage: false, members: false, create: true, delete: false, items: "edit", types: {} });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const back = `/projecten/${p.project.id}/instellingen?tab=rollen`;

  const setRight = (key: ProjectRight, on: boolean) => setRights((r) => ({ ...r, [key]: on }));
  const setType = (typeId: string, access: Access | "default") =>
    setRights((r) => {
      const entry = { ...r.types[typeId] };
      if (access === "default") delete entry.access;
      else entry.access = access;
      return { ...r, types: clean({ ...r.types, [typeId]: entry }) };
    });
  const setField = (typeId: string, key: string, access: Access | "default") =>
    setRights((r) => {
      const fields = { ...r.types[typeId]?.fields };
      if (access === "default") delete fields[key];
      else fields[key] = access;
      return { ...r, types: clean({ ...r.types, [typeId]: { ...r.types[typeId], fields } }) };
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input: RoleInput = { name, rights };
    setBusy(true);
    setError(undefined);
    try {
      if (existing) await api.put(`/roles/${existing.id}`, input);
      else await api.post(`/projects/${p.project.id}/roles`, input);
      toast(existing ? "Rol bijgewerkt" : "Rol gemaakt");
      navigate(back, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || !(await confirm({ title: `Rol "${existing.name}" verwijderen?`, confirmLabel: "Verwijderen", danger: true }))) return;
    try {
      await api.delete(`/roles/${existing.id}`);
      toast("Rol verwijderd", "trash");
      navigate(back, { replace: true });
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={existing ? existing.name : "Nieuwe rol"} description={p.project.name} back={{ to: -1, label: "Rollen" }} />

      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Proever, Gast, Boekhouder" />
        </label>
        {(Object.keys(PROJECT_RIGHTS) as ProjectRight[]).map((key) => {
          const r = PROJECT_RIGHTS[key];
          return <Switch key={key} checked={rights[key]} onChange={(on) => setRight(key, on)} label={r.label} hint={"hint" in r ? r.hint : undefined} />;
        })}
      </section>

      <section className="card form-section">
        <div className="field">
          <span className="label">Items, standaard</span>
          <Segmented label="Items, standaard" value={rights.items} onChange={(items) => setRights((r) => ({ ...r, items }))} options={LEVELS} />
          <span className="hint">Geldt voor elke lijst en elk veld, behalve de uitzonderingen hieronder.</span>
        </div>
      </section>

      {types.length > 0 && (
        <section className="card">
          <CardHead icon="folder" title="Per lijst en per veld" description="Niet zien: de items van die lijst (of dat veld) blijven verborgen." />
          <ul className="rows role-types">
            {types.map((t) => {
              const entry = rights.types[t.id];
              const fieldCount = Object.keys(entry?.fields ?? {}).length;
              return (
                <li key={t.id} className="role-type">
                  <div className="role-type-head">
                    <span className="row-media">
                      <Icon name={(t.icon ?? "folder") as IconName} size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{t.plural}</span>
                      <span className="row-meta">
                        {t.project_id !== p.project.id && <span>{t.project_name}</span>}
                        {fieldCount > 0 && <span>{fieldCount === 1 ? "1 veld apart" : `${fieldCount} velden apart`}</span>}
                      </span>
                    </span>
                  </div>
                  <Segmented label={`${t.plural}`} value={entry?.access ?? "default"} onChange={(a) => setType(t.id, a)} options={WITH_DEFAULT} />
                  {t.fields.length > 0 && (
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={open[t.id] ?? false}
                      onClick={() => setOpen((o) => ({ ...o, [t.id]: !o[t.id] }))}
                    >
                      <Icon name={open[t.id] ? "up" : "down"} size={14} /> Per veld
                    </button>
                  )}
                  {open[t.id] && (
                    <div className="role-fields">
                      {t.fields.map((f) => (
                        <div key={f.key} className="role-field">
                          <span className="role-field-name">{f.label}</span>
                          <Segmented
                            label={f.label}
                            value={entry?.fields?.[f.key] ?? "default"}
                            onChange={(a) => setField(t.id, f.key, a)}
                            options={WITH_DEFAULT}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
      {existing && (
        <button type="button" className="btn btn-danger-ghost" style={{ justifySelf: "start" }} onClick={remove}>
          <Icon name="trash" size={16} /> Rol verwijderen
        </button>
      )}
    </form>
  );
}

/** Lege uitzonderingen weglaten. */
function clean(types: Rights["types"]): Rights["types"] {
  return Object.fromEntries(
    Object.entries(types)
      .map(([id, t]) => [id, { ...(t.access ? { access: t.access } : {}), ...(t.fields && Object.keys(t.fields).length ? { fields: t.fields } : {}) }] as const)
      .filter(([, t]) => t.access || t.fields),
  );
}
