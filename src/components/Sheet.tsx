import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

/** Zo ver of zo snel naar beneden geveegd, gaat het blad dicht (anders glijdt het terug). */
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 600; // px per seconde

/**
 * Onderblad (op tablet een venster in het midden) voor korte formulieren.
 * Bij het sluiten blijft de inhoud staan tot het blad uit beeld geschoven is,
 * zodat het niet leeg wegglijdt. Op een gsm veeg je het aan de greep naar beneden dicht.
 */
export function Sheet({
  open,
  title,
  onClose,
  className,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const last = useRef<{ title: string; children: ReactNode }>({ title, children });
  // Elke keer het blad opent, begint de inhoud met een schone lei (nieuwe key).
  const openCount = useRef(0);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) openCount.current++;
  wasOpen.current = open;
  if (open) last.current = { title, children };

  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Vegen aan de greep: het blad volgt de vinger zonder vertraging; losgelaten gaat het dicht of glijdt het terug.
  const drag = useRef<{ start: number; dy: number; y: number; t: number; speed: number } | null>(null);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: e.clientY, dy: 0, y: e.clientY, t: performance.now(), speed: 0 };
    ref.current!.style.transition = "none";
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    d.speed = ((e.clientY - d.y) / Math.max(1, now - d.t)) * 1000;
    d.y = e.clientY;
    d.t = now;
    d.dy = Math.max(0, e.clientY - d.start);
    ref.current!.style.transform = `translateY(${d.dy}px)`;
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dialog = ref.current!;
    dialog.style.transition = "";
    dialog.style.transform = "";
    if (d.dy > CLOSE_DISTANCE || (d.dy > 16 && d.speed > CLOSE_SPEED)) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={className ? `sheet ${className}` : "sheet"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Tik naast het venster = sluiten.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet-grip" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="sheet-handle" />
      </div>
      <div className="sheet-body" key={openCount.current}>
        <h2>{last.current.title}</h2>
        {last.current.children}
      </div>
    </dialog>
  );
}
