import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Een knop in de toast (bv. Ongedaan maken); een tik voert ze uit en sluit de toast. */
export type ToastAction = { label: string; run: () => void };
type Toast = { id: number; message: string; icon: IconName; leaving: boolean; action?: ToastAction };

const ToastContext = createContext<(message: string, icon?: IconName, action?: ToastAction) => void>(() => {});

const VISIBLE_MS = 3500;
/** Met een knop blijft ze langer staan, om er nog bij te kunnen. */
const ACTION_MS = 7000;
const LEAVE_MS = 250;

/** Korte bevestiging onderaan ("Opgeslagen"), die vanzelf weer wegschuift. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);

  const show = useCallback((message: string, icon: IconName = "check", action?: ToastAction) => {
    const id = nextId.current++;
    const visible = action ? ACTION_MS : VISIBLE_MS;
    // Hooguit drie tegelijk; de oudste maakt plaats.
    setToasts((list) => [...list.slice(-2), { id, message, icon, leaving: false, action }]);
    setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), visible);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), visible + LEAVE_MS);
  }, []);

  return (
    <ToastContext value={show}>
      {children}
      <div className="toaster" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.leaving ? "leaving" : ""}`} data-icon={t.icon}>
            <span className="toast-badge">
              <Icon name={t.icon} size={12} className="toast-icon" />
            </span>
            {t.message}
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Sluiten">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
