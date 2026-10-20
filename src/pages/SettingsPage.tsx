import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Link } from "../router";
import { descendantIds, flattenTree } from "../../shared/tree";
import type { Category, CategoryDomain, Location, Member, Tag, Taxonomy, Tone, Vendor } from "../../shared/types";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, CardHead, Segmented, SubmitButton, Switch, Tabs, ToneSwatches, TreeSelect } from "../components/Controls";
import { Icon, type IconName } from "../components/Icon";
import { stagger } from "../components/Motion";
import { PageHead, toneForCategory } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { isKiosk } from "../device";
import { refreshTaxonomy, useTaxonomy } from "../taxonomy";

/** Wat er in een venster bewerkt wordt; zonder item = iets nieuws. */
type Editing =
  | { kind: "member"; item?: Member }
  | { kind: "category"; domain: CategoryDomain; item?: Category }
  | { kind: "location"; item?: Location }
  | { kind: "tag"; item?: Tag }
  | { kind: "vendor"; item?: Vendor };

const WHAT = { member: "lid", category: "categorie", location: "plaats", tag: "tag", vendor: "verkoper" } as const;

type Section = "household" | "vendors" | "categories" | "locations" | "tags" | "device";

/** De tab staat in het adres (/meer?tab=plaatsen), zodat je er vanuit de zijbalk naartoe kan. */
const SLUGS: Record<Section, string> = {
  household: "huishouden",
  vendors: "verkopers",
  categories: "categorieen",
  locations: "plaatsen",
  tags: "tags",
  device: "toestel",
};

export function SettingsPage() {
  const { data: taxonomy, error } = useTaxonomy();
  const [editing, setEditing] = useState<Editing>();
  const [domain, setDomain] = useState<CategoryDomain>("item");
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (Object.keys(SLUGS) as Section[]).find((k) => SLUGS[k] === searchParams.get("tab")) ?? "household";
  const setSection = (next: Section) => setSearchParams({ tab: SLUGS[next] }, { replace: true });

  return (
    <div className="page">
      <PageHead title="Instellingen" description="Wie er in huis woont en hoe alles ingedeeld is" />
      {error && <p className="error">{error}</p>}

      {taxonomy && (
        <Tabs
          label="Instellingen"
          value={section}
          onChange={setSection}
          tabs={[
            { value: "household", label: "Huishouden", count: taxonomy.members.length },
            { value: "vendors", label: "Verkopers", count: taxonomy.vendors.length },
            { value: "categories", label: "Categorieën" },
            { value: "locations", label: "Plaatsen", count: taxonomy.locations.length },
            { value: "tags", label: "Tags", count: taxonomy.tags.length },
            { value: "device", label: "Dit toestel" },
          ]}
        />
      )}

      {taxonomy && (
        <div className="settings-grid" key={section}>
          <Card
            show={section === "household"}
            icon="users"
            title="Huishouden"
            desc="Wie zich aanmeldt, komt hier vanzelf bij"
            onAdd={() => setEditing({ kind: "member" })}
            addLabel="Lid"
          >
            <ul className="rows stagger">
              {taxonomy.members.map((m, i) => (
                <li key={m.id} style={stagger(i)}>
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
                    {m.active === 0 && <span className="badge badge-secondary">inactief</span>}
                    <Icon name="next" size={16} className="row-chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            show={section === "vendors"}
            icon="store"
            title="Verkopers"
            desc="Winkels, webshops en mensen waar je iets kocht"
            onAdd={() => setEditing({ kind: "vendor" })}
            addLabel="Verkoper"
          >
            {taxonomy.vendors.length === 0 ? (
              <p className="card-body hint">Verkopers verschijnen hier vanzelf zodra je ze bij een aankoop invult.</p>
            ) : (
              <ul className="rows stagger">
                {taxonomy.vendors.map((v, i) => (
                  <li key={v.id} style={stagger(i)}>
                    <button type="button" className="row" onClick={() => setEditing({ kind: "vendor", item: v })}>
                      <span className="row-media">
                        <Icon name="store" size={16} />
                      </span>
                      <span className="row-main">
                        <span className="row-title">{v.name}</span>
                        {(v.website || v.phone || v.notes) && (
                          <span className="row-meta">
                            <span>{[v.website?.replace(/^https?:\/\/(www\.)?/, ""), v.phone, v.notes].filter(Boolean).join(" · ")}</span>
                          </span>
                        )}
                      </span>
                      {v.usage > 0 && <span className="badge badge-secondary">{v.usage}×</span>}
                      <Icon name="next" size={16} className="row-chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
  const [color, setColor] = useState<Tone | null>(item && "color" in item ? item.color : null);
  const [parentId, setParentId] = useState<string | null>(item && "parent_id" in item ? item.parent_id : null);
  const [website, setWebsite] = useState(editing.kind === "vendor" ? (editing.item?.website ?? "") : "");
  const [phone, setPhone] = useState(editing.kind === "vendor" ? (editing.item?.phone ?? "") : "");
  const [notes, setNotes] = useState(editing.kind === "vendor" ? (editing.item?.notes ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const base = { member: "/members", category: "/categories", location: "/locations", tag: "/tags", vendor: "/vendors" }[editing.kind];
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
        return { name, email, color, active };
      case "category":
        return { domain: editing.domain, name, color, parent_id: parentId };
      case "location":
        return { name, parent_id: parentId };
      case "tag":
        return { name, color };
      case "vendor":
        return { name, website: normalizeUrl(website), phone, notes };
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (item) await api.put(`${base}/${item.id}`, body());
      else await api.post(base, body());
      await refreshTaxonomy();
      toast(item ? "Bijgewerkt" : `${WHAT[editing.kind].charAt(0).toUpperCase()}${WHAT[editing.kind].slice(1)} toegevoegd`);
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
      vendor: "Aankopen en voorraad van deze verkoper blijven bestaan, zonder verkoper.",
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
        <input required maxLength={editing.kind === "vendor" ? 100 : 60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {editing.kind === "member" && (
        <>
          <label className="field">
            <span className="label">
              E-mailadres <span className="optional">· waarmee die aanmeldt</span>
            </span>
            <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optioneel" />
          </label>
          <Switch checked={active} onChange={setActive} label="Woont hier" hint="Deelt mee in gelijk verdeelde uitgaven" />
        </>
      )}

      {editing.kind === "vendor" && (
        <>
          <div className="field-row">
            <label className="field">
              <span className="label">Website</span>
              <input inputMode="url" maxLength={200} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="coolblue.be" />
            </label>
            <label className="field">
              <span className="label">Telefoon</span>
              <input type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="label">
              <Icon name="note" size={15} /> Notitie
            </span>
            <textarea
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Klantnummer, contactpersoon, openingsuren…"
            />
          </label>
          {editing.item && editing.item.usage > 0 && (
            <Link to={`/aankopen?verkoper=${editing.item.id}`} className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={onDone}>
              <Icon name="receipt" size={15} /> {editing.item.usage} aankoop{editing.item.usage === 1 ? "" : "en"} bekijken
            </Link>
          )}
        </>
      )}

      {(editing.kind === "category" || editing.kind === "location") && (
        <label className="field">
          <span className="label">Onder</span>
          <TreeSelect nodes={tree} value={parentId} onChange={setParentId} empty="Bovenaan" disabled={blocked} />
        </label>
      )}

      {editing.kind !== "location" && editing.kind !== "vendor" && !(editing.kind === "category" && parentId) && (
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

/** "coolblue.be" → "https://coolblue.be", zodat de link werkt. */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
