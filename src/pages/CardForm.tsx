import { useCallback, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useNavigate } from "../router";
import {
  BARCODE_FORMATS,
  isBarcodeFormat,
  type BarcodeFormat,
  type LoyaltyCard,
  type LoyaltyCardInput,
} from "../../shared/types";
import { api } from "../api";
import { useCard } from "../cards";
import { CARD_COLORS, DEFAULT_CARD_COLOR } from "../color";
import { Barcode } from "../components/Barcode";
import type { ScanResult } from "../barcode-detect";
import { Alert, SubmitButton } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { ScanButtons } from "../components/ScanButtons";

export function CardFormPage() {
  const { id } = useParams();
  if (!id) return <CardForm />;
  return <EditCard id={id} />;
}

function EditCard({ id }: { id: string }) {
  const { card, error } = useCard(id);
  if (error) return <p className="error page">{error}</p>;
  if (!card) return null;
  return <CardForm existing={card} />;
}

function CardForm({ existing }: { existing?: LoyaltyCard }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<LoyaltyCardInput>({
    name: existing?.name ?? "",
    card_number: existing?.card_number ?? "",
    format: existing?.format ?? "ean_13",
    color: existing?.color ?? CARD_COLORS[0],
    notes: existing?.notes ?? "",
  });
  const [scanNote, setScanNote] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const set = <K extends keyof LoyaltyCardInput>(key: K, value: LoyaltyCardInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onScan = useCallback((result: ScanResult) => {
    setForm((f) => ({
      ...f,
      card_number: result.rawValue,
      format: isBarcodeFormat(result.format) ? result.format : f.format,
    }));
    setScanNote(
      isBarcodeFormat(result.format)
        ? undefined
        : `Gescand formaat (${result.format}) wordt niet ondersteund; kies zelf een formaat.`,
    );
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const saved = existing
        ? await api.put<LoyaltyCard>(`/loyalty-cards/${existing.id}`, form)
        : await api.post<LoyaltyCard>("/loyalty-cards", form);
      toast(existing ? "Kaart bijgewerkt" : "Kaart bewaard");
      navigate(`/kaarten/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={existing ? "Kaart bewerken" : "Nieuwe kaart"} back={{ to: -1, label: existing ? existing.name : "Kaarten" }} />

      <section className="card form-section">
        <div className="field">
          <span className="label">Barcode</span>
          <span className="hint">Scan de kaart, of kies een foto of screenshot (bv. uit de app van de winkel).</span>
        </div>
        <ScanButtons hint="Richt de camera op de barcode van je kaart" onResult={onScan} />
        {scanNote && <Alert tone="partial">{scanNote}</Alert>}
      </section>

      <section className="card form-section">
        <label className="field">
          <span className="label">Naam</span>
          <input required maxLength={100} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="bv. Colruyt Xtra" />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="label">Kaartnummer</span>
            <input required maxLength={500} className="mono" value={form.card_number} onChange={(e) => set("card_number", e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Formaat</span>
            <select value={form.format} onChange={(e) => set("format", e.target.value as BarcodeFormat)}>
              {Object.entries(BARCODE_FORMATS).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form.card_number && (
          <div className="card barcode-panel preview">
            <Barcode format={form.format} value={form.card_number} />
          </div>
        )}

        <fieldset className="field">
          <legend className="label" style={{ marginBottom: 8 }}>
            Kleur
          </legend>
          <div className="swatches">
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${form.color === c ? "selected" : ""}`}
                style={{ background: c }}
                aria-label={c}
                aria-pressed={form.color === c}
                onClick={() => set("color", c)}
              />
            ))}
            <input type="color" value={form.color ?? DEFAULT_CARD_COLOR} onChange={(e) => set("color", e.target.value)} aria-label="Eigen kleur" />
          </div>
        </fieldset>

        <label className="field">
          <span className="label">
            <Icon name="note" size={15} /> Notitie
          </span>
          <textarea rows={2} maxLength={1000} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="bv. op naam van Sam" />
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <SubmitButton busy={saving} className="btn btn-primary btn-lg">
        {saving ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
    </form>
  );
}
