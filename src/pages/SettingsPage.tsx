import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Link } from "../router";
import { descendantIds, flattenTree } from "../../shared/tree";
import {
  ACCESS_LEVELS,
  type Access,
  type Category,
  type CategoryDomain,
  type HouseholdAccess,
  type Location,
  type Member,
  type Tag,
  type Taxonomy,
  type Tone,
} from "../../shared/types";
import { SPLIT_LABELS } from "../../shared/split";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead, Segmented, SubmitButton, Switch, Tabs, ToneSwatches, TreeSelect } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { stagger } from "../components/Motion";
import { PageHead, toneForCategory } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { NewHousehold } from "../components/Sidebar";
import { buildDefaultSplit, defaultSplitDraft, DefaultSplitField } from "../components/SplitEditor";
import { useToast } from "../components/Toast";
import { isKiosk } from "../device";
import { useSession } from "../session";
import { activeMembers, memberById, refreshTaxonomy, useTaxonomy } from "../taxonomy";

/** Wat er in een venster bewerkt wordt; zonder item = iets nieuws. */
type Editing =
  | { kind: "member"; item?: Member }
  | { kind: "category"; domain: CategoryDomain; item?: Category }
  | { kind: "location"; item?: Location }
  | { kind: "tag"; item?: Tag };

const WHAT = { member: "lid", category: "categorie", location: "plaats", tag: "tag" } as const;

type Section = "household" | "categories" | "locations" | "tags" | "device";

/** De tab staat in het adres (/meer?tab=plaatsen), zodat je er vanuit de zijbalk naartoe kan. */
const SLUGS: Record<Section, string> = {
  household: "huishouden",
  categories: "categorieen",
  locations: "plaatsen",
  tags: "tags",
  device: "toestel",
};

