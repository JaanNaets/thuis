import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { formatFieldValue, guessMapping, importRows, parseSheet, type ColumnTarget, type Sheet } from "../../shared/fields";
import type { ImportResult, ItemTypeView, ProjectDetail } from "../../shared/types";
import { api, useApi } from "../api";
import { Alert, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { formatNumber } from "../format";
import { useNavigate } from "../router";

/** Een tabel (Google Sheet als CSV, Excel, geplakte cellen) als items in een lijst. */
export function ImportPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: p, error } = useApi<ProjectDetail>(`/projects/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!p) return null;
  const creatable = p.types.filter((t) => t.can_create);
  const type = creatable.find((t) => t.id === params.get("lijst")) ?? creatable[0];
  if (!type) return <p className="error page">Je kan hier niets toevoegen.</p>;
  return <ImportForm key={type.id} project={p} type={type} creatable={creatable} />;
}

/** De kolommen die je koos, per lijst bewaard (in dit toestel): een volgende tabel uit dezelfde sheet gaat vanzelf. */
const mappingKey = (typeId: string) => `thuis:import:${typeId}`;

function rememberedMapping(typeId: string): Record<string, ColumnTarget> {
  try {
    return JSON.parse(localStorage.getItem(mappingKey(typeId)) ?? "{}") as Record<string, ColumnTarget>;
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

function ImportForm({ project: p, type, creatable }: { project: ProjectDetail; type: ItemTypeView; creatable: ItemTypeView[] }) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // Personen, verwijzingen en berekeningen komen niet uit een tabel (daar zijn id's voor nodig, of de app rekent ze
  // uit); enkel velden die je mag wijzigen.
  const fields = type.fields.filter((f) => !["person", "people", "item", "items", "share", "calc"].includes(f.type) && type.field_access[f.key] === "edit");
  const [pasted, setPasted] = useState("");
  const [sheet, setSheet] = useState<Sheet>();
  const [fileName, setFileName] = useState<string>();
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();

  const targets: { value: ColumnTarget; label: string }[] = [
    { value: "", label: "Niet gebruiken" },
    { value: "name", label: type.name_label ?? "Naam" },
    { value: "tags", label: "Tags" },
    ...fields.map((f) => ({ value: `field:${f.key}` as ColumnTarget, label: f.label })),
  ];

  function load(text: string, name?: string) {
    const parsed = parseSheet(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Er staan geen rijen in. De eerste rij moet de namen van de kolommen bevatten.");
      return;
    }
    const remembered = rememberedMapping(type.id);
    const guessed = guessMapping(parsed.headers, fields);
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

  const converted = useMemo(() => (sheet ? importRows(sheet, mapping, fields) : undefined), [sheet, mapping, fields]);
  const named = converted?.rows.filter((r) => r.name.trim()) ?? [];
  const hasName = mapping.includes("name");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sheet || !converted) return;
    if (!hasName) return setError("Kies welke kolom de naam is.");
    setBusy(true);
    setError(undefined);
    try {
      try {
        localStorage.setItem(mappingKey(type.id), JSON.stringify(Object.fromEntries(sheet.headers.map((h, i) => [h.toLowerCase(), mapping[i]]))));
      } catch {
        // Niet bewaard (privévenster): volgende keer gewoon opnieuw raden.
      }
      const res = await api.post<ImportResult>(`/projects/${p.project.id}/items/import`, { type_id: type.id, rows: converted.rows });
      toast(`${formatNumber(res.created)} ${res.created === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()} toegevoegd`);
      if (res.skipped.length === 0) {
        navigate(`/projecten/${p.project.id}?lijst=${type.id}`, { replace: true });
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
      <PageHead title="Importeren" description={p.project.name} back={{ to: -1, label: p.project.name }} />

      <section className="card form-section">
        {creatable.length > 1 && (
          <label className="field">
            <span className="label">In de lijst</span>
            <select value={type.id} onChange={(e) => setParams({ lijst: e.target.value }, { replace: true })}>
              {creatable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.plural}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          <span className="label">Je tabel</span>
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
            placeholder={"Naam\tJaargang\tAantal\nClos de Vougeot\t2015\t6"}
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
              <span className="hint">
                {fields.some((f) => f.type === "longtext")
                  ? "Wat we niet herkennen, komt bij de lange tekst: zo gaat er niets verloren."
                  : "Kies per kolom waar ze heen gaat."}
              </span>
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

          {hasName && (
            <section className="card form-section">
              <div className="field">
                <span className="label">Zo komt het erin</span>
                <span className="hint">
                  {[
                    `${formatNumber(named.length)} ${named.length === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()}`,
                    named.length < converted.rows.length && `${converted.rows.length - named.length} rijen zonder naam slaan we over`,
                    converted.problems.length > 0 && `${converted.problems.length} cellen niet te lezen`,
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
                        ...fields
                          .filter((f) => r.data[f.key] !== undefined && f.type !== "longtext")
                          .map((f) => `${f.label}: ${formatFieldValue(f, r.data[f.key])}`),
                        ...r.tags,
                      ].join(" · ")}
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
        <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/projecten/${p.project.id}?lijst=${type.id}`, { replace: true })}>
          Naar {p.project.name}
        </button>
      )}
    </form>
  );
}
