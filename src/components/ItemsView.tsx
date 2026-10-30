import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  formatFieldValue,
  rangeStatus,
  type Attributes,
  type ChecklistEntry,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type Names,
} from "../../shared/fields";
import type { Item, ItemList, ItemTypeView, ProjectDetail } from "../../shared/types";
import { apiUrl, useApi } from "../api";
import { Link } from "../router";
import { FilterSelect, FilterToggle } from "./Controls";
import { namesFrom, ScoreStars } from "./Fields";
import { Icon, type IconName } from "./Icon";
import { SkeletonRows, stagger } from "./Motion";
import { EmptyState } from "./Page";
import { Sheet } from "./Sheet";
import { adjust, ReceiptToStock, RowStepper, StockScanner } from "./Stock";
import { useToast } from "./Toast";

/** Zoeken zonder op hoofdletters of accenten te letten ("creme" vindt "Crème"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Wat een waarde is als tekst (om op te zoeken en te filteren); bij meerdere waarden elk apart. */
function valueTexts(def: FieldDef, value: FieldValue | undefined, names: Names): string[] {
  if (value === undefined) return [];
  if (def.type === "multi" && Array.isArray(value)) return value as string[];
  if (def.type === "people" && Array.isArray(value)) return (value as string[]).map(names.person);
  if (def.type === "items" && Array.isArray(value)) return (value as string[]).map(names.item);
  if (def.type === "checklist" && Array.isArray(value)) return [formatFieldValue(def, value), ...(value as ChecklistEntry[]).map((e) => e.text)];
  return [formatFieldValue(def, value, names)];
}

const NUMERIC: FieldType[] = ["money", "number", "score", "year", "duration"];
/** Getallen staan rechts in een kolom (ook de uitkomst van een berekening). */
const isNumeric = (def: FieldDef) => NUMERIC.includes(def.type) || (def.type === "calc" && NUMERIC.includes(def.result!));
const isRange = (def: FieldDef) => def.type === "year_range" || def.type === "date_range";

/**
 * De items van één lijst in een project: zoeken, filters uit de velden (en tags), en een tabel met de velden die
 * als kolom staan. Een periode met filter wordt "nu" (bv. een wijn die nu drinkklaar is).
 */
