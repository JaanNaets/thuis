// Voorraad: een getal met − en + (`counter` op het veld) in de lijst, scannen om bij te tellen of af te trekken, en
// de lijnen van een kasticket bij je voorraad optellen. Elke aanpassing gaat in één keer naar de database
// (`/items/:id/adjust`), zodat twee mensen tegelijk elkaar niet overschrijven.

import { useRef, useState } from "react";
import type { CodeValue, FieldDef } from "../../shared/fields";
import type { Item, ReceiptLines } from "../../shared/types";
import { api } from "../api";
import { formatNumber } from "../format";
import { prepareForReading } from "../image";
import { BarcodeScanner } from "./BarcodeScanner";
import { Alert, Segmented } from "./Controls";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

/** Een getal met `delta` aanpassen; geeft de nieuwe waarde. */
export async function adjust(itemId: string, key: string, delta: number): Promise<number> {
  const { value } = await api.post<{ value: number }>(`/items/${itemId}/adjust`, { key, delta });
  return value;
}

/** − en + rechts in een rij van de lijst. */
export function RowStepper({ value, label, onStep }: { value: number; label: string; onStep: (delta: number) => void }) {
  return (
    <span className="row-stepper">
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label}: één minder`} disabled={value <= 0} onClick={() => onStep(-1)}>
        <Icon name="minus" size={15} />
      </button>
      <span className="row-stepper-value">{formatNumber(value)}</span>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label}: één meer`} onClick={() => onStep(1)}>
        <Icon name="plus" size={15} />
      </button>
    </span>
  );
}

/**
 * Scannen in een voorraad: elke barcode die je scant, telt één bij (of trekt één af) bij het item met die barcode.
 * De camera blijft open; onderaan staat wat er gebeurde.
 */
export function StockScanner({
  items,
  code,
  counter,
  onChanged,
  onClose,
}: {
  items: Item[];
  code: FieldDef;
  counter: FieldDef;
  onChanged: (id: string, value: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"in" | "out">("in");
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string>();

  async function scanned(text: string) {
    const item = items.find((i) => (i.data[code.key] as CodeValue | undefined)?.text === text);
    if (!item) return setStatus(`Nog niet in deze lijst (${text}). Voeg het eerst toe.`);
    try {
      const value = await adjust(item.id, counter.key, mode === "in" ? 1 : -1);
      onChanged(item.id, value);
      setStatus(`${item.name}: ${formatNumber(value)} (${mode === "in" ? "+1" : "−1"})`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  return (
    <div className="form">
      <div className="field">
        <span className="label">Wat doe je?</span>
        <Segmented
          label="Wat doe je?"
          value={mode}
          onChange={setMode}
          options={[
            { value: "in", label: "Erbij (gekocht)" },
            { value: "out", label: "Eraf (opgebruikt)" },
          ]}
        />
        <span className="hint">Scan de ene barcode na de andere; de camera blijft open tot je ze sluit.</span>
      </div>
      <button type="button" className="btn btn-primary btn-lg" onClick={() => setScanning(true)}>
        <Icon name="scan" /> Scannen
      </button>
      {status && <Alert tone="ok">{status}</Alert>}
      {scanning && (
        <BarcodeScanner
          continuous
          hint={status ?? `Scan om ${counter.label.toLowerCase()} ${mode === "in" ? "bij te tellen" : "af te trekken"}`}
          onClose={() => {
            setScanning(false);
            onClose();
          }}
          onResult={(r) => scanned(r.rawValue)}
        />
      )}
    </div>
  );
}

type Line = ReceiptLines["lines"][number] & { on: boolean; amount: string };

/**
 * Een kasticket bij je voorraad optellen: de AI leest de lijnen, de app koppelt ze aan je items. Jij kiest wat erbij
 * komt (en hoeveel); wat nog niet bestaat, wordt een nieuw item.
 */
export function ReceiptToStock({
  projectId,
  typeId,
  counter,
  onDone,
}: {
  projectId: string;
  typeId: string;
  counter: FieldDef;
  onDone: () => void;
}) {
  const toast = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[]>();
  const [status, setStatus] = useState<{ tone: "busy" | "none"; text: string }>();
  const [busy, setBusy] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    setLines(undefined);
    setStatus({ tone: "busy", text: "Kasticket lezen" });
    try {
      const body = new FormData();
      body.set("image", await prepareForReading(file));
      body.set("type_id", typeId);
      const found = await api.post<ReceiptLines>(`/projects/${projectId}/items/scan-lines`, body);
      setLines(found.lines.map((l) => ({ ...l, on: true, amount: String(l.quantity) })));
      setStatus(found.message ? { tone: "none", text: found.message } : undefined);
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  async function apply() {
    const chosen = (lines ?? []).filter((l) => l.on && Number(l.amount.replace(",", ".")) > 0);
    setBusy(true);
    try {
      for (const l of chosen) {
        const n = Number(l.amount.replace(",", "."));
        if (l.item_id) await adjust(l.item_id, counter.key, n);
        else await api.post(`/projects/${projectId}/items`, { type_id: typeId, name: l.name, data: { [counter.key]: n }, tag_ids: [] });
      }
      toast(chosen.length === 1 ? "1 product bijgeteld" : `${chosen.length} producten bijgeteld`);
      onDone();
    } catch (err) {
      toast((err as Error).message, "alert");
    } finally {
      setBusy(false);
    }
  }

  const set = (i: number, patch: Partial<Line>) => setLines((list) => list?.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const input = (ref: typeof cameraRef, camera: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture={camera ? "environment" : undefined}
      hidden
      onChange={(e) => {
        read(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="form">
      <p className="hint">Trek een foto van het kasticket: de app zoekt welke producten je kocht en telt ze bij je voorraad.</p>
      <div className="btn-row">
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" /> Foto
        </button>
        <button type="button" className="btn btn-outline" disabled={status?.tone === "busy"} onClick={() => fileRef.current?.click()}>
          <Icon name="image" /> Uit foto
        </button>
      </div>
      {input(cameraRef, true)}
      {input(fileRef, false)}
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      {lines && lines.length > 0 && (
        <>
          <ul className="receipt-lines">
            {lines.map((l, i) => (
              <li key={`${l.item_id ?? l.name}-${i}`} data-off={!l.on}>
                <label className="receipt-line-check">
                  <input type="checkbox" checked={l.on} onChange={(e) => set(i, { on: e.target.checked })} />
                  <span>
                    <span className="receipt-line-name">{l.item_name ?? l.name}</span>
                    <span className="hint">{l.item_id ? (l.item_name !== l.name ? `op het ticket: ${l.name}` : "in je voorraad") : "nieuw item"}</span>
                  </span>
                </label>
                <span className="split-input" data-unit="+">
                  <input inputMode="decimal" value={l.amount} aria-label={`Aantal ${l.name}`} onChange={(e) => set(i, { amount: e.target.value })} />
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={apply}>
            {busy ? "Bijtellen…" : "Bijtellen"}
          </button>
        </>
      )}
    </div>
  );
}
