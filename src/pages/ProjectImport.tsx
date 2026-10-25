import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { formatFieldValue, guessMapping, importRows, parseSheet, templateOf, type ColumnTarget, type Sheet } from "../../shared/fields";
import { UNITS, type ItemImportResult, type Project, type Taxonomy } from "../../shared/types";
import { api } from "../api";
import { Alert, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { buildOwners, OwnersField, ownersDraft } from "../components/ProjectFields";
import { useToast } from "../components/Toast";
import { formatNumber } from "../format";
import { useNavigate } from "../router";
import { useSession } from "../session";
import { activeMembers, projectMembers, refreshTaxonomy, useTaxonomy } from "../taxonomy";

export function ProjectImport() {
  const { projectId } = useParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  const project = taxonomy.projects.find((p) => p.id === projectId);
  if (!project) return <p className="error page">Dit project bestaat niet (meer).</p>;
  return <ImportForm project={project} taxonomy={taxonomy} />;
}

/** De kolommen die je koos, per project bewaard (in dit toestel): een volgende lijst van dezelfde sheet gaat vanzelf. */
const mappingKey = (projectId: string) => `thuis:import:${projectId}`;

function rememberedMapping(projectId: string): Record<string, ColumnTarget> {
  try {
    return JSON.parse(localStorage.getItem(mappingKey(projectId)) ?? "{}") as Record<string, ColumnTarget>;
  } catch {
    return {};
  }
}

/** Een CSV uit Excel in België is vaak Windows-1252: als UTF-8 niet lukt, dan dat. */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
}

