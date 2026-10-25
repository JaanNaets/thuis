import { useMemo, useState, type CSSProperties } from "react";
import {
  drinkStatus,
  fieldWithRole,
  formatFieldValue,
  itemValue,
  ownersText,
  templateOf,
  valueByOwner,
  type FieldDef,
  type FieldValue,
} from "../../shared/fields";
import { UNITS, type ItemDetail, type ItemListItem, type ProjectDetail, type Taxonomy } from "../../shared/types";
import { api, apiUrl, type useApi } from "../api";
import { CardHead, FilterSelect, FilterToggle } from "../components/Controls";
import { Icon } from "../components/Icon";
import { itemPath } from "../components/ItemLinks";
import { Num, SkeletonRows, stagger, useCountUp } from "../components/Motion";
import { EmptyState } from "../components/Page";
import { ScoreStars } from "../components/ProjectFields";
import { formatCents, formatNumber } from "../format";
import { Link } from "../router";
import { memberById } from "../taxonomy";
import { fold, unitWord } from "./InventoryList";

/** Waar een wijn staat in zijn drinkvenster, als badge. */
const DRINK_BADGE = {
  ready: { label: "Drinkklaar", className: "badge-success" },
  young: { label: "Nog wachten", className: "" },
  past: { label: "Over zijn best", className: "badge-warning" },
} as const;

/** Zoekbare tekst van een waarde. */
function valueText(def: FieldDef, value: FieldValue | undefined): string[] {
  if (value === undefined) return [];
  if (def.type === "multi" && Array.isArray(value)) return value as string[];
  if (def.type === "bool") return [value ? "Ja" : "Nee"];
  return [formatFieldValue(def, value)];
}

export type ItemsState = ReturnType<typeof useApi<ItemListItem[]>>;

/**
 * De dingen van een project (de wijnkelder, de fietsen): zoeken, filters uit de velden, "nu drinkklaar",
 * van wie, en een tabel met de velden als kolommen. Bij iets dat opraakt: − om er eentje te gebruiken.
 */
