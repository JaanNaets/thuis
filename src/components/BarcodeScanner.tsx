import { useEffect, useRef, useState } from "react";
import { getDetector, type ScanResult } from "../barcode-detect";
import { Icon } from "./Icon";

export type { ScanResult };

/**
 * De camera die barcodes live leest. Met `onPhoto` is het ook een camera voor een foto (een product of een bord eten
 * zonder barcode): een barcode komt er vanzelf uit, zonder AI; de ontspanknop (met ✨) trekt een foto die de AI leest.
 */
export function BarcodeScanner({
  onResult,
  onClose,
  onPhoto,
  skip,
  hint = "Richt de camera op de barcode",
  continuous = false,
}: {
  onResult: (r: ScanResult) => void;
  onClose: () => void;
  /** Ontspanknop: de foto (zo scherp als de camera kan). */
  onPhoto?: (file: File) => void;
  /** Deze code niet meer melden (bv. al opgezocht en niet gevonden). */
  skip?: (code: string) => boolean;
  hint?: string;
  /** Blijven scannen na een barcode (dezelfde code pas opnieuw na een paar seconden). */
  continuous?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream>(undefined);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  // In een ref, zodat de camera niet herstart telkens de ouder opnieuw rendert.
  const onResultRef = useRef(onResult);
  const skipRef = useRef(skip);
  useEffect(() => {
    onResultRef.current = onResult;
    skipRef.current = skip;
  });

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Voor een foto een groter beeld (als de camera geen echte foto kan trekken, zie `take`).
          video: { facingMode: "environment", width: { ideal: onPhoto ? 1920 : 1280 } },
          audio: false,
        });
        if (stopped) return;
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const detector = await getDetector();
        let last = { code: "", at: 0 };
        const tick = async () => {
          if (stopped) return;
          try {
            const [hit] = await detector.detect(video);
            if (hit && !skipRef.current?.(hit.rawValue) && !(continuous && hit.rawValue === last.code && Date.now() - last.at < 2500)) {
              navigator.vibrate?.(50);
              last = { code: hit.rawValue, at: Date.now() };
              onResultRef.current({ rawValue: hit.rawValue, format: hit.format });
              if (!continuous) return;
              timer = window.setTimeout(tick, 900);
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

  /** Een foto: een echte foto van de camera als dat kan (ImageCapture, Chrome op Android), anders het beeld van nu. */
  async function take() {
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track || !onPhoto) return;
    setTaking(true);
    let blob: Blob | null = null;
    try {
      const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
      if (Capture) blob = await new Capture(track).takePhoto();
    } catch {
      // Dan het beeld van de video.
    }
    if (!blob) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.92));
    }
    setTaking(false);
    if (blob) onPhoto(new File([blob], "foto.jpg", { type: blob.type || "image/jpeg" }));
  }

  return (
    <div className={onPhoto ? "scanner is-photo" : "scanner"} role="dialog" aria-label={onPhoto ? "Foto of barcode" : "Barcode scannen"}>
      <video ref={videoRef} playsInline muted />
      {onPhoto && <div className="scanner-shade" />}
      <div className="scanner-frame" />
      <p className="scanner-hint">{error ?? hint}</p>
      {onPhoto && !error && (
        <button type="button" className="scanner-shutter" disabled={!ready || taking} onClick={take} aria-label="Foto lezen met AI" title="Lezen met AI">
          <Icon name="sparkles" size={24} />
        </button>
      )}
      <button type="button" className="scanner-close" onClick={onClose} aria-label="Sluiten">
        <Icon name="close" size={24} />
      </button>
    </div>
  );
}
