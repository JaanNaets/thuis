import { useEffect, useRef, type ReactNode } from "react";

/**
 * Onderblad (op tablet een venster in het midden) voor korte formulieren.
 * Bij het sluiten blijft de inhoud staan tot het blad uit beeld geschoven is,
 * zodat het niet leeg wegglijdt.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
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

  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Tik naast het venster = sluiten.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet-handle" />
      <div className="sheet-body" key={openCount.current}>
        <h2>{last.current.title}</h2>
        {last.current.children}
      </div>
    </dialog>
  );
}
