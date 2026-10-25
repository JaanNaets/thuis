import { useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { rightsSummary } from "../../shared/access";
import type { IconKey } from "../../shared/templates";
import { TONES, type Member, type Person, type ProjectDetail, type ProjectInput, type Tag, type Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead, Segmented, SubmitButton, Tabs, ToneSwatches } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";
import { ProjectFieldsCard } from "./ProjectNew";

type Tab = "algemeen" | "soorten" | "rollen" | "mensen" | "tags";

/** Een project instellen: wat het is, welke soorten, welke rollen, wie erin zit, en de tags. */
export function ProjectSettings() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: p, error, reload } = useApi<ProjectDetail>(`/projects/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;

  const { rights } = p.project;
  const tabs: { value: Tab; label: string }[] = [
    ...(rights.manage
      ? [
          { value: "algemeen" as const, label: "Algemeen" },
          { value: "soorten" as const, label: "Soorten" },
          { value: "rollen" as const, label: "Rollen" },
        ]
      : []),
    { value: "mensen", label: "Mensen" },
    ...(rights.manage ? [{ value: "tags" as const, label: "Tags" }] : []),
  ];
  const tab = tabs.find((t) => t.value === params.get("tab"))?.value ?? tabs[0].value;

  return (
    <div className="page settings-page">
      <PageHead title="Instellen" description={p.project.name} back={{ to: `/projecten/${p.project.id}`, label: p.project.name }} />
      <Tabs label="Onderwerp" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />
      <div className="settings-grid">
        {tab === "algemeen" && <GeneralTab project={p} onSaved={reload} />}
        {tab === "soorten" && <TypesTab project={p} />}
        {tab === "rollen" && <RolesTab project={p} />}
        {tab === "mensen" && <PeopleTab project={p} onChanged={reload} />}
        {tab === "tags" && <TagsTab project={p} onChanged={reload} />}
      </div>
    </div>
  );
}

// ---------- algemeen ----------

function GeneralTab({ project: p, onSaved }: { project: ProjectDetail; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { reloadMe } = useSession();
  const pr = p.project;
  const [name, setName] = useState(pr.name);
  const [icon, setIcon] = useState<IconKey | null>(pr.icon);
  const [color, setColor] = useState<Tone | null>(pr.color);
  const [description, setDescription] = useState(pr.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: FormEvent) {
    e.preventDefault();
    const input: ProjectInput = { name, icon, color, description: description || null, parent_id: pr.parent_id };
    setBusy(true);
    setError(undefined);
    try {
      await api.put(`/projects/${pr.id}`, input);
      reloadMe();
      onSaved();
      toast("Project bijgewerkt");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    await api.put(`/projects/${pr.id}/archived`, { archived: !pr.archived });
    reloadMe();
    onSaved();
    toast(pr.archived ? "Project weer actief" : "Project gearchiveerd", "archive");
  }

  async function remove() {
    if (!(await confirm({ title: `${pr.name} verwijderen?`, body: "Dit kan niet ongedaan gemaakt worden.", confirmLabel: "Verwijderen", danger: true })))
      return;
    try {
      await api.delete(`/projects/${pr.id}`);
    } catch (err) {
      return toast((err as Error).message, "alert");
    }
    reloadMe();
    toast("Project verwijderd", "trash");
    navigate(pr.parent_id ? `/projecten/${pr.parent_id}` : "/", { replace: true });
  }

  return (
    <form className="form" onSubmit={save}>
      <ProjectFieldsCard
        name={name}
        onName={setName}
        icon={icon}
        onIcon={setIcon}
        color={color}
        onColor={setColor}
        description={description}
        onDescription={setDescription}
      />
      {error && <p className="error">{error}</p>}
      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
      <div className="btn-row" style={{ justifySelf: "start" }}>
        <button type="button" className="btn btn-ghost" onClick={archive}>
          <Icon name="archive" size={16} /> {pr.archived ? "Weer actief maken" : "Archiveren"}
        </button>
        <button type="button" className="btn btn-danger-ghost" onClick={remove}>
          <Icon name="trash" size={16} /> Verwijderen
        </button>
      </div>
      <p className="hint">Verwijderen kan enkel als het project leeg is (geen items, geen subprojecten). Anders: archiveren.</p>
    </form>
  );
}

// ---------- soorten ----------

function TypesTab({ project: p }: { project: ProjectDetail }) {
  const id = p.project.id;
  const projectName = (pid: string) => p.path.find((x) => x.id === pid)?.name ?? "erboven";
  const own = p.types.filter((t) => t.project_id === id);
  const inherited = p.types.filter((t) => t.project_id !== id);
  return (
    <section className="card">
      <CardHead
        icon="folder"
        title="Soorten"
        description="Elke soort is een formulier met eigen velden. Ze gelden ook in de subprojecten."
        action={
          <Link to={`/projecten/${id}/soorten/nieuw`} className="btn btn-outline btn-sm">
            <Icon name="plus" size={15} /> Soort
          </Link>
        }
      />
      <ul className="rows">
        {own.map((t) => (
          <li key={t.id}>
            <Link to={`/projecten/${id}/soorten/${t.id}`} className="row">
              <span className="cell-main">
                <span className="row-media tone-sky">
                  <Icon name={(t.icon ?? "folder") as IconName} size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">{t.plural}</span>
                  <span className="row-meta">
                    <span>{t.fields.length === 1 ? "1 veld" : `${t.fields.length} velden`}</span>
                    <span>{(p.counts[t.id] ?? 0) === 1 ? "1 item" : `${p.counts[t.id] ?? 0} items`}</span>
                  </span>
                </span>
              </span>
              <Icon name="next" size={16} className="row-chevron" />
            </Link>
          </li>
        ))}
        {inherited.map((t) => (
          <li key={t.id}>
            <div className="row">
              <span className="cell-main">
                <span className="row-media">
                  <Icon name={(t.icon ?? "folder") as IconName} size={16} />
                </span>
                <span className="row-main">
                  <span className="row-title">{t.plural}</span>
                  <span className="row-meta">
                    <span>van {projectName(t.project_id)}</span>
                  </span>
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {p.types.length === 0 && <p className="card-body muted small">Nog geen soorten. Maak er een, bv. "Wijn" met jaargang en druiven.</p>}
    </section>
  );
}

// ---------- rollen ----------

function RolesTab({ project: p }: { project: ProjectDetail }) {
  const id = p.project.id;
  const projectName = (pid: string) => p.path.find((x) => x.id === pid)?.name ?? "erboven";
  return (
    <section className="card">
      <CardHead
        icon="users"
        title="Rollen"
        description="Wat iemand mag: het project instellen, mensen beheren, toevoegen, verwijderen, en per soort en veld niet zien, zien of wijzigen."
        action={
          <Link to={`/projecten/${id}/rollen/nieuw`} className="btn btn-outline btn-sm">
            <Icon name="plus" size={15} /> Rol
          </Link>
        }
      />
      <ul className="rows">
        {p.roles.map((r) => {
          const own = r.project_id === id;
          const body = (
            <>
              <span className="row-main">
                <span className="row-title">{r.name}</span>
                <span className="row-meta">
                  <span>{rightsSummary(r.rights)}</span>
                  {!own && <span>van {projectName(r.project_id)}</span>}
                </span>
              </span>
              <span className="row-end muted small">{r.member_count === 1 ? "1 persoon" : `${r.member_count} personen`}</span>
            </>
          );
          return (
            <li key={r.id}>
              {own ? (
                <Link to={`/projecten/${id}/rollen/${r.id}`} className="row">
                  {body}
                  <Icon name="next" size={16} className="row-chevron" />
                </Link>
              ) : (
                <div className="row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- mensen ----------

function PeopleTab({ project: p, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { person: me, reloadMe } = useSession();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person>();
  const canManage = p.project.rights.members;
  const id = p.project.id;

  async function setRole(m: Member, roleId: string) {
    try {
      await api.put(`/projects/${id}/members/${m.person.id}`, { role_id: roleId });
      toast(`${m.person.name}: ${p.roles.find((r) => r.id === roleId)?.name}`);
      onChanged();
      if (m.person.id === me.id) reloadMe();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  async function remove(m: Member) {
    const ok = await confirm({ title: `${m.person.name} uit ${p.project.name} halen?`, confirmLabel: "Weghalen", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/projects/${id}/members/${m.person.id}`);
      toast(`${m.person.name} weggehaald`);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }

  return (
    <section className="card">
      <CardHead
        icon="users"
        title="Mensen"
        description="Wie erboven zit, zit ook hier, met dezelfde rol, tenzij je hier een andere rol geeft."
        action={
          canManage && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
              <Icon name="userPlus" size={15} /> Iemand
            </button>
          )
        }
      />
      <ul className="rows">
        {p.members.map((m) => (
          <li key={m.person.id}>
            <div className="row member-row">
              <span className="cell-main">
                <Avatar member={m.person} />
                <span className="row-main">
                  <span className="row-title">{m.person.id === me.id ? `${m.person.name} (ik)` : m.person.name}</span>
                  <span className="row-meta">
                    <span>{m.person.email ?? "meldt niet aan"}</span>
                    {m.inherited && <span>via {p.path.find((x) => x.id === m.project_id)?.name ?? "erboven"}</span>}
                  </span>
                </span>
              </span>
              {canManage ? (
                <span className="member-actions">
                  <select className="scope-select" value={m.role_id} aria-label={`Rol van ${m.person.name}`} onChange={(e) => setRole(m, e.target.value)}>
                    {p.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${m.person.name} bewerken`} onClick={() => setEditing(m.person)}>
                    <Icon name="edit" size={15} />
                  </button>
                  {!m.inherited && (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${m.person.name} weghalen`} onClick={() => remove(m)}>
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </span>
              ) : (
                <span className="row-end muted small">{p.roles.find((r) => r.id === m.role_id)?.name}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={adding} title="Iemand toevoegen" onClose={() => setAdding(false)}>
        {adding && (
          <AddPersonForm
            project={p}
            onDone={(name) => {
              setAdding(false);
              toast(`${name} toegevoegd`);
              onChanged();
            }}
          />
        )}
      </Sheet>
      <Sheet open={Boolean(editing)} title={editing?.name ?? ""} onClose={() => setEditing(undefined)}>
        {editing && (
          <PersonForm
            person={editing}
            onDone={() => {
              setEditing(undefined);
              toast("Bewaard");
              onChanged();
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

/** Iemand die je al kent (uit dezelfde boom), of iemand nieuw: met e-mailadres (meldt zelf aan) of enkel een naam. */
function AddPersonForm({ project: p, onDone }: { project: ProjectDetail; onDone: (name: string) => void }) {
  const { data: known } = useApi<Person[]>(`/projects/${p.project.id}/people`);
  const candidates = (known ?? []).filter((k) => !p.members.some((m) => m.person.id === k.id));
  const [who, setWho] = useState<"known" | "new">("new");
  const [personId, setPersonId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const defaultRole = p.roles.find((r) => !r.rights.manage && r.rights.create) ?? p.roles[0];
  const [roleId, setRoleId] = useState(defaultRole?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body =
        who === "known"
          ? { person_id: personId, role_id: roleId }
          : { name, email: email.trim() || null, role_id: roleId, color: TONES[name.length % TONES.length] };
      const person = await api.post<Person>(`/projects/${p.project.id}/members`, body);
      onDone(person.name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {candidates.length > 0 && (
        <Segmented
          label="Wie"
          value={who}
          onChange={setWho}
          options={[
            { value: "new", label: "Iemand nieuw" },
            { value: "known", label: "Al gekend" },
          ]}
        />
      )}
      {who === "known" ? (
        <label className="field">
          <span className="label">Wie</span>
          <select required value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Kies iemand</option>
            {candidates.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="field">
            <span className="label">Naam</span>
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Lien" />
          </label>
          <label className="field">
            <span className="label">
              E-mailadres <span className="optional">· om zelf aan te melden</span>
            </span>
            <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lien@voorbeeld.be" />
            <span className="hint">Zonder e-mailadres kan je die toch kiezen (bv. wie betaalde). Een e-mailadres kan je later nog toevoegen.</span>
          </label>
        </>
      )}
      <label className="field">
        <span className="label">Rol</span>
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {p.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="hint">{p.roles.find((r) => r.id === roleId) ? rightsSummary(p.roles.find((r) => r.id === roleId)!.rights) : ""}</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Toevoegen</SubmitButton>
      </div>
    </form>
  );
}

/** Naam en kleur van iemand, en een e-mailadres voor wie nog niet aanmeldt. */
function PersonForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [color, setColor] = useState<Tone | null>(person.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/people/${person.id}`, { name, color, email: person.email ? undefined : email.trim() || null });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">E-mailadres</span>
        <input
          type="email"
          maxLength={200}
          value={email}
          disabled={Boolean(person.email)}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="om zelf aan te melden"
        />
        <span className="hint">
          {person.email
            ? "Het e-mailadres van wie al aanmeldt, verandert niet."
            : "Met een e-mailadres kan die zelf aanmelden, en blijft het dezelfde persoon."}
        </span>
      </label>
      <div className="field">
        <span className="label">Kleur</span>
        <ToneSwatches value={color} onChange={setColor} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

// ---------- tags ----------

function TagsTab({ project: p, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Tag | "new">();
  const own = p.tags.filter((t) => t.project_id === p.project.id);
  const inherited = p.tags.filter((t) => t.project_id !== p.project.id);
  return (
    <section className="card">
      <CardHead
        icon="tag"
        title="Tags"
        description="Vrije labels op items, over soorten heen. Ze gelden ook in de subprojecten."
        action={
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> Tag
          </button>
        }
      />
      <div className="card-body tag-line">
        {own.map((t) => (
          <button key={t.id} type="button" className={`tag tone-${t.color ?? "butter"}`} onClick={() => setEditing(t)}>
            {t.name}
          </button>
        ))}
        {inherited.map((t) => (
          <span key={t.id} className={`tag static tone-${t.color ?? "butter"}`} title="Van een project erboven">
            {t.name}
          </span>
        ))}
        {p.tags.length === 0 && <span className="muted small">Nog geen tags.</span>}
      </div>
      <Sheet open={Boolean(editing)} title={editing === "new" ? "Nieuwe tag" : "Tag"} onClose={() => setEditing(undefined)}>
        {editing && (
          <TagForm
            projectId={p.project.id}
            tag={editing === "new" ? undefined : editing}
            onDone={(message) => {
              setEditing(undefined);
              toast(message);
              onChanged();
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function TagForm({ projectId, tag, onDone }: { projectId: string; tag?: Tag; onDone: (message: string) => void }) {
  const confirm = useConfirm();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<Tone | null>(tag?.color ?? "sky");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (tag) await api.put(`/tags/${tag.id}`, { name, color });
      else await api.post(`/projects/${projectId}/tags`, { name, color });
      onDone(tag ? "Tag bijgewerkt" : "Tag gemaakt");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !tag ||
      !(await confirm({
        title: `Tag "${tag.name}" verwijderen?`,
        body: "De items blijven; enkel de tag verdwijnt.",
        confirmLabel: "Verwijderen",
        danger: true,
      }))
    )
      return;
    await api.delete(`/tags/${tag.id}`);
    onDone("Tag verwijderd");
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="field">
        <span className="label">Kleur</span>
        <ToneSwatches value={color} onChange={setColor} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {tag && (
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={remove}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        )}
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}
