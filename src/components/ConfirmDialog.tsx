import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; danger?: boolean };
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

/**
 * Eigen bevestigingsvenster in plaats van window.confirm():
 * kioskbrowsers blokkeren die vaak, en zo past het ook in de stijl van de app.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  // De tekst blijft staan terwijl het venster wegschuift.
  const [shown, setShown] = useState<ConfirmOptions | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setShown(options);
        setPending({ ...options, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (pending) dialogRef.current?.showModal();
  }, [pending]);

  function close(ok: boolean) {
    pending?.resolve(ok);
    dialogRef.current?.close();
    setPending(null);
  }

  return (
    <ConfirmContext value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        className="sheet"
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
        onClick={(e) => e.target === e.currentTarget && close(false)}
      >
        <div className="sheet-handle" />
        {shown && (
          <div className="sheet-body">
            <div style={{ display: "grid", gap: 6 }}>
              <h2>{shown.title}</h2>
              {shown.body && <p className="muted">{shown.body}</p>}
            </div>
            <div className="sheet-actions">
              <button type="button" className="btn btn-outline" onClick={() => close(false)}>
                Annuleren
              </button>
              <button
                type="button"
                className={`btn ${shown.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => close(true)}
                autoFocus
              >
                {shown.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
