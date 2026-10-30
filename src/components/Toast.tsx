import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Toast = { id: number; message: string; icon: IconName; leaving: boolean };

const ToastContext = createContext<(message: string, icon?: IconName) => void>(() => {});

const VISIBLE_MS = 3500;
const LEAVE_MS = 250;

/** Korte bevestiging onderaan ("Opgeslagen"), die vanzelf weer wegschuift. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);

  const show = useCallback((message: string, icon: IconName = "check") => {
    const id = nextId.current++;
    // Hooguit drie tegelijk; de oudste maakt plaats.
    setToasts((list) => [...list.slice(-2), { id, message, icon, leaving: false }]);
    setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), VISIBLE_MS);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), VISIBLE_MS + LEAVE_MS);
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
