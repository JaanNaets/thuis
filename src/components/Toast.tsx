import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Toast = { id: number; message: string; icon: IconName; leaving: boolean };

const ToastContext = createContext<(message: string, icon?: IconName) => void>(() => {});

const VISIBLE_MS = 2600;
const LEAVE_MS = 250;

/** Korte bevestiging onderaan ("Opgeslagen"), die vanzelf weer wegschuift. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

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
          <div key={t.id} className={`toast ${t.leaving ? "leaving" : ""}`}>
            <span className="toast-icon">
              <Icon name={t.icon} size={14} />
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
