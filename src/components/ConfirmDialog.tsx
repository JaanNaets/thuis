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
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
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
      >
        {pending && (
          <>
            <h2>{pending.title}</h2>
            {pending.body && <p className="muted">{pending.body}</p>}
            <div className="sheet-actions">
              <button type="button" className="button quiet" onClick={() => close(false)}>
                Annuleren
              </button>
              <button
                type="button"
                className={`button ${pending.danger ? "danger-solid" : "primary"}`}
                onClick={() => close(true)}
                autoFocus
              >
                {pending.confirmLabel ?? "OK"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </ConfirmContext>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
