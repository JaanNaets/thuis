// Voorraad: een getal met − en + (`counter` op het veld) in de lijst, scannen om bij te tellen of af te trekken, en
// de lijnen van een kasticket bij je voorraad optellen. Elke aanpassing gaat in één keer naar de database
// (`/items/:id/adjust`), zodat twee mensen tegelijk elkaar niet overschrijven.

import { useEffect, useRef, useState } from "react";
import type { CodeValue, FieldDef } from "../../shared/fields";
import { convert, formatAmount, measureOf, round3, type Measure } from "../../shared/units";
import type { Item, ReceiptLines } from "../../shared/types";
import { api } from "../api";
import { clearShared } from "../shared-file";
import { formatNumber } from "../format";
import { prepareForReading } from "../image";
import { BarcodeScanner } from "./BarcodeScanner";
import { Alert, Segmented } from "./Controls";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/** Een getal met `delta` aanpassen; geeft de nieuwe waarde. `alias`: de naam op een kasticket, om te onthouden. */
export async function adjust(itemId: string, key: string, delta: number, alias?: string): Promise<number> {
  const { value } = await api.post<{ value: number }>(`/items/${itemId}/adjust`, { key, delta, ...(alias ? { alias } : {}) });
  return value;
}

/**
 * − en + rechts in een rij van de lijst. Met een eenheid (`measure`, zie shared/units.ts) staat ze erbij (45 kg) en
 * telt een tik een hele verpakking (een zak van 15 kg); tik op het getal om een hoeveelheid te typen.
 */
export function RowStepper({
  value,
  label,
  onStep,
  measure,
}: {
  value: number;
  label: string;
  /** Het verschil, in de eenheid van het item. */
  onStep: (delta: number) => void;
  measure?: Measure;
}) {
  const [typing, setTyping] = useState(false);
  const step = measure?.pack ?? 1;
  const what = measure?.pack ? `één ${measure.pack_name ?? "verpakking"}` : "één";
  const shown = measure?.unit ? formatAmount(value, measure.unit) : formatNumber(value);
  return (
    <span className="row-stepper">
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label}: ${what} minder`} disabled={value <= 0} onClick={() => onStep(-Math.min(step, value))}>
        <Icon name="minus" size={15} />
      </button>
      {measure ? (
        <button type="button" className="row-stepper-value as-button" aria-label={`${label}: ${shown}, hoeveelheid typen`} onClick={() => setTyping(true)}>
          {shown}
        </button>
      ) : (
        <span className="row-stepper-value">{shown}</span>
      )}
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${label}: ${what} meer`} onClick={() => onStep(step)}>
        <Icon name="plus" size={15} />
      </button>
      {measure && (
        <Sheet open={typing} title={label} onClose={() => setTyping(false)}>
          {typing && (
            <AmountForm
              measure={measure}
              current={value}
              onDone={(delta) => {
                setTyping(false);
                if (delta) onStep(delta);
              }}
            />
          )}
        </Sheet>
      )}
    </span>
  );
}

/** Een hoeveelheid erbij of eraf, in een eenheid naar keuze (500 g van een voorraad in kg, een zak van 15 kg). */
function AmountForm({ measure, current, onDone }: { measure: Measure; current: number; onDone: (delta: number) => void }) {
  const [mode, setMode] = useState<"in" | "out">("out");
  const [text, setText] = useState("");
  const units = unitChoices(measure);
  const [unit, setUnit] = useState(units[0].value);
  const amount = Number(text.replace(",", "."));
  const delta = Number.isFinite(amount) && amount > 0 ? round3(convert(amount, unit, measure)) : 0;
  const after = round3(Math.max(0, current + (mode === "in" ? delta : -delta)));
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(mode === "in" ? delta : -Math.min(delta, current));
      }}
    >
      <Segmented
        label="Erbij of eraf"
        value={mode}
        onChange={setMode}
        options={[
          { value: "out", label: "Eraf" },
          { value: "in", label: "Erbij" },
        ]}
      />
      <div className="amount-row">
        <input autoFocus inputMode="decimal" aria-label="Hoeveel" placeholder="0" value={text} onChange={(e) => setText(e.target.value)} />
        <select aria-label="Eenheid" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {units.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary btn-lg" disabled={!delta}>
        {delta ? `Wordt ${formatAmount(after, measure.unit)}` : mode === "in" ? "Erbij" : "Eraf"}
      </button>
    </form>
  );
}

/** De eenheden die bij een item passen: zijn eigen, de verpakking, en gewicht of inhoud als dat omrekent. */
function unitChoices(m: Measure): { value: string; label: string }[] {
  const own = m.unit ?? "stuk";
  const out = [{ value: own, label: own }];
  if (m.pack) out.push({ value: m.pack_name ?? "verpakking", label: `${m.pack_name ?? "verpakking"} (${formatAmount(m.pack, own)})` });
  const mass = ["g", "kg"];
  const volume = ["ml", "cl", "l"];
  const extra = mass.includes(own) ? mass : volume.includes(own) ? volume : m.piece ? ["g", "ml"] : [];
  for (const u of extra) if (u !== own) out.push({ value: u, label: u });
  return out;
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
      // Eén barcode is één verpakking (een zak van 15 kg), anders één.
      const one = measureOf(counter, item.data).pack ?? 1;
      const value = await adjust(item.id, counter.key, mode === "in" ? one : -one);
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

type Line = Omit<ReceiptLines["lines"][number], "amount"> & { on: boolean; amount: string };

/**
 * Een kasticket bij je voorraad optellen: de AI leest de lijnen, de app koppelt ze aan je items. Jij kiest wat erbij
 * komt (en hoeveel); wat nog niet bestaat, wordt een nieuw item.
 */
export function ReceiptToStock({
  projectId,
  typeId,
  counter,
  onDone,
  initial,
}: {
  projectId: string;
  typeId: string;
  counter: FieldDef;
  onDone: () => void;
  /** Een foto die al klaarligt (gedeeld vanuit een andere app): meteen lezen. */
  initial?: File | null;
}) {
  const toast = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[]>();
  const [status, setStatus] = useState<{ tone: "busy" | "none"; text: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    read(initial);
    clearShared();
  }, [initial]);

  async function read(file: File | undefined) {
    if (!file) return;
    setLines(undefined);
    setStatus({ tone: "busy", text: "Kasticket lezen" });
    try {
      const body = new FormData();
      body.set("image", await prepareForReading(file));
      body.set("type_id", typeId);
      const found = await api.post<ReceiptLines>(`/projects/${projectId}/items/scan-lines`, body);
      setLines(found.lines.map((l) => ({ ...l, on: true, amount: String(l.amount).replace(".", ",") })));
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
        // Gekoppeld aan een product met een andere naam: die naam onthoudt het product (zie de API).
        if (l.item_id) await adjust(l.item_id, counter.key, n, l.item_name !== l.name ? l.name : undefined);
        else {
          // Een nieuw product: met de eenheid en de verpakking van het ticket (Aardappelen 5KG: in kg, per zak van 5).
          const m = counter.measure;
          const data = { [counter.key]: n, ...(m?.unit && l.unit ? { [m.unit]: l.unit } : {}), ...(m?.pack && l.pack ? { [m.pack]: l.pack } : {}) };
          await api.post(`/projects/${projectId}/items`, { type_id: typeId, name: l.name, data, tag_ids: [] });
        }
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
                <span className="split-input" data-unit={l.unit ? formatAmount(0, l.unit).replace(/^0 /, "") : "+"}>
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
