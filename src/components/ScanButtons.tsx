import { useRef, useState } from "react";
import { detectInImage, type ScanResult } from "../barcode-detect";
import { BarcodeScanner } from "./BarcodeScanner";
import { Alert } from "./Controls";
import { Icon } from "./Icon";

/**
 * Een barcode inlezen: live met de camera, of van een foto of screenshot die je al hebt
 * (handig voor kaarten die enkel in de app van de winkel staan).
 */
export function ScanButtons({ onResult, hint }: { onResult: (r: ScanResult) => void; hint: string }) {
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
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={() => setScanning(true)}>
          <Icon name="scan" /> Scannen
        </button>
        <button
          type="button"
          className="btn btn-outline"
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
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
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