export function ItemsView({ project, type }: { project: ProjectDetail; type: ItemTypeView }) {
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useApi<ItemList>(`/projects/${project.project.id}/items?type=${type.id}${archived ? "&archived=1" : ""}`);
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState<"scan" | "receipt">();
  async function step(id: string, delta: number) {
    try {
      const value = await adjust(id, counter!.key, delta);
      setCounts((c) => ({ ...c, [id]: value }));
    } catch (err) {
      toast((err as Error).message, "alert");
    }
  }
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [now, setNow] = useState<Record<string, boolean>>({});
  const [tag, setTag] = useState<string | null>(null);

  // Een voorraad: een getal met − en + dat je mag wijzigen, eventueel met een barcode om te scannen.
  const counter = type.fields.find((f) => f.type === "number" && f.counter && type.field_access[f.key] === "edit");
  const codeField = type.fields.find((f) => f.type === "code");
  const names = useMemo(() => namesFrom(data?.people ?? [], data?.refs ?? []), [data]);
  const fields = type.fields;
  // Het getal met − en + staat al rechts in de rij; dat hoeft geen kolom meer te zijn.
  const columns = fields.filter((f) => f.column && !(f === counter && !archived)).slice(0, 2);
  const filterFields = fields.filter((f) => f.filter && !isRange(f));
  const rangeFields = fields.filter((f) => f.filter && isRange(f));
  // Een logboek (een datum die met vandaag begint: eten, gewicht, uitgaven): het nieuwste eerst.
  const logDate = fields.find((f) => f.type === "date" && f.today);
  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (!logDate) return all;
    const day = (i: Item) => (typeof i.data[logDate.key] === "string" ? (i.data[logDate.key] as string) : "");
    return [...all].sort((a, b) => day(b).localeCompare(day(a)));
  }, [data, logDate]);
  const year = new Date().getFullYear();

  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const def of filterFields) {
      const values = new Set<string>();
      for (const item of items) valueTexts(def, item.data[def.key], names).forEach((v) => v && values.add(v));
      out[def.key] = [...values].sort((a, b) => (def.type === "year" ? b.localeCompare(a) : a.localeCompare(b, "nl", { numeric: true })));
    }
    return out;
  }, [items, filterFields, names]);
  const usedTags = project.tags.filter((t) => items.some((i) => i.tag_ids.includes(t.id)));

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return items.filter((item) => {
      for (const def of filterFields) {
        const want = filters[def.key];
        if (want && !valueTexts(def, item.data[def.key], names).includes(want)) return false;
      }
      for (const def of rangeFields) if (now[def.key] && rangeStatus(item.data[def.key], year) !== "now") return false;
      if (tag && !item.tag_ids.includes(tag)) return false;
      if (q) {
        const haystack = [
          item.name,
          ...fields.flatMap((f) => valueTexts(f, item.data[f.key], names)),
          ...project.tags.filter((t) => item.tag_ids.includes(t.id)).map((t) => t.name),
        ];
        if (!haystack.some((h) => h && fold(h).includes(q))) return false;
      }
      return true;
    });
  }, [items, query, filters, now, tag, fields, filterFields, rangeFields, names, project.tags, year]);

  const filtered = Boolean(query.trim() || tag || Object.values(filters).some(Boolean) || Object.values(now).some(Boolean));
  const cols = ["minmax(0, 1fr)", ...columns.map((c) => (isNumeric(c) ? "110px" : "minmax(0, 160px)")), ...(counter && !archived ? ["auto"] : [])].join(" ");
  const icon = (type.icon ?? "folder") as IconName;

  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder={`Zoek in ${type.plural.toLowerCase()}…`}
            aria-label={`Zoek in ${type.plural.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {counter && codeField && !archived && (
          <button type="button" className="btn btn-outline btn-icon" aria-label="Scannen" title="Scannen: bijtellen of aftrekken" onClick={() => setSheet("scan")}>
            <Icon name="scan" />
          </button>
        )}
        {counter && type.can_create && !project.project.archived && (
          <button type="button" className="btn btn-outline btn-icon" aria-label="Kasticket" title="Een kasticket bijtellen" onClick={() => setSheet("receipt")}>
            <Icon name="receipt" />
          </button>
        )}
        {type.can_create && !project.project.archived && (
          <Link
            to={`/projecten/${project.project.id}/importeren?lijst=${type.id}`}
            className="btn btn-outline btn-icon"
            aria-label={`Importeren in ${type.plural}`}
            title="Importeren uit een tabel"
          >
            <Icon name="table" />
          </Link>
        )}
        {items.length > 0 && (
          // Een bestand, geen ander scherm: een gewone link met `download`.
          <a
            href={apiUrl(`/projects/${project.project.id}/items/export?type=${type.id}${archived ? "&archived=1" : ""}`)}
            download
            className="btn btn-outline btn-icon"
            aria-label={`${type.plural} exporteren`}
            title="Exporteren als CSV (voor Excel)"
          >
            <Icon name="download" />
          </a>
        )}
      </div>

      <div className="filters">
        {rangeFields.map((def) => (
          <FilterToggle key={def.key} on={now[def.key] ?? false} onChange={(on) => setNow((n) => ({ ...n, [def.key]: on }))}>
            <Icon name="clock" size={14} /> {def.label}: nu
          </FilterToggle>
        ))}
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
        {usedTags.length > 0 && (
          <FilterSelect label="Tag" all="Alle" value={tag} onChange={setTag} options={usedTags.map((t) => ({ value: t.id, label: t.name }))} />
        )}
        <FilterToggle on={archived} onChange={setArchived}>
          <Icon name="archive" size={14} /> Archief
        </FilterToggle>
      </div>

      {error && <p className="error">{error}</p>}
      {!data && loading && <SkeletonRows rows={5} />}
      {data && shown.length === 0 && (
        <EmptyState
          icon={icon}
          title={filtered || archived ? "Niets gevonden" : `Nog geen ${type.plural.toLowerCase()}`}
          action={
            type.can_create &&
            !filtered &&
            !archived && (
              <Link to={`/projecten/${project.project.id}/nieuw?lijst=${type.id}`} className="btn btn-outline btn-sm">
                <Icon name="plus" size={16} /> {type.name} toevoegen
              </Link>
            )
          }
        >
          {filtered
            ? "Pas de zoekterm of filters aan."
            : archived
              ? "Wat je archiveert, komt hier."
              : type.can_create
                ? "Voeg er een toe, of importeer ze uit een tabel."
                : undefined}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <div className="card table table-items" style={{ "--cols": cols } as CSSProperties}>
          <div className="table-head" aria-hidden="true">
            <span>{type.name_label ?? type.name}</span>
            {columns.map((c, k) => (
              <span key={c.key} className={isNumeric(c) || (k === columns.length - 1 && !counter) ? "end" : undefined}>
                {c.label}
              </span>
            ))}
            {counter && !archived && <span className="end">{counter.label}</span>}
          </div>
          <ul className="rows stagger">
            {shown.map((item, i) => (
              <li key={item.id} style={stagger(i)}>
                <ItemRow
                  item={item}
                  icon={icon}
                  tone={project.project.color ?? "sky"}
                  columns={columns}
                  names={names}
                  tags={project.tags.filter((t) => item.tag_ids.includes(t.id)).map((t) => t.name)}
                  stepper={
                    counter && !archived ? (
                      <RowStepper
                        value={counts[item.id] ?? (typeof item.data[counter.key] === "number" ? (item.data[counter.key] as number) : 0)}
                        label={item.name}
                        onStep={(d) => step(item.id, d)}
                      />
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {counter && (
        <>
          <Sheet open={sheet === "scan"} title="Scannen" onClose={() => setSheet(undefined)}>
            {sheet === "scan" && codeField && (
              <StockScanner
                items={items}
                code={codeField}
                counter={counter}
                onChanged={(id, value) => setCounts((c) => ({ ...c, [id]: value }))}
                onClose={() => setSheet(undefined)}
              />
            )}
          </Sheet>
          <Sheet open={sheet === "receipt"} title="Kasticket bijtellen" onClose={() => setSheet(undefined)}>
            {sheet === "receipt" && (
              <ReceiptToStock
                projectId={project.project.id}
                typeId={type.id}
                counter={counter}
                onDone={() => {
                  setSheet(undefined);
                  setCounts({});
                  reload();
                }}
              />
            )}
          </Sheet>
        </>
      )}
    </>
  );
}

function ItemRow({
  item,
  icon,
  tone,
  columns,
  names,
  tags,
  stepper,
}: {
  item: { id: string; name: string; data: Attributes; photo_version: number | null };
  icon: IconName;
  tone: string;
  columns: FieldDef[];
  names: Names;
  tags: string[];
  /** Een voorraad: − en + rechts; de rij is dan geen link, enkel het deel met de naam. */
  stepper?: ReactNode;
}) {
  const meta = [...columns.map((c) => formatFieldValue(c, item.data[c.key], names)), ...tags].filter(Boolean).join(" · ");
  const main = (
    <>
      {item.photo_version ? (
        <span className="row-media">
          <img src={apiUrl(`/items/${item.id}/photo?v=${item.photo_version}`)} alt="" loading="lazy" />
        </span>
      ) : (
        <span className={`row-media tone-${tone}`}>
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="row-main">
        <span className="row-title">{item.name}</span>
        {meta && (
          <span className="row-meta narrow-only">
            <span>{meta}</span>
          </span>
        )}
        {tags.length > 0 && (
          <span className="row-meta wide-only">
            <span>{tags.join(" · ")}</span>
          </span>
        )}
      </span>
    </>
  );
  const values = (
    <>
      {columns.map((c) => {
        const v = item.data[c.key];
        const end = isNumeric(c) ? "col col-end" : "col";
        return (
          <span key={c.key} className={end}>
            {v === undefined ? (
              <span className="muted">—</span>
            ) : c.type === "score" || (c.type === "calc" && c.result === "score") ? (
              <ScoreStars value={v as number} />
            ) : (
              <span>{formatFieldValue(c, v, names)}</span>
            )}
          </span>
        );
      })}
    </>
  );
  if (!stepper)
    return (
      <Link to={`/items/${item.id}`} className="row">
        <span className="cell-main">{main}</span>
        {values}
      </Link>
    );
  return (
    <div className="row">
      <Link to={`/items/${item.id}`} className="row-link">
        {main}
      </Link>
      {values}
      {stepper}
    </div>
  );
}