function ImportForm({ project, taxonomy }: { project: Project; taxonomy: Taxonomy }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { full } = useSession();
  const template = templateOf(project.template);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [sheet, setSheet] = useState<Sheet>();
  const [fileName, setFileName] = useState<string>();
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const people = [...activeMembers(taxonomy), ...projectMembers(taxonomy, project.id)].filter((m, i, list) => list.findIndex((x) => x.id === m.id) === i);
  const [owners, setOwners] = useState(() => ownersDraft([]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ItemImportResult>();

  // Waar een kolom heen kan: de basis (naam, merk, aantal, plaats, notitie) en de velden van het project.
  const targets: { value: ColumnTarget; label: string }[] = [
    { value: "", label: "Niet gebruiken" },
    { value: "name", label: template.name_label !== "Naam" ? `Naam (${template.name_label.toLowerCase()})` : "Naam" },
    { value: "brand", label: template.brand_label },
    { value: "quantity", label: project.item_type === "consumable" ? "Aantal" : "Aantal (wordt 1 per ding)" },
    ...(full ? [{ value: "location" as const, label: "Plaats" }] : []),
    { value: "notes", label: "Bij de notitie" },
    ...project.fields.map((f) => ({ value: `field:${f.key}` as ColumnTarget, label: f.label })),
  ];

  function load(text: string, name?: string) {
    const parsed = parseSheet(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Er staan geen rijen in. De eerste rij moet de namen van de kolommen bevatten.");
      return;
    }
    const remembered = rememberedMapping(project.id);
    const guessed = guessMapping(parsed.headers, project.fields);
    setMapping(
      parsed.headers.map((h, i) => {
        const r = remembered[h.toLowerCase()];
        return r !== undefined && targets.some((t) => t.value === r) ? r : guessed[i];
      }),
    );
    setSheet(parsed);
    setFileName(name);
    setError(undefined);
    setResult(undefined);
  }

  const converted = useMemo(() => (sheet ? importRows(sheet, mapping, project.fields) : undefined), [sheet, mapping, project.fields]);
  const named = converted?.rows.filter((r) => r.name.trim()) ?? [];
  const hasName = mapping.includes("name");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sheet || !converted) return;
    if (!hasName) return setError("Kies welke kolom de naam is.");
    const builtOwners = buildOwners(owners);
    if ("error" in builtOwners) return setError(builtOwners.error);
    setBusy(true);
    setError(undefined);
    try {
      try {
        localStorage.setItem(mappingKey(project.id), JSON.stringify(Object.fromEntries(sheet.headers.map((h, i) => [h.toLowerCase(), mapping[i]]))));
      } catch {
        // Niet bewaard (privévenster): volgende keer gewoon opnieuw raden.
      }
      const rows = project.item_type === "asset" ? converted.rows.map((r) => ({ ...r, quantity: 1 })) : converted.rows;
      const res = await api.post<ItemImportResult>("/items/import", { project_id: project.id, rows, owners: builtOwners.owners });
      refreshTaxonomy();
      toast(res.created === 1 ? "1 ding toegevoegd" : `${formatNumber(res.created)} dingen toegevoegd`);
      if (res.skipped.length === 0) {
        navigate(`/projecten/${project.id}`, { replace: true });
        return;
      }
      setResult(res);
      setBusy(false);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title="Lijst importeren" back={{ to: -1, label: project.name }} />

      <section className="card form-section">
        <div className="field">
          <span className="label">Je lijst</span>
          <span className="hint">
            Uit Google Sheets: Bestand → Downloaden → CSV. Of selecteer de cellen (met de kopregel), kopieer ze en plak ze hieronder. Uit Excel: opslaan als
            CSV.
          </span>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> CSV-bestand kiezen
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) load(await readText(file), file.name);
          }}
        />
        <label className="field">
          <span className="label">
            Of plak de cellen <span className="optional">· met de kopregel</span>
          </span>
          <textarea
            rows={4}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text.includes("\n")) setTimeout(() => load(text), 0);
            }}
            placeholder={"Wijn\tJaargang\tAantal\nClos de Vougeot\t2015\t6"}
          />
        </label>
        {pasted.trim() && !sheet && (
          <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => load(pasted)}>
            Lijst lezen
          </button>
        )}
        {sheet && (
          <Alert tone="ok">
            {fileName ? `${fileName}: ` : ""}
            {sheet.rows.length === 1 ? "1 rij" : `${formatNumber(sheet.rows.length)} rijen`}, {sheet.headers.length} kolommen.
          </Alert>
        )}
      </section>

      {sheet && converted && (
        <>
          <section className="card form-section">
            <div className="field">
              <span className="label">Kolommen</span>
              <span className="hint">Wat we niet herkennen, komt bij de notitie: zo gaat er niets verloren.</span>
            </div>
            <ul className="column-map">
              {sheet.headers.map((h, i) => {
                const sample = sheet.rows.map((r) => r[i]).find((v) => v?.trim());
                return (
                  <li key={`${h}-${i}`} className="column-map-row">
                    <span className="column-map-name">
                      <span className="column-map-header">{h}</span>
                      <span className="column-map-sample">{sample ?? "leeg"}</span>
                    </span>
                    <select
                      aria-label={`Kolom ${h}`}
                      value={mapping[i]}
                      onChange={(e) => setMapping((m) => m.map((t, k) => (k === i ? (e.target.value as ColumnTarget) : t)))}
                    >
                      {targets.map((t) => (
                        <option key={t.value || "skip"} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
            {!hasName && <span className="hint split-status error">Kies welke kolom de naam is.</span>}
          </section>

          <section className="card form-section">
            <OwnersField people={people} meId={taxonomy.me.id} value={owners} onChange={setOwners} />
            <span className="hint" style={{ marginTop: -8 }}>
              Geldt voor elke rij. Per ding pas je het later aan.
            </span>
          </section>

          {hasName && (
            <section className="card form-section">
              <div className="field">
                <span className="label">Zo komt het erin</span>
                <span className="hint">
                  {[
                    `${formatNumber(named.length)} ${named.length === 1 ? "ding" : "dingen"}`,
                    named.length < converted.rows.length && `${converted.rows.length - named.length} rijen zonder naam slaan we over`,
                    converted.problems.length > 0 && `${converted.problems.length} cellen niet te lezen (die staan bij de notitie)`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <ul className="import-preview">
                {named.slice(0, 5).map((r, i) => (
                  <li key={i}>
                    <span className="row-title">{r.name}</span>
                    <span className="row-meta">
                      {[
                        r.brand,
                        ...project.fields
                          .filter((f) => r.attributes?.[f.key] !== undefined)
                          .map((f) => `${f.label}: ${formatFieldValue(f, r.attributes![f.key] as Parameters<typeof formatFieldValue>[1])}`),
                        project.item_type === "consumable" && quantityText(r.quantity ?? 1, project.item_unit ?? "stuk"),
                        r.location,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              {named.length > 5 && <span className="hint">en nog {formatNumber(named.length - 5)}</span>}
            </section>
          )}
        </>
      )}

      {result && result.skipped.length > 0 && (
        <Alert tone="partial">
          {formatNumber(result.created)} toegevoegd, {result.skipped.length} overgeslagen:{" "}
          {result.skipped
            .slice(0, 8)
            .map((s) => `rij ${s.row} (${s.error.toLowerCase()})`)
            .join(", ")}
          {result.skipped.length > 8 ? ", …" : ""}
        </Alert>
      )}
      {error && <p className="error">{error}</p>}

      {sheet && !result && (
        <SubmitButton busy={busy} className="btn btn-primary btn-lg">
          {busy ? "Importeren…" : `${formatNumber(named.length)} importeren`}
        </SubmitButton>
      )}
      {result && (
        <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/projecten/${project.id}`, { replace: true })}>
          Naar {project.name}
        </button>
      )}
    </form>
  );
}

function quantityText(n: number, unit: keyof typeof UNITS): string {
  return `${formatNumber(n)} ${n === 1 ? unit : UNITS[unit]}`;
}
