import { useEffect, useRef, type ReactNode } from "react";

/** Onderblad (op tablet een venster in het midden) voor korte formulieren: voorraad aanpassen, iets hernoemen, ... */
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
      {open && (
        <div className="sheet-body">
          <h2>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
