import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { NOTIFY_CHOICES } from "../../shared/alerts";
import { BASES, canManage, formsOf, isBase, ROLES, type Base, type DirectRole, type KindInfo, type List, type ListDetail, type ListPerson } from "../../shared/model";
import { readsPhoto, THINGS_FORM, withReads } from "../../shared/photoread";
import type { StockDef } from "../../shared/stock";
import { templateFile } from "../../shared/template-file";
import type { IconKey } from "../../shared/icons";
import type { Person, Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { Avatar, CardHead, Switch, Tabs, ToneSwatches } from "../components/Controls";
import { AiMark, buildFields, FieldsEditor, fieldsDraft, type FieldDraft } from "../components/Fields";
import { Icon, type IconName } from "../components/Icon";
import { IconPicker } from "../components/IconPicker";
import { PageHead } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { TagChooser } from "../components/TagChooser";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { useNavigate } from "../router";
import { useSession } from "../session";

type Tab = "algemeen" | "velden" | "voorraad" | "soorten" | "mensen";

/** Een lijst instellen (enkel een beheerder): Algemeen · Velden · Voorraad · Soorten · Mensen (`?tab=`). */
export function ListSettings() {
  const { id } = useParams();
  const { data: detail, error, reload } = useApi<ListDetail>(`/lists/${id}`);
  const [params, setParams] = useSearchParams();
  if (error && !detail) return <p className="error page">{error}</p>;
  if (!detail) return <p className="page muted">Laden…</p>;
  if (!canManage(detail.role)) return <p className="page muted">Enkel een beheerder kan deze lijst instellen.</p>;
  const tabs: { value: Tab; label: string }[] = [
    { value: "algemeen", label: "Algemeen" },
    ...(detail.list.one
      ? [
          { value: "velden" as const, label: "Velden" },
          { value: "voorraad" as const, label: "Voorraad" },
        ]
      : []),
    { value: "soorten", label: "Formulieren" },
    { value: "mensen", label: "Mensen" },
  ];
  const asked = params.get("tab") as Tab | null;
  const tab = asked && tabs.some((t) => t.value === asked) ? asked : "algemeen";
  return (
    <div className="page form">
      <PageHead title="Instellen" back={{ to: `/lijsten/${detail.list.id}`, label: detail.list.name }} />
      <Tabs label="Onderwerp" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />
      {tab === "algemeen" && <General detail={detail} onSaved={reload} />}
      {tab === "velden" && <Fields detail={detail} onSaved={reload} />}
      {tab === "voorraad" && <Stock detail={detail} onSaved={reload} />}
      {tab === "soorten" && <Kinds detail={detail} onSaved={reload} />}
      {tab === "mensen" && <People detail={detail} onSaved={reload} />}
    </div>
  );
}

function General({ detail, onSaved }: { detail: ListDetail; onSaved: () => void }) {
  const { list } = detail;
  const { tags, reloadMe } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [name, setName] = useState(list.name);
  const [one, setOne] = useState(list.one ?? "");
  const [icon, setIcon] = useState<IconKey | null>(list.icon);
  const [color, setColor] = useState<Tone | null>(list.color);
  const [tagIds, setTagIds] = useState(detail.tags.map((t) => t.id));
  const [fresh, setFresh] = useState<string[]>([]);
  const [notify, setNotify] = useState<keyof typeof NOTIFY_CHOICES>(list.notify?.to ?? "none");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/lists/${list.id}`, {
        name,
        one: one.trim() || (detail.counts.things ? list.one : null),
        icon,
        color,
        notify: notify === "none" ? null : { to: notify },
      });
      await api.put(`/lists/${list.id}/tags`, {
        tag_ids: tagIds,
        new_tags: fresh,
      });
      setFresh([]);
      toast("Bewaard");
      onSaved();
      reloadMe();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    await api.put(`/lists/${list.id}/archived`, { archived: !list.archived });
    toast(list.archived ? `${list.name} terug uit het archief` : `${list.name} gearchiveerd`);
    onSaved();
    reloadMe();
  }
  async function remove() {
    const ok = await confirm({
      title: `${list.name} verwijderen?`,
      body: "Met alle dingen en het hele logboek. Dat kan niet terug.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/lists/${list.id}`);
    reloadMe();
    toast(`${list.name} verwijderd`);
    navigate("/", { replace: true });
  }

  /** De opbouw van de lijst als bestand (zonder dingen, logboek of mensen), om te delen. */
  function downloadTemplate() {
    const own = detail.kinds.filter((k) => k.list_id === list.id);
    const file = templateFile(list, own);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${list.name.replace(/[^\p{L}\p{N} -]+/gu, "").trim() || "lijst"} (sjabloon).json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Eén ding heet</span>
          <input value={one} maxLength={40} placeholder="bv. Wijn" onChange={(e) => setOne(e.target.value)} />
        </label>
        <div className="field">
          <span className="label">Icoon</span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        <div className="field">
          <span className="label">Kleur</span>
          <ToneSwatches value={color} onChange={setColor} />
        </div>
      </section>
      <section className="card form-section">
        <TagChooser tags={tags} value={tagIds} onChange={setTagIds} fresh={fresh} onFresh={setFresh} />
        <label className="field">
          <span className="label">Melding bij iets nieuws</span>
          <select value={notify} onChange={(e) => setNotify(e.target.value as keyof typeof NOTIFY_CHOICES)}>
            {Object.entries(NOTIFY_CHOICES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <button type="button" className="btn btn-primary btn-lg" disabled={busy || !name.trim()} onClick={save}>
        Opslaan
      </button>
      <div className="btn-row" style={{ justifySelf: "start" }}>
        <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
          <Icon name="download" size={15} /> Als sjabloon
        </button>
        <button type="button" className="btn btn-ghost" onClick={archive}>
          <Icon name="archive" size={15} /> {list.archived ? "Uit het archief" : "Archiveren"}
        </button>
        <button type="button" className="btn btn-danger-ghost" onClick={remove}>
          <Icon name="trash" size={15} /> Verwijderen
        </button>
      </div>
    </>
  );
}

function Fields({ detail, onSaved }: { detail: ListDetail; onSaved: () => void }) {
  const { list } = detail;
  const { person, lists } = useSession();
  const { data: people } = useApi<Person[]>("/me/people");
  const toast = useToast();
  const [drafts, setDrafts] = useState<FieldDraft[]>(() => fieldsDraft(list.fields));
  const [reads, setReads] = useState(() => readsPhoto(list.read_photo, THINGS_FORM, null));
  const [busy, setBusy] = useState(false);
  async function save() {
    const built = buildFields(drafts, list.id);
    if ("error" in built) return toast(built.error, "alert");
    setBusy(true);
    try {
      await api.put(`/lists/${list.id}`, { fields: built.fields, ...(list.one ? { read_photo: withReads(list.read_photo, THINGS_FORM, null, reads) } : {}) });
      toast("Velden bewaard");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="card form-section">
        <FieldsEditor value={drafts} onChange={setDrafts} lists={lists} selfLabel={list.name} selfId={list.id} people={people ?? []} meId={person.id} />
      </section>
      {list.one && (
        <section className="card form-section">
          <Switch checked={reads} onChange={setReads} label={<>Foto lezen met AI <AiMark /></>} />
        </section>
      )}
      <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={save}>
        Opslaan
      </button>
    </>
  );
}

const STOCK_PARTS: { key: keyof StockDef; label: string; types: string[] }[] = [
  { key: "unit", label: "Eenheid uit", types: ["select", "text"] },
  { key: "piece", label: "Inhoud per stuk (g of ml) uit", types: ["number"] },
  { key: "pack", label: "In een verpakking uit", types: ["number"] },
  {
    key: "pack_name",
    label: "Naam van de verpakking uit",
    types: ["select", "text"],
  },
  { key: "min", label: "Bijna op onder uit", types: ["number"] },
];

function Stock({ detail, onSaved }: { detail: ListDetail; onSaved: () => void }) {
  const { list } = detail;
  const toast = useToast();
  const [on, setOn] = useState(Boolean(list.stock));
  const [def, setDef] = useState<StockDef>(list.stock ?? { default_unit: "stuk" });
  async function save() {
    try {
      await api.put(`/lists/${list.id}`, { stock: on ? def : null });
      toast("Bewaard");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <>
      <section className="card form-section">
        <Switch label="Telt voorraad" checked={on} onChange={setOn} />
        {on && (
          <>
            <label className="field">
              <span className="label">Eenheid als er geen is</span>
              <input value={def.default_unit ?? ""} maxLength={20} placeholder="bv. stuk, kg, fles" onChange={(e) => setDef({ ...def, default_unit: e.target.value })} />
            </label>
            {STOCK_PARTS.map((p) => (
              <label key={p.key} className="field">
                <span className="label">{p.label}</span>
                <select value={def[p.key] ?? ""} onChange={(e) => setDef({ ...def, [p.key]: e.target.value || undefined })}>
                  <option value="">Geen veld</option>
                  {list.fields
                    .filter((f) => p.types.includes(f.type))
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </>
        )}
      </section>
      <button type="button" className="btn btn-primary btn-lg" onClick={save}>
        Opslaan
      </button>
    </>
  );
}

function Kinds({ detail, onSaved }: { detail: ListDetail; onSaved: () => void }) {
  const own = detail.kinds.filter((k) => k.list_id === detail.list.id);
  const [editing, setEditing] = useState<KindInfo | "new" | null>(null);
  return (
    <>
      <section className="card">
        <CardHead
          title="Formulieren"
          action={
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing("new")}>
              <Icon name="plus" size={15} /> Formulier
            </button>
          }
        />
        {own.length === 0 ? (
          <p className="card-body muted">{Object.values(BASES).map((b) => b.label).join(", ")}</p>
        ) : (
          <ul className="rows">
            {own.map((k) => (
              <li key={k.id}>
                <button type="button" className="row" onClick={() => setEditing(k)}>
                  <span className="cell-main">
                    <span className="row-media">
                      <Icon name={k.icon as IconName} size={16} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{k.name}</span>
                      <span className="row-meta">
                        <span>
                          {BASES[k.base].label}
                          {k.fields.length ? ` · ${k.fields.map((f) => f.label).join(", ")}` : ""}
                        </span>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PhotoForms detail={detail} onSaved={onSaved} />
      <Sheet open={editing !== null} title={editing === "new" ? "Nieuw formulier" : (editing?.name ?? "")} onClose={() => setEditing(null)}>
        {editing !== null && (
          <KindForm
            list={detail.list}
            kind={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              onSaved();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Welke formulieren een foto lezen met de AI: die van de lijst (`formsOf`), elk met een schakelaar (meteen bewaard). */
function PhotoForms({ detail, onSaved }: { detail: ListDetail; onSaved: () => void }) {
  const { list } = detail;
  const toast = useToast();
  const forms = formsOf(detail.kinds, list.id).shown;
  const [setting, setSetting] = useState(list.read_photo);
  async function toggle(k: KindInfo, on: boolean) {
    const before = setting;
    const next = withReads(setting, k.id, k, on);
    setSetting(next);
    try {
      await api.put(`/lists/${list.id}`, { read_photo: next });
      onSaved();
    } catch (err) {
      setSetting(before);
      toast((err as Error).message, "alert");
    }
  }
  return (
    <section className="card">
      <CardHead
        title={
          <>
            Foto lezen met AI <AiMark />
          </>
        }
      />
      <div className="card-body switch-list">
        {forms.map((k) => (
          <Switch key={k.id} checked={readsPhoto(setting, k.id, k)} onChange={(on) => toggle(k, on)} label={k.name} />
        ))}
      </div>
    </section>
  );
}

function KindForm({ list, kind, onDone }: { list: List; kind: KindInfo | null; onDone: () => void }) {
  const listId = list.id;
  const { person, lists } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [base, setBase] = useState<Base>(kind?.base ?? "gebruik");
  const [name, setName] = useState(kind?.name ?? "");
  const [icon, setIcon] = useState<IconKey | null>((kind?.icon as IconKey) ?? null);
  const [goal, setGoal] = useState(kind?.goal ? String(Math.round(kind.goal / 60)) : "");
  const [drafts, setDrafts] = useState<FieldDraft[]>(() => fieldsDraft(kind?.fields ?? []));
  // Foto lezen: null = de standaard (met geld of voedingswaarden), anders wat je koos.
  const [readChoice, setReadChoice] = useState<boolean | null>(null);
  const reads = readChoice ?? readsPhoto(list.read_photo, kind?.id ?? "", { base, fields: kind?.fields ?? [] });
  async function save() {
    const built = buildFields(drafts, "self");
    if ("error" in built) return toast(built.error, "alert");
    const body = {
      base,
      name,
      icon,
      fields: built.fields,
      goal: base === "activiteit" && goal.trim() ? Math.round(Number(goal.replace(",", ".")) * 60) : null,
    };
    try {
      const id = kind ? (await api.put(`/kinds/${kind.id}`, body), kind.id) : (await api.post<{ id: string }>(`/lists/${listId}/kinds`, body)).id;
      if (readChoice !== null) await api.put(`/lists/${listId}`, { read_photo: withReads(list.read_photo, id, { base, fields: built.fields }, readChoice) });
      toast(`${name} bewaard`);
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  async function remove() {
    if (
      !kind ||
      !(await confirm({
        title: `${kind.name} weghalen?`,
        body: `Wat ermee gelogd is, blijft, als ${BASES[kind.base].label.toLowerCase()}.`,
        confirmLabel: "Weghalen",
        danger: true,
      }))
    )
      return;
    await api.delete(`/kinds/${kind.id}`);
    toast(`${kind.name} weggehaald`);
    onDone();
  }
  return (
    <div className="form">
      {!kind && (
        <label className="field">
          <span className="label">Werkt als</span>
          <select value={base} onChange={(e) => isBase(e.target.value) && setBase(e.target.value)}>
            {Object.entries(BASES).map(([k, b]) => (
              <option key={k} value={k} title={b.hint}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="label">Naam</span>
        <input value={name} maxLength={40} required placeholder="bv. Gegeten, Carwash" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span className="label">Icoon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      {base === "activiteit" && (
        <label className="field">
          <span className="label">Melding na (uren)</span>
          <input inputMode="decimal" value={goal} placeholder="bv. 16" onChange={(e) => setGoal(e.target.value)} />
        </label>
      )}
      <FieldsEditor value={drafts} onChange={setDrafts} lists={lists} selfLabel={name || "Dit formulier"} people={[]} meId={person.id} />
      <Switch checked={reads} onChange={setReadChoice} label={<>Foto lezen met AI <AiMark /></>} />
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          Opslaan
        </button>
        {kind && (
          <button type="button" className="btn btn-danger-ghost" onClick={remove}>
            Weghalen
          </button>
        )}
      </div>
    </div>
  );
}

function People({ detail, onSaved }: { detail: ListDetail; onSaved: () => void }) {
  const { list } = detail;
  const { person: me } = useSession();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  async function setRole(p: ListPerson, role: DirectRole | null) {
    try {
      await api.put(`/lists/${list.id}/people/${p.person.id}`, { role });
      toast(role === null ? `${p.person.name} weggehaald` : `${p.person.name}: ${role === "geen" ? "geen toegang" : ROLES[role].label.toLowerCase()}`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <>
      <section className="card">
        <CardHead
          title="Wie"
          action={
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} /> Iemand
            </button>
          }
        />
        <ul className="rows">
          {detail.people.map((p) => (
            <li key={p.person.id}>
              <div className="row">
                <span className="cell-main">
                  <Avatar member={p.person} />
                  <span className="row-main">
                    <span className="row-title">{p.person.id === me.id ? `${p.person.name} (jij)` : p.person.name}</span>
                    <span className="row-meta">
                      <span>{p.direct === "geen" ? "Geen toegang (uitzondering)" : p.via ? `Via ${p.via.tag}` : ROLES[p.role].label}</span>
                    </span>
                  </span>
                </span>
                <span className="member-actions">
                  <select className="scope-select" aria-label={`Rol van ${p.person.name}`} value={p.direct ?? ""} onChange={(e) => setRole(p, (e.target.value || null) as DirectRole | null)}>
                    {p.via && (
                      <option value="">
                        Via {p.via.tag} ({ROLES[p.role].label.toLowerCase()})
                      </option>
                    )}
                    {!p.via && !p.direct && <option value="">—</option>}
                    {Object.entries(ROLES).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r.label}
                      </option>
                    ))}
                    <option value="geen">Geen toegang</option>
                  </select>
                  {p.direct && !p.via && (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${p.person.name} weghalen`} onClick={() => setRole(p, null)}>
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Sheet open={adding} title="Iemand toevoegen" onClose={() => setAdding(false)}>
        {adding && (
          <AddPerson
            listId={list.id}
            onDone={() => {
              setAdding(false);
              onSaved();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function AddPerson({ listId, onDone }: { listId: string; onDone: () => void }) {
  const toast = useToast();
  const { data: known } = useApi<Person[]>("/me/people");
  const [personId, setPersonId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"beheerder" | "lid" | "gast">("lid");
  useEffect(() => setPersonId(""), [known]);
  async function save() {
    try {
      await api.post(`/lists/${listId}/people`, personId ? { person_id: personId, role } : { name, email: email || null, role });
      toast("Toegevoegd");
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  return (
    <div className="form">
      {(known ?? []).length > 1 && (
        <label className="field">
          <span className="label">Iemand die je kent</span>
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Iemand nieuw</option>
            {(known ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!personId && (
        <>
          <label className="field">
            <span className="label">Naam</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">E-mailadres</span>
            <input type="email" value={email} placeholder="Om zelf aan te melden" onChange={(e) => setEmail(e.target.value)} />
          </label>
        </>
      )}
      <label className="field">
        <span className="label">Rol</span>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {Object.entries(ROLES).map(([k, r]) => (
            <option key={k} value={k}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-primary" disabled={!personId && !name.trim()} onClick={save}>
        Toevoegen
      </button>
    </div>
  );
}
