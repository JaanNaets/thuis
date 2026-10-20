import { useRef, useState } from "react";
import type { Tone } from "../../shared/types";
import { detectInImage, type ScanResult } from "../barcode-detect";
import { BarcodeScanner } from "./BarcodeScanner";
import { Icon } from "./Icon";

/**
 * Een barcode inlezen: live met de camera, of van een foto of screenshot die je al hebt
 * (handig voor kaarten die enkel in de app van de winkel staan).
 */
export function ScanButtons({ onResult, hint, tone }: { onResult: (r: ScanResult) => void; hint: string; tone: Tone }) {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<{ tone: "busy" | "none"; text: string }>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function fromPhoto(file: File) {
    setStatus({ tone: "busy", text: "Barcode zoeken" });
    try {
      const hit = await detectInImage(file);
      if (!hit) {
        setStatus({ tone: "none", text: "Geen barcode gevonden. Probeer een scherpere foto, of typ het nummer over." });
        return;
      }
      setStatus(undefined);
      onResult(hit);
    } catch (err) {
      setStatus({ tone: "none", text: (err as Error).message });
    }
  }

  return (
    <div className="scan-buttons">
      <div className="button-row">
        <button type="button" className={`button tinted tone-${tone}`} onClick={() => setScanning(true)}>
          <Icon name="scan" /> Scannen
        </button>
        <button
          type="button"
          className={`button tinted tone-${tone}`}
          disabled={status?.tone === "busy"}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="image" /> Uit foto
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) fromPhoto(file);
        }}
      />
      {status && (
        <p className={`read-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}
      {scanning && (
        <BarcodeScanner
          hint={hint}
          onClose={() => setScanning(false)}
          onResult={(r) => {
            setScanning(false);
            setStatus(undefined);
            onResult(r);
          }}
        />
      )}
    </div>
  );
}