export function ProjectItems({ project, taxonomy, state, canEdit }: { project: ProjectDetail; taxonomy: Taxonomy; state: ItemsState; canEdit: boolean }) {
  const { data, error, loading, mutate, reload } = state;
  const fields = project.fields;
  const template = templateOf(project.template);
  const consumable = project.item_type === "consumable";
  const drink = fieldWithRole(fields, "drink_window");
  // Naast de zijkolom is er plaats voor de naam, twee velden en het aantal.
  const columns = fields.filter((f) => f.column).slice(0, 2);
  const filterFields = fields.filter((f) => f.filter);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [owner, setOwner] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const newItem = `/projecten/${project.id}/${consumable ? "voorraad" : "bezit"}/nieuw`;
  const year = new Date().getFullYear();

  // Wat in de lijst kan: bij wijn enkel wat er nog is (tenzij je ook wat op is wil zien).
  const items = useMemo(() => (data ?? []).filter((i) => !consumable || showEmpty || i.quantity > 0), [data, consumable, showEmpty]);

  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const def of filterFields) {
      const values = new Set<string>();
      for (const item of items) valueText(def, item.attributes[def.key]).forEach((v) => values.add(v));
      out[def.key] = [...values].sort((a, b) => (def.type === "year" ? b.localeCompare(a) : a.localeCompare(b, "nl")));
    }
    return out;
  }, [items, filterFields]);

  const owners = useMemo(() => {
    const ids = new Set(items.flatMap((i) => i.owners.map((o) => o.member_id)));
    return [...ids].map((id) => memberById(taxonomy, id)).filter((m) => m !== undefined);
  }, [items, taxonomy]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return items.filter((item) => {
      for (const def of filterFields) {
        const want = filters[def.key];
        if (want && !valueText(def, item.attributes[def.key]).includes(want)) return false;
      }
      if (owner === "together" && item.owners.length > 0) return false;
      if (owner && owner !== "together" && !item.owners.some((o) => o.member_id === owner)) return false;
      if (ready && drink && drinkStatus(item.attributes[drink.key], year) !== "ready") return false;
      if (q) {
        const haystack = [item.name, item.brand, item.notes, ...fields.flatMap((f) => valueText(f, item.attributes[f.key]))];
        if (!haystack.some((h) => h && fold(h).includes(q))) return false;
      }
      return true;
    });
  }, [items, query, filters, owner, ready, drink, fields, filterFields, year]);

  const filtered = Boolean(query.trim() || owner || ready || Object.values(filters).some(Boolean));
  const name = (id: string) => memberById(taxonomy, id)?.name ?? "?";

  async function consumeOne(item: ItemListItem) {
    setActionError(undefined);
    mutate((list) => list?.map((i) => (i.id === item.id ? { ...i, quantity: Math.max(0, i.quantity - 1) } : i)));
    try {
      const {
        movements: _m,
        links: _l,
        log: _g,
        parent: _p,
        children: _c,
        can_edit: _e,
        ...updated
      } = await api.post<ItemDetail>(`/items/${item.id}/stock`, {
        action: "consume",
        quantity: 1,
      });
      mutate((list) => list?.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setActionError((err as Error).message);
      reload();
    }
  }

  // De tabel: naam, de velden die als kolom staan, van wie, en het aantal of de waarde.
  const width = (c: FieldDef) => (c.type === "text" || c.type === "multi" ? "minmax(0, 140px)" : c.type === "score" ? "100px" : "88px");
  const cols = ["minmax(0, 1fr)", ...columns.map(width), consumable ? "150px" : "110px"].join(" ");

  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder={`Zoek in ${template.plural_label.toLowerCase()}…`}
            aria-label={`Zoek op naam, ${template.brand_label.toLowerCase()} of een veld`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="filters">
        {drink && (
          <FilterToggle on={ready} onChange={setReady}>
            <Icon name="wine" size={14} /> Nu drinkklaar
          </FilterToggle>
        )}
        {filterFields
          .filter((def) => options[def.key]?.length)
          .map((def) => (
            <FilterSelect
              key={def.key}
              label={def.label}
              all="Alle"
              value={filters[def.key] ?? null}
              onChange={(v) => setFilters((f) => ({ ...f, [def.key]: v }))}
              options={options[def.key].map((v) => ({ value: v, label: v }))}
            />
          ))}
        {owners.length > 0 && (
          <FilterSelect
            label="Eigenaar"
            all="Iedereen"
            value={owner}
            onChange={setOwner}
            options={[...owners.map((m) => ({ value: m.id, label: m.name })), { value: "together", label: "Samen" }]}
          />
        )}
        <FilterToggle on={showEmpty} onChange={setShowEmpty}>
          {consumable ? "Ook wat op is" : "Ook wat weg is"}
        </FilterToggle>
      </div>

      {(error || actionError) && <p className="error">{error ?? actionError}</p>}
      {!data && loading && <SkeletonRows rows={6} />}
      {data && shown.length === 0 && (
        <EmptyState
          icon={template.icon}
          title={filtered || items.length < (data?.length ?? 0) ? "Niets gevonden" : `Nog geen ${template.plural_label.toLowerCase()}`}
          action={
            canEdit &&
            !filtered && (
              <Link to={newItem} className="btn btn-outline btn-sm">
                <Icon name="camera" size={16} /> {template.name_label !== "Naam" ? `${template.name_label} toevoegen` : "Iets toevoegen"}
              </Link>
            )
          }
        >
          {filtered
            ? "Pas de filters aan."
            : canEdit
              ? "Trek een foto van het etiket, importeer je lijst (Google Sheet, Excel) of zet een factuur om."
              : "Hier komt wat (mee) van jou is."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <div className="card table table-collection" style={{ "--cols": cols } as CSSProperties}>
          <div className="table-head" aria-hidden="true">
            <span>{template.name_label !== "Naam" ? template.name_label : "Naam"}</span>
            {columns.map((c) => (
              <span key={c.key}>{c.label}</span>
            ))}
            <span className="end">{consumable ? "Aantal" : "Waarde"}</span>
          </div>
          <ul className="rows stagger">
            {shown.map((item, i) => {
              const status = drink ? drinkStatus(item.attributes[drink.key], year) : null;
              const meta = [item.brand, ...columns.map((c) => formatFieldValue(c, item.attributes[c.key]))].filter(Boolean).join(" · ");
              return (
                <li key={item.id} style={stagger(i)}>
                  <div className={`row ${consumable && item.quantity === 0 ? "empty-stock" : ""}`}>
                    <Link to={itemPath(item)} className="row-link">
                      {item.photo_version ? (
                        <span className="row-media">
                          <img src={apiUrl(`/items/${item.id}/photo?v=${item.photo_version}`)} alt="" loading="lazy" />
                        </span>
                      ) : (
                        <span className={`row-media tone-${project.color ?? "sky"}`}>
                          <Icon name={template.icon} size={16} />
                        </span>
                      )}
                      <span className="row-main">
                        <span className="row-title">{item.name}</span>
                        <span className="row-meta">
                          {meta && <span className="narrow-only">{meta}</span>}
                          {item.brand && <span className="wide-only">{item.brand}</span>}
                          {status && <span className={`badge ${DRINK_BADGE[status].className}`}>{DRINK_BADGE[status].label}</span>}
                          {item.owners.length > 0 && <span>{ownersText(item.owners, name)}</span>}
                        </span>
                      </span>
                    </Link>
                    {columns.map((c) => {
                      const v = item.attributes[c.key];
                      return (
                        <span key={c.key} className="col">
                          {v === undefined ? (
                            <span className="muted">—</span>
                          ) : c.type === "score" ? (
                            <ScoreStars value={v as number} />
                          ) : (
                            <span>{formatFieldValue(c, v)}</span>
                          )}
                        </span>
                      );
                    })}
                    {consumable ? (
                      <div className="stepper col-end">
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={item.quantity <= 0}
                            onClick={() => consumeOne(item)}
                            aria-label={`Eén ${item.unit} ${item.name} ${project.template === "wine" ? "gedronken" : "gebruikt"}`}
                          >
                            <Icon name="minus" size={16} />
                          </button>
                        )}
                        <span className="stepper-value">
                          <strong>
                            <Num value={item.quantity}>{formatNumber(item.quantity)}</Num>
                          </strong>
                          <small>{unitWord(item.quantity, item.unit)}</small>
                        </span>
                      </div>
                    ) : (
                      <span className="row-end">{itemValue(item, fields) ? formatCents(itemValue(item, fields)) : <span className="muted">—</span>}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * In de zijkolom: hoeveel er is, wat het waard is en van wie. De waarde komt van de prijs per eenheid
 * (wijn) of de waarde van elk ding (fietsen).
 */
export function CollectionSummary({ project, taxonomy, items }: { project: ProjectDetail; taxonomy: Taxonomy; items: ItemListItem[] | undefined }) {
  const template = templateOf(project.template);
  const consumable = project.item_type === "consumable";
  const present = (items ?? []).filter((i) => (consumable ? i.quantity > 0 : i.archived === 0));
  const total = present.reduce((sum, i) => sum + itemValue(i, project.fields), 0);
  const count = consumable ? present.reduce((sum, i) => sum + i.quantity, 0) : present.length;
  const amount = useCountUp(total);
  const perOwner = valueByOwner(present, project.fields);
  const unit = project.item_unit ?? "stuk";
  const drink = fieldWithRole(project.fields, "drink_window");
  const ready = drink ? present.filter((i) => drinkStatus(i.attributes[drink.key]) === "ready").reduce((sum, i) => sum + i.quantity, 0) : 0;

  return (
    <section className="card">
      <div className="purchase-summary">
        <span className="amount-big">{total ? formatCents(amount) : formatNumber(count)}</span>
        <span className="muted">
          {total
            ? `waarde van ${formatNumber(count)} ${consumable ? (count === 1 ? unit : UNITS[unit]) : template.plural_label.toLowerCase()}`
            : consumable
              ? `${count === 1 ? unit : UNITS[unit]} in de kelder`
              : template.plural_label.toLowerCase()}
        </span>
      </div>
      <dl className="dl">
        {consumable && (
          <div>
            <dt>{template.plural_label}</dt>
            <dd>{present.length}</dd>
          </div>
        )}
        {drink && (
          <div>
            <dt>Nu drinkklaar</dt>
            <dd>
              {formatNumber(ready)} {ready === 1 ? unit : UNITS[unit]}
            </dd>
          </div>
        )}
        {total > 0 &&
          perOwner.map((o) => (
            <div key={o.member_id || "together"}>
              <dt>{o.member_id ? (memberById(taxonomy, o.member_id)?.name ?? "?") : "Samen"}</dt>
              <dd>{formatCents(o.cents)}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

/** Kop boven de dingen als er ook uitgaven zijn: een kleine uitleg wat je hier doet. */
export function CollectionActions({ project }: { project: ProjectDetail }) {
  return (
    <section className="card aside-late">
      <CardHead icon="sparkles" title="Snel invullen" description="Van een lijst, een factuur of een foto van het etiket" />
      <div className="card-body btn-row">
        <Link to={`/projecten/${project.id}/importeren`} className="btn btn-outline btn-sm">
          <Icon name="table" size={15} /> Lijst importeren
        </Link>
        <Link to={`/projecten/${project.id}/factuur`} className="btn btn-outline btn-sm">
          <Icon name="receipt" size={15} /> Uit factuur
        </Link>
      </div>
    </section>
  );
}
