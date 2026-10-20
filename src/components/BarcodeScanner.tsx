import { useEffect, useRef, useState } from "react";
import { getDetector, type ScanResult } from "../barcode-detect";
import { Icon } from "./Icon";

export type { ScanResult };

export function BarcodeScanner({
  onResult,
  onClose,
  hint = "Richt de camera op de barcode",
}: {
  onResult: (r: ScanResult) => void;
  onClose: () => void;
  hint?: string;
}) {
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

        const detector = await getDetector();
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
      <p className="scanner-hint">{error ?? hint}</p>
      <button type="button" className="scanner-close" onClick={onClose} aria-label="Sluiten">
        <Icon name="close" size={24} />
      </button>
    </div>
  );
}
