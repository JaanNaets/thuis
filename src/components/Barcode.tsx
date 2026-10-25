import { toCanvas } from "bwip-js/browser";
import { useEffect, useRef, useState } from "react";
import { CODE_FORMATS as BARCODE_FORMATS, type CodeFormat as BarcodeFormat } from "../../shared/fields";

const TWO_D: BarcodeFormat[] = ["qr_code", "data_matrix", "pdf417", "aztec"];

export function Barcode({ format, value }: { format: BarcodeFormat; value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!canvasRef.current) return;
    const is2D = TWO_D.includes(format);
    try {
      toCanvas(canvasRef.current, {
        bcid: BARCODE_FORMATS[format].bwip,
        text: value,
        scale: 4,
        ...(is2D ? {} : { height: 22 }),
        paddingwidth: 12,
        paddingheight: 12,
        backgroundcolor: "FFFFFF",
      });
      setError(undefined);
    } catch {
      setError(`Dit nummer is geen geldige ${BARCODE_FORMATS[format].label}-code. Kies een ander formaat.`);
    }
  }, [format, value]);

  return (
    <div className="barcode">
      <canvas ref={canvasRef} hidden={!!error} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