export function SettingsPage() {
  const { data: taxonomy, error } = useTaxonomy();
  const { full } = useSession();
  const [editing, setEditing] = useState<Editing>();
  const [editingHousehold, setEditingHousehold] = useState(false);
  const [domain, setDomain] = useState<CategoryDomain>("item");
  const [searchParams, setSearchParams] = useSearchParams();
  // Een gast (enkel projecten) beheert niets van het huishouden; enkel dit toestel.
  const section = full ? ((Object.keys(SLUGS) as Section[]).find((k) => SLUGS[k] === searchParams.get("tab")) ?? "household") : "device";
  const setSection = (next: Section) => setSearchParams({ tab: SLUGS[next] }, { replace: true });

  return (
    <div className="page">
      <PageHead title="Instellingen" description={full ? "Wie er in huis woont en hoe alles ingedeeld is" : "Je huishoudens en dit toestel"} />

      <PhoneMenu />
      {error && <p className="error">{error}</p>}

      {taxonomy && full && (
        <Tabs
          label="Instellingen"
          value={section}
          onChange={setSection}
          tabs={[
            { value: "household", label: "Huishouden", count: taxonomy.members.length },
            { value: "categories", label: "Categorieën" },
            { value: "locations", label: "Plaatsen", count: taxonomy.locations.length },
            { value: "tags", label: "Tags", count: taxonomy.tags.length },
            { value: "device", label: "Dit toestel" },
          ]}
        />
      )}

      {taxonomy && (
        <div className="settings-grid" key={section}>
          <Card show={section === "household"} icon="home" title={taxonomy.household.name} desc="Naam en hoe uitgaven gewoonlijk verdeeld worden">
            <dl className="dl">
              <div>
                <dt>Gewone verdeling</dt>
                <dd>{defaultSplitText(taxonomy)}</dd>
              </div>
            </dl>
            <div className="card-body" style={{ paddingTop: 12 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingHousehold(true)}>
                <Icon name="edit" size={15} /> Bewerken
              </button>
            </div>
          </Card>

          <Card
            show={section === "household"}
            icon="users"
            title="Leden"
            desc="Voeg iemand toe met het e-mailadres waarmee die aanmeldt"
            onAdd={() => setEditing({ kind: "member" })}
            addLabel="Lid"
          >
            <ul className="rows stagger">
              {memberGroups(taxonomy).map(({ label, members }, g) => [
                <li key={`g${g}`} className="group-row" style={stagger(g)}>
                  {label} <span className="group-count">{members.length}</span>
                </li>,
                ...members.map((m, i) => (
                  <li key={m.id} style={stagger(g + i + 1)}>
                    <button type="button" className="row" onClick={() => setEditing({ kind: "member", item: m })}>
                      <Avatar member={m} />
                      <span className="row-main">
                        <span className="row-title">
                          {m.name}
                          {m.id === taxonomy.me.id && <span className="muted"> · jij</span>}
                        </span>
                        <span className="row-meta">
                          <span>{m.email ?? "meldt niet aan"}</span>
                        </span>
                      </span>
                      {m.access === "projects" ? (
                        <span className="badge badge-secondary">gast</span>
                      ) : (
                        m.active === 0 && <span className="badge badge-secondary">woont hier niet</span>
                      )}
                      <Icon name="next" size={16} className="row-chevron" />
                    </button>
                  </li>
                )),
              ])}
            </ul>
          </Card>

          <Card show={section === "categories"} icon="folder" title="Categorieën" onAdd={() => setEditing({ kind: "category", domain })} addLabel="Categorie">
            <div className="card-body" style={{ paddingTop: 14, paddingBottom: 14 }}>
              <Segmented
                label="Soort categorieën"
                value={domain}
                onChange={setDomain}
                options={[
                  { value: "item", label: <span>Voorraad</span> },
                  { value: "expense", label: <span>Aankopen</span> },
                ]}
              />
            </div>
            <TreeList
              key={domain}
              nodes={flattenTree(taxonomy.categories.filter((c) => c.domain === domain))}
              tone={(c) => c.color ?? (c.parent_id ? null : toneForCategory(c.name))}
              onEdit={(c) => setEditing({ kind: "category", domain, item: c })}
            />
          </Card>

          <Card
            show={section === "locations"}
            icon="pin"
            title="Plaatsen"
            desc="Kamers, kasten en vakken"
            onAdd={() => setEditing({ kind: "location" })}
            addLabel="Plaats"
          >
            <TreeList nodes={flattenTree(taxonomy.locations)} onEdit={(l) => setEditing({ kind: "location", item: l })} />
          </Card>

          <Card show={section === "tags"} icon="tag" title="Tags" desc="Vrije labels over alles heen" onAdd={() => setEditing({ kind: "tag" })} addLabel="Tag">
            <div className="card-body">
              {taxonomy.tags.length === 0 ? (
                <p className="hint">Bv. "Vakantie Italië", "Verbouwing" of "Baby".</p>
              ) : (
                <div className="tag-picker">
                  {taxonomy.tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`tag static tone-${t.color ?? "butter"}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => setEditing({ kind: "tag", item: t })}
                    >
                      {t.name}
                      <span className="tag-count">{t.usage}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card show={section === "device"} icon="tablet" title="Dit toestel" desc="Instellingen die enkel voor dit toestel gelden">
            <div className="card-body">
              <Switch
                checked={isKiosk}
                onChange={(on) => (location.href = on ? "/?kiosk=1" : "/?kiosk=0")}
                label="Kioskmodus"
                hint="Voor de tablet in de keuken: na 5 minuten terug naar het begin, gegevens ververst."
              />
            </div>
          </Card>
        </div>
      )}

      <Sheet open={Boolean(editing)} title={editing ? sheetTitle(editing) : ""} onClose={() => setEditing(undefined)}>
        {editing && taxonomy && <EditForm editing={editing} taxonomy={taxonomy} onDone={() => setEditing(undefined)} />}
      </Sheet>
      <Sheet open={editingHousehold} title="Huishouden" onClose={() => setEditingHousehold(false)}>
        {editingHousehold && taxonomy && <HouseholdForm taxonomy={taxonomy} onDone={() => setEditingHousehold(false)} />}
      </Sheet>
    </div>
  );
}

function Card({
  show,
  icon,
  title,
  desc,
  onAdd,
  addLabel,
  children,
}: {
  /** Enkel de kaart van de gekozen tab is zichtbaar. */
  show: boolean;
  icon: IconName;
  title: string;
  desc?: string;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  if (!show) return null;
  return (
    <section className="card">
      <CardHead
        icon={icon}
        title={title}
        description={desc}
        action={
          onAdd && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onAdd}>
              <Icon name="plus" size={15} /> {addLabel}
            </button>
          )
        }
      />
      {children}
    </section>
  );
}

function sheetTitle(e: Editing): string {
  const what = WHAT[e.kind];
  return e.item ? `${what.charAt(0).toUpperCase()}${what.slice(1)} bewerken` : `Nieuwe ${what}`;
}

function TreeList<T extends Category | Location>({
  nodes,
  onEdit,
  tone,
}: {
  nodes: (T & { depth: number })[];
  onEdit: (node: T) => void;
  tone?: (node: T) => Tone | null;
}) {
  return (
    <ul className="rows stagger">
      {nodes.map((n, i) => {
        const t = tone?.(n);
        return (
          <li key={n.id} style={stagger(i)}>
            <button type="button" className="row tree-row" style={{ "--depth": n.depth, minHeight: 46 } as CSSProperties} onClick={() => onEdit(n)}>
              <span className={`dot ${t ? `tone-${t}` : ""}`} style={t ? undefined : { width: 6, height: 6, margin: "0 1px" }} />
              <span className="row-main">
                <span className="row-title" style={{ fontSize: 14, fontWeight: n.depth === 0 ? 500 : 400 }}>
                  {n.name}
                </span>
              </span>
              <Icon name="next" size={16} className="row-chevron" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EditForm({ editing, taxonomy, onDone }: { editing: Editing; taxonomy: Taxonomy; onDone: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const item = editing.item;
  const [name, setName] = useState(item?.name ?? "");
  const [email, setEmail] = useState(editing.kind === "member" ? (editing.item?.email ?? "") : "");
  const [active, setActive] = useState(editing.kind === "member" ? (editing.item?.active ?? 1) === 1 : true);
  const [access, setAccess] = useState<Access>(editing.kind === "member" ? (editing.item?.access ?? "full") : "full");
  // Je eigen e-mailadres en toegang kan je niet aanpassen: anders sluit je jezelf buiten.
  const isMe = editing.kind === "member" && editing.item?.id === taxonomy.me.id;
  // Nieuw lid met de naam van iemand die al mee deelt (zonder e-mailadres): dat wordt die persoon.
  const twin = editing.kind === "member" && !item ? taxonomy.members.find((m) => !m.email && m.name.toLowerCase() === name.trim().toLowerCase()) : undefined;
  const [color, setColor] = useState<Tone | null>(item && "color" in item ? item.color : null);
  const [parentId, setParentId] = useState<string | null>(item && "parent_id" in item ? item.parent_id : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const base = { member: "/members", category: "/categories", location: "/locations", tag: "/tags" }[editing.kind];
  const tree =
    editing.kind === "category"
      ? flattenTree(taxonomy.categories.filter((c) => c.domain === editing.domain))
      : editing.kind === "location"
        ? flattenTree(taxonomy.locations)
        : [];
  // Iets kan niet onder zichzelf (of onder een eigen kind) hangen.
  const blocked = item && tree.length ? descendantIds(tree, item.id) : undefined;

  function body() {
    switch (editing.kind) {
      case "member":
        return { name, email, color, active: access === "full" && active, access };
      case "category":
        return { domain: editing.domain, name, color, parent_id: parentId };
      case "location":
        return { name, parent_id: parentId };
      case "tag":
        return { name, color };
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const saved = item ? await api.put<{ linked?: boolean }>(`${base}/${item.id}`, body()) : await api.post<{ linked?: boolean }>(base, body());
      await refreshTaxonomy();
      // Iemand met dezelfde naam had al kosten gedeeld: het nieuwe lid is die persoon.
      if (saved?.linked) toast(`Gekoppeld aan ${name}: alles wat al gedeeld werd, staat er meteen`);
      else toast(item ? "Bijgewerkt" : `${WHAT[editing.kind].charAt(0).toUpperCase()}${WHAT[editing.kind].slice(1)} toegevoegd`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!item) return;
    const consequence = {
      member: "Dat lukt enkel als dit lid nog geen uitgaven heeft.",
      category: "Wat erin zat, wordt 'zonder categorie'. Subcategorieën schuiven een niveau op.",
      location: "Dat lukt enkel als er niets meer ligt. Vakken eronder schuiven een niveau op.",
      tag: "De tag verdwijnt overal waar hij hangt.",
    }[editing.kind];
    const ok = await confirm({ title: `"${item.name}" verwijderen?`, body: consequence, confirmLabel: "Verwijderen", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`${base}/${item.id}`);
      await refreshTaxonomy();
      toast("Verwijderd", "trash");
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {editing.kind === "member" && (
        <>
          <label className="field">
            <span className="label">
              E-mailadres <span className="optional">· waarmee die aanmeldt</span>
            </span>
            <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optioneel" disabled={isMe} />
            {isMe && <span className="hint">Je eigen e-mailadres en toegang past een ander lid aan.</span>}
            {!isMe && twin && (
              <span className="hint">
                {twin.name} deelt al mee zonder aan te melden. Met een e-mailadres wordt het nieuwe lid die persoon: alles wat al gedeeld werd, staat er dan
                meteen.
              </span>
            )}
            {!isMe && editing.kind === "member" && editing.item && !editing.item.email && (
              <span className="hint">Met een e-mailadres kan die aanmelden en ziet die meteen wat al gedeeld werd.</span>
            )}
          </label>
          {!isMe && (
            <div className="field">
              <span className="label">Toegang</span>
              <Segmented
                label="Toegang"
                value={access}
                onChange={setAccess}
                options={(Object.keys(ACCESS_LEVELS) as Access[]).map((a) => ({ value: a, label: ACCESS_LEVELS[a].label }))}
              />
              <span className="hint">{ACCESS_LEVELS[access].hint}</span>
            </div>
          )}
          {access === "full" && <Switch checked={active} onChange={setActive} label="Woont hier" hint="Deelt mee in de uitgaven van het huishouden" />}
        </>
      )}

      {(editing.kind === "category" || editing.kind === "location") && (
        <label className="field">
          <span className="label">Onder</span>
          <TreeSelect nodes={tree} value={parentId} onChange={setParentId} empty="Bovenaan" disabled={blocked} />
        </label>
      )}

      {editing.kind !== "location" && !(editing.kind === "category" && parentId) && (
        <div className="field">
          <span className="label">Kleur</span>
          <ToneSwatches value={color} onChange={setColor} />
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        {item && (
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={remove}>
            <Icon name="trash" size={16} /> Verwijderen
          </button>
        )}
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

function defaultSplitText(t: Taxonomy): string {
  const split = t.household.default_split;
  if (!split || split.mode === "equal") return "Gelijk over wie hier woont";
  const unit = split.mode === "percent" ? "%" : "×";
  const parts = Object.entries(split.values).map(([id, v]) => `${memberById(t, id)?.name ?? "?"} ${String(v).replace(".", ",")}${unit}`);
  return `${SPLIT_LABELS[split.mode]}: ${parts.join(" · ")}`;
}

/** Naam van het huishouden en de gewone verdeling (bv. 60/40 naar inkomen). */
function HouseholdForm({ taxonomy, onDone }: { taxonomy: Taxonomy; onDone: () => void }) {
  const toast = useToast();
  const { reloadMe } = useSession();
  const people = activeMembers(taxonomy);
  const [name, setName] = useState(taxonomy.household.name);
  const [split, setSplit] = useState(() => defaultSplitDraft(taxonomy.household.default_split));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: FormEvent) {
    e.preventDefault();
    const built = buildDefaultSplit(split, people);
    if ("error" in built) return setError(built.error);
    setBusy(true);
    setError(undefined);
    try {
      await api.put("/household", { name, default_split: built.split });
      await refreshTaxonomy();
      reloadMe();
      toast("Huishouden bijgewerkt");
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label className="field">
        <span className="label">Naam</span>
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {people.length > 1 ? (
        <DefaultSplitField people={people} value={split} onChange={setSplit} />
      ) : (
        <p className="hint">Met twee of meer bewoners kies je hier hoe uitgaven gewoonlijk verdeeld worden.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <SubmitButton busy={busy}>Bewaren</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Op een gsm staan Projecten en Verkopers niet in de onderbalk en is er geen zijbalk om van huishouden te wisselen:
 * dat staat hier bovenaan.
 */
function PhoneMenu() {
  const { full, households, membership, switchHousehold } = useSession();
  const [creating, setCreating] = useState(false);
  const canCreate = households.some((h) => h.member.access === "full");
  const links = full
    ? [
        { to: "/projecten", icon: "project" as const, title: "Projecten", meta: "Verbouwing, reis, feest: apart bijgehouden" },
        { to: "/bezit", icon: "armchair" as const, title: "Bezit", meta: "Wat je hebt, met kosten, tips en logboek" },
        { to: "/verkopers", icon: "store" as const, title: "Verkopers", meta: "Winkels, webshops, vakmensen en hun gegevens" },
      ]
    : [];

  return (
    <div className="only-phone phone-menu">
      {links.length > 0 && (
        <nav className="card" aria-label="Meer">
          <ul className="rows">
            {links.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="row">
                  <span className="row-media">
                    <Icon name={l.icon} size={17} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{l.title}</span>
                    <span className="row-meta">
                      <span>{l.meta}</span>
                    </span>
                  </span>
                  <Icon name="next" size={16} className="row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {(households.length > 1 || canCreate) && (
        <section className="card">
          <CardHead icon="home" title="Huishoudens" />
          <ul className="rows">
            {households.map((h: HouseholdAccess) => (
              <li key={h.id}>
                <button type="button" className="row" onClick={() => h.id !== membership?.id && switchHousehold(h.id)} aria-current={h.id === membership?.id}>
                  <span className="row-media">
                    <Icon name="home" size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{h.name}</span>
                    <span className="row-meta">
                      <span>{h.member.access === "full" ? "alles" : "enkel projecten"}</span>
                    </span>
                  </span>
                  {h.id === membership?.id && <Icon name="check" size={16} className="workspace-check" />}
                </button>
              </li>
            ))}
            {canCreate && (
              <li>
                <button type="button" className="row" onClick={() => setCreating(true)}>
                  <span className="row-media">
                    <Icon name="plus" size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">Nieuw huishouden</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <Sheet open={creating} title="Nieuw huishouden" onClose={() => setCreating(false)}>
        {creating && <NewHousehold onDone={() => setCreating(false)} />}
      </Sheet>
    </div>
  );
}

/** Leden in twee groepen: wie hier woont, en de anderen (familie, vrienden, wie enkel mee deelt). */
function memberGroups(t: Taxonomy): { label: string; members: Member[] }[] {
  const home = t.members.filter((m) => m.active === 1 && m.access === "full");
  const others = t.members.filter((m) => !home.includes(m));
  return [{ label: "Woont hier", members: home }, ...(others.length > 0 ? [{ label: "Anderen · delen mee of zitten in een project", members: others }] : [])];
}
