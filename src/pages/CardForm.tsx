import { useCallback, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
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
import { BarcodeScanner, type ScanResult } from "../components/BarcodeScanner";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Page";

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
  const [form, setForm] = useState<LoyaltyCardInput>({
    name: existing?.name ?? "",
    card_number: existing?.card_number ?? "",
    format: existing?.format ?? "ean_13",
    color: existing?.color ?? CARD_COLORS[0],
    notes: existing?.notes ?? "",
  });
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const set = <K extends keyof LoyaltyCardInput>(key: K, value: LoyaltyCardInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onScan = useCallback((result: ScanResult) => {
    setScanning(false);
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
      navigate(`/kaarten/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHeader title={existing ? "Kaart bewerken" : "Nieuwe kaart"} back={-1} />

      <button type="button" className="button scan-button" onClick={() => setScanning(true)}>
        <Icon name="scan" /> Barcode scannen
      </button>
      {scanNote && <p className="muted small">{scanNote}</p>}

      <label className="field">
        <span className="label">Naam *</span>
        <input
          required
          maxLength={100}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="bv. Colruyt Xtra"
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="label">Kaartnummer *</span>
          <input
            required
            maxLength={500}
            value={form.card_number}
            onChange={(e) => set("card_number", e.target.value)}
          />
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
        <div className="barcode-panel preview">
          <Barcode format={form.format} value={form.card_number} />
        </div>
      )}

      <fieldset className="field">
        <legend className="label">Kleur</legend>
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
          <input
            type="color"
            value={form.color ?? DEFAULT_CARD_COLOR}
            onChange={(e) => set("color", e.target.value)}
            aria-label="Eigen kleur"
          />
        </div>
      </fieldset>

      <label className="field">
        <span className="label">Notities</span>
        <textarea rows={2} maxLength={1000} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" className="button primary" disabled={saving}>
        {saving ? "Opslaan…" : "Opslaan"}
      </button>

      {scanning && <BarcodeScanner onResult={onScan} onClose={() => setScanning(false)} />}
    </form>
  );
}
