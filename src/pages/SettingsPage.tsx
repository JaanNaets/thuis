import { useState, type FormEvent } from "react";
import { descendantIds, flattenTree } from "../../shared/tree";
import type { Category, CategoryDomain, Location, Member, Tag, Taxonomy, Tone } from "../../shared/types";
import { api } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { Avatar, Segmented, ToneSwatches, TreeSelect } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHero, toneForCategory } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { isKiosk } from "../device";
import { refreshTaxonomy, useTaxonomy } from "../taxonomy";

/** Wat er in een venster bewerkt wordt; zonder id = iets nieuws. */
type Editing =
  | { kind: "member"; item?: Member }
  | { kind: "category"; domain: CategoryDomain; item?: Category }
  | { kind: "location"; item?: Location }
  | { kind: "tag"; item?: Tag };

export function SettingsPage() {
  const { data: taxonomy, error } = useTaxonomy();
  const [editing, setEditing] = useState<Editing>();
  const [domain, setDomain] = useState<CategoryDomain>("item");

  return (
    <div className="page">
      <PageHero title="Meer" tone="butter" summary="Wie er in huis woont en hoe alles ingedeeld is" />
      {error && <p className="error">{error}</p>}

      {taxonomy && (
        <div className="settings-grid">
          <section className="settings-card">
            <header>
              <h2>
                <Icon name="users" /> Huishouden
              </h2>
              <button type="button" className="button small-button" onClick={() => setEditing({ kind: "member" })}>
                <Icon name="plus" size={18} /> Lid
              </button>
            </header>
            <ul className="settings-list">
              {taxonomy.members.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => setEditing({ kind: "member", item: m })}>
                    <Avatar member={m} />
                    <span className="settings-main">
                      <strong>
                        {m.name}
                        {m.id === taxonomy.me.id && <span className="muted"> (jij)</span>}
                      </strong>
                      <small>{m.email ?? "meldt niet aan"}</small>
                    </span>
                    {m.active === 0 && <span className="badge expired">inactief</span>}
                    <Icon name="next" size={18} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Wie zich aanmeldt, komt hier vanzelf bij. Voeg je partner gerust al toe met het e-mailadres waarmee die later
              aanmeldt.
            </p>
          </section>

          <section className="settings-card">
            <header>
              <h2>
                <Icon name="folder" /> Categorieën
              </h2>
              <button type="button" className="button small-button" onClick={() => setEditing({ kind: "category", domain })}>
                <Icon name="plus" size={18} /> Categorie
              </button>
            </header>
            <Segmented
              label="Soort categorieën"
              value={domain}
              onChange={setDomain}
              options={[
                { value: "item", label: "Voorraad" },
                { value: "expense", label: "Aankopen" },
              ]}
            />
            <TreeList
              nodes={flattenTree(taxonomy.categories.filter((c) => c.domain === domain))}
              tone={(c) => c.color ?? (c.parent_id ? null : toneForCategory(c.name))}
              onEdit={(c) => setEditing({ kind: "category", domain, item: c })}
            />
          </section>

          <section className="settings-card">
            <header>
              <h2>
                <Icon name="pin" /> Plaatsen
              </h2>
              <button type="button" className="button small-button" onClick={() => setEditing({ kind: "location" })}>
                <Icon name="plus" size={18} /> Plaats
              </button>
            </header>
            <TreeList nodes={flattenTree(taxonomy.locations)} onEdit={(l) => setEditing({ kind: "location", item: l })} />
          </section>

          <section className="settings-card">
            <header>
              <h2>
                <Icon name="tag" /> Tags
              </h2>
              <button type="button" className="button small-button" onClick={() => setEditing({ kind: "tag" })}>
                <Icon name="plus" size={18} /> Tag
              </button>
            </header>
            {taxonomy.tags.length === 0 ? (
              <p className="muted small">
                Tags zijn vrije labels over alles heen, bv. "Vakantie Italië", "Verbouwing" of "Baby".
              </p>
            ) : (
              <div className="tag-picker">
                {taxonomy.tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`tag-chip on tone-${t.color ?? "butter"}`}
                    onClick={() => setEditing({ kind: "tag", item: t })}
                  >
                    {t.name}
                    <span className="tag-usage">{t.usage}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="settings-card">
            <header>
              <h2>
                <Icon name="tablet" /> Dit toestel
              </h2>
            </header>
            <p className="muted small">
              Kioskmodus is voor de tablet in de keuken: na 5 minuten keert de app terug naar het begin en ververst ze.
            </p>
            <button type="button" className="button" onClick={() => (location.href = isKiosk ? "/?kiosk=0" : "/?kiosk=1")}>
              {isKiosk ? "Kioskmodus uitzetten" : "Kioskmodus aanzetten"}
            </button>
          </section>
        </div>
      )}

      <Sheet open={Boolean(editing)} title={editing ? sheetTitle(editing) : ""} onClose={() => setEditing(undefined)}>
        {editing && taxonomy && <EditForm editing={editing} taxonomy={taxonomy} onDone={() => setEditing(undefined)} />}
      </Sheet>
    </div>
  );
}

function sheetTitle(e: Editing): string {
  const what = { member: "lid", category: "categorie", location: "plaats", tag: "tag" }[e.kind];
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
    <ul className="settings-list tree">
      {nodes.map((n) => {
        const t = tone?.(n);
        return (
          <li key={n.id} style={{ paddingLeft: `${n.depth * 22}px` }}>
            <button type="button" onClick={() => onEdit(n)}>
              {t ? <span className={`dot tone-${t}`} /> : <span className="dot plain" />}
              <span className="settings-main">
                <strong>{n.name}</strong>
              </span>
              <Icon name="next" size={18} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EditForm({ editing, taxonomy, onDone }: { editing: Editing; taxonomy: Taxonomy; onDone: () => void }) {
  const confirm = useConfirm();
  const item = editing.item;
  const [name, setName] = useState(item?.name ?? "");
  const [email, setEmail] = useState(editing.kind === "member" ? (editing.item?.email ?? "") : "");
  const [active, setActive] = useState(editing.kind === "member" ? (editing.item?.active ?? 1) === 1 : true);
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
        return { name, email, color, active };
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
      if (item) await api.put(`${base}/${item.id}`, body());
      else await api.post(base, body());
      await refreshTaxonomy();
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
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label className="field">
        <span className="label">Naam *</span>
        <input required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {editing.kind === "member" && (
        <>
          <label className="field">
            <span className="label">E-mailadres waarmee die aanmeldt</span>
            <input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optioneel" />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Woont hier (deelt mee in uitgaven)</span>
          </label>
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
          <button type="button" className="button quiet danger-text" disabled={busy} onClick={remove}>
            <Icon name="trash" /> Verwijderen
          </button>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Opslaan…" : "Opslaan"}
        </button>
      </div>
    </form>
  );
}
