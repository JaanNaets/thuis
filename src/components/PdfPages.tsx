import { useEffect, useRef, useState } from "react";
import { getDocument } from "../pdf";

const MAX_PAGES = 20;

/** Tekent elke pagina van een PDF op een canvas. Werkt in elke browser, ook zonder ingebouwde PDF-viewer. */
export default function PdfPages({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const container = containerRef.current!;
    const task = getDocument({ url, withCredentials: true });
    let cancelled = false;

    (async () => {
      try {
        const pdf = await task.promise;
        const width = container.clientWidth;
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES) && !cancelled; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * window.devicePixelRatio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          container.append(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError("Deze PDF kon niet geopend worden.");
      }
    })();

    return () => {
      cancelled = true;
      task.destroy();
      container.replaceChildren();
    };
  }, [url]);

  return (
    <>
      <div ref={containerRef} className="pdf-pages" />
      {error && <p className="viewer-note">{error}</p>}
    </>
  );
}
