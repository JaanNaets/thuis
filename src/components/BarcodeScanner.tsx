import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export type ScanResult = { rawValue: string; format: string };

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string; format: string }[]> };

/**
 * Chrome op Android heeft een ingebouwde BarcodeDetector. Safari (iPhone) en desktop niet;
 * daar laden we een WebAssembly-versie van ZXing (±1 MB, enkel wanneer je effectief scant).
 */
async function createDetector(): Promise<Detector> {
  if ("BarcodeDetector" in window) {
    const Native = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
    return new Native();
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
  });
  return new BarcodeDetector();
}

export function BarcodeScanner({ onResult, onClose }: { onResult: (r: ScanResult) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  // In een ref, zodat de camera niet herstart telkens de ouder opnieuw rendert.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const detector = await createDetector();
        const tick = async () => {
          if (stopped) return;
          try {
            const [hit] = await detector.detect(video);
            if (hit) {
              navigator.vibrate?.(50);
              onResultRef.current({ rawValue: hit.rawValue, format: hit.format });
              return;
            }
          } catch {
            // Frame nog niet klaar; volgende poging.
          }
          timer = window.setTimeout(tick, 200);
        };
        tick();
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Geen toegang tot de camera. Sta het toe in je browserinstellingen."
            : "De camera kon niet gestart worden.",
        );
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-label="Barcode scannen">
      <video ref={videoRef} playsInline muted />
      <div className="scanner-frame" />
      <p className="scanner-hint">{error ?? "Richt de camera op de barcode van je kaart"}</p>
      <button type="button" className="scanner-close" onClick={onClose} aria-label="Sluiten">
        <Icon name="close" size={24} />
      </button>
    </div>
  );
}
