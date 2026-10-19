import { lazy, Suspense, useEffect } from "react";
import type { PurchaseFile } from "../../shared/types";
import { Icon } from "./Icon";

// pdf.js is groot; enkel laden wanneer iemand effectief een PDF opent.
const PdfPages = lazy(() => import("./PdfPages"));

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Toont een bewijsstuk binnen de app. Geen nieuw tabblad: op een kiosk-tablet
 * kan je daar vaak niet meer uit terugkeren.
 */
export function FileViewer({ file, onClose }: { file: PurchaseFile; onClose: () => void }) {
  const url = `/api/files/${file.id}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={file.filename}>
      <header className="viewer-bar">
        <span className="viewer-title">{file.filename}</span>
        <button type="button" className="icon-button on-dark" onClick={onClose} aria-label="Sluiten">
          <Icon name="close" size={22} />
        </button>
      </header>
      <div className="viewer-body">
        {IMAGE_TYPES.includes(file.content_type) ? (
          <img src={url} alt={file.filename} />
        ) : file.content_type === "application/pdf" ? (
          <Suspense fallback={<p className="viewer-note">PDF laden…</p>}>
            <PdfPages url={url} />
          </Suspense>
        ) : (
          <p className="viewer-note">Dit bestandstype ({file.content_type}) kan hier niet getoond worden.</p>
        )}
      </div>
    </div>
  );
}
