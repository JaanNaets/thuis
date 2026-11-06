import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { formatFieldValue, guessMapping, importRows, parseSheet, type ColumnTarget, type Sheet } from "../../shared/fields";
import type { List, ListDetail } from "../../shared/model";

type ImportResult = { created: number; skipped: { row: number; error: string }[] };
import { api, useApi } from "../api";
import { Alert, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { formatNumber } from "../format";
import { useNavigate } from "../router";

/** Een tabel (Google Sheet als CSV, Excel, geplakte cellen) als dingen in een lijst. */
export function ImportPage() {
  const { id } = useParams();
  const { data: detail, error } = useApi<ListDetail>(`/lists/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!detail) return null;
  if (!detail.list.one || (detail.role !== "lid" && detail.role !== "beheerder")) return <p className="error page">Je kan hier niets toevoegen.</p>;
  return <ImportForm key={detail.list.id} list={detail.list} />;
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

function ImportForm({ list }: { list: List }) {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // Personen, verwijzingen en berekeningen komen niet uit een tabel (daar zijn id's voor nodig, of de app rekent ze
  // uit); enkel velden die je mag wijzigen.
  const fields = list.fields.filter((f) => !["person", "people", "item", "items", "share", "calc", "amounts"].includes(f.type));
  const [pasted, setPasted] = useState("");
  const [sheet, setSheet] = useState<Sheet>();
  const [fileName, setFileName] = useState<string>();
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();

  const targets: { value: ColumnTarget; label: string }[] = [
    { value: "", label: "Niet gebruiken" },
    { value: "name", label: list.one ?? "Naam" },
    ...fields.map((f) => ({ value: `field:${f.key}` as ColumnTarget, label: f.label })),
  ];

  function load(text: string, name?: string) {
    const parsed = parseSheet(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Er staan geen rijen in. De eerste rij moet de namen van de kolommen bevatten.");
      return;
    }
    const remembered = rememberedMapping(list.id);
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
        localStorage.setItem(mappingKey(list.id), JSON.stringify(Object.fromEntries(sheet.headers.map((h, i) => [h.toLowerCase(), mapping[i]]))));
      } catch {
        // Niet bewaard (privévenster): volgende keer gewoon opnieuw raden.
      }
      const res = await api.post<ImportResult>(`/lists/${list.id}/things/import`, { rows: converted.rows });
      toast(`${formatNumber(res.created)} toegevoegd aan ${list.name}`);
      if (res.skipped.length === 0) {
        navigate(`/lijsten/${list.id}`, { replace: true });
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
      <PageHead title="Importeren" back={{ to: -1, label: list.name }} />

      <section className="card form-section">
        <div className="field">
          <span className="label">Je tabel</span>
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
            Of plak de cellen met de kopregel
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
                    `${formatNumber(named.length)} ${named.length === 1 ? (list.one ?? "ding").toLowerCase() : "dingen"}`,
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
        <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(`/lijsten/${list.id}`, { replace: true })}>
          Naar {list.name}
        </button>
      )}
    </form>
  );
}
