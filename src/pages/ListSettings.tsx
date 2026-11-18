import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { canManage, fillsLists, type ListDetail } from "../../shared/model";
import { readsPhoto, ITEMS_FORM, withReads } from "../../shared/photoread";
import type { LedgerDef } from "../../shared/ledger";
import type { StockDef } from "../../shared/stock";
import { templateFile } from "../../shared/template-file";
import type { IconKey } from "../../shared/icons";
import type { Person, Tone } from "../../shared/types";
import { api, useApi } from "../api";
import { CardHead, Switch, Tabs, ToneSwatches } from "../components/Controls";
import { AiMark, buildFields, FieldsEditor, fieldsDraft, type FieldDraft } from "../components/Fields";
import { Icon } from "../components/Icon";
import { IconPicker } from "../components/IconPicker";
import { PageHead } from "../components/Page";
import { PeopleEditor } from "../components/People";
import { TagChooser } from "../components/TagChooser";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { Link, useNavigate } from "../router";
import { useSession } from "../session";

type Tab = "algemeen" | "velden" | "voorraad" | "mensen";

/** Een lijst instellen (enkel een beheerder): Algemeen · Velden · Tellen · Mensen (`?tab=`). */
export function ListSettings() {
  const { id } = useParams();
  const { data: detail, error, reload } = useApi<ListDetail>(`/lists/${id}`);
  const [params, setParams] = useSearchParams();
  if (error && !detail) return <p className="error page">{error}</p>;
  if (!detail) return <p className="page muted">Laden…</p>;
  if (!canManage(detail.role)) return <p className="page muted">Enkel een beheerder kan deze lijst instellen.</p>;
  const tabs: { value: Tab; label: string }[] = [
    { value: "algemeen", label: "Algemeen" },
    { value: "velden", label: "Velden" },
    { value: "voorraad", label: "Tellen" },
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
      {tab === "mensen" && <PeopleEditor base={`/lists/${detail.list.id}`} people={detail.people} onSaved={reload} />}
    </div>
  );
}

/** Een koppeling die in deze lijst schrijft (GET /lists/:id/mirrors). */
type MirrorInfo = { id: string; source_id: string; source: string | null; can_manage: boolean };

/**
 * De koppelingen van deze lijst (zie shared/transfer.ts): elk "Uit <bron>", aan te passen in Toevoegen uit andere lijst
 * (`?bron=`); + Koppeling voor een beheerder. Zonder koppelingen en zonder rechten: niets.
 */
function Mirrors({ listId, manage }: { listId: string; manage: boolean }) {
  const { data: mirrors } = useApi<MirrorInfo[]>(`/lists/${listId}/mirrors`);
  if (!mirrors || (!mirrors.length && !manage)) return null;
  return (
    <section className="card">
      <CardHead
        title="Gekoppeld"
        action={
          manage && (
            <Link to={`/lijsten/${listId}/uit-lijst`} className="btn btn-outline btn-sm">
              <Icon name="plus" size={15} /> Koppeling
            </Link>
          )
        }
      />
      {mirrors.length > 0 && (
        <ul className="rows">
          {mirrors.map((m) => {
            const title = `Uit ${m.source ?? "een andere lijst"}`;
            const inner = (
              <span className="cell-main">
                <span className="row-media">
                  <Icon name="links" size={16} />
                </span>
                <span className="row-title">{title}</span>
              </span>
            );
            return (
              <li key={m.id}>
                {m.can_manage ? (
                  <Link to={`/lijsten/${listId}/uit-lijst?bron=${m.source_id}`} className="row">
                    {inner}
                  </Link>
                ) : (
                  <div className="row">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/lists/${list.id}`, {
        name,
        one: one.trim() || list.one,
        icon,
        color,
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
      body: "Met alle items. Wat ermee gelogd is, blijft in het logboek van zijn formulier. Dat kan niet terug.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/lists/${list.id}`);
    reloadMe();
    toast(`${list.name} verwijderd`);
    navigate("/", { replace: true });
  }

  /** De opbouw van de lijst als bestand, met de formulieren die haar invullen (zonder items, logboek of mensen), om te delen. */
  function downloadTemplate() {
    const own = detail.kinds.filter((k) => fillsLists(k).includes(list.id));
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
          <span className="label">Eén item heet</span>
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
      </section>
      <button type="button" className="btn btn-primary btn-lg" disabled={busy || !name.trim()} onClick={save}>
        Opslaan
      </button>
      <Mirrors listId={list.id} manage={canManage(detail.role)} />
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
  const [reads, setReads] = useState(() => readsPhoto(list.read_photo, ITEMS_FORM, null));
  const [busy, setBusy] = useState(false);
  async function save() {
    const built = buildFields(drafts, list.id);
    if ("error" in built) return toast(built.error, "alert");
    setBusy(true);
    try {
      await api.put(`/lists/${list.id}`, { fields: built.fields, read_photo: withReads(list.read_photo, ITEMS_FORM, null, reads) });
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
      <section className="card form-section">
        <Switch checked={reads} onChange={setReads} label={<>Foto lezen met AI <AiMark /></>} />
      </section>
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
  // Een saldo per persoon (Wie moet wie): een rij per persoon, met de kolom van de persoon en die van het saldo.
  const persons = list.fields.filter((f) => f.type === "person");
  const amounts = list.fields.filter((f) => f.type === "money" || f.type === "number");
  const [ledgerOn, setLedgerOn] = useState(Boolean(list.ledger));
  const [ledger, setLedger] = useState<LedgerDef>(list.ledger ?? { person: persons[0]?.key ?? "", field: amounts.find((f) => f.type === "money")?.key ?? amounts[0]?.key ?? "" });
  async function save() {
    if (ledgerOn && (!ledger.person || !ledger.field)) return toast("Een saldo per persoon heeft een veld Persoon en een veld met een bedrag nodig (Velden).", "alert");
    try {
      await api.put(`/lists/${list.id}`, { stock: on ? def : null, ledger: ledgerOn ? ledger : null });
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
      <section className="card form-section">
        <Switch label="Saldo per persoon" checked={ledgerOn} onChange={setLedgerOn} />
        {ledgerOn && (
          <div className="field-row">
            <label className="field">
              <span className="label">Persoon uit</span>
              <select value={ledger.person} onChange={(e) => setLedger({ ...ledger, person: e.target.value })}>
                <option value="">Geen veld</option>
                {persons.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Saldo in</span>
              <select value={ledger.field} onChange={(e) => setLedger({ ...ledger, field: e.target.value })}>
                <option value="">Geen veld</option>
                {amounts.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>
      <button type="button" className="btn btn-primary btn-lg" onClick={save}>
        Opslaan
      </button>
    </>
  );
}

