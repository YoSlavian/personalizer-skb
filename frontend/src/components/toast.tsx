import { CheckCircle2, Info, XCircle } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { tg } from "../lib/telegram";
import { cx } from "./ui";

type Kind = "success" | "error" | "info";
type Toast = { id: number; text: string; kind: Kind };
type Ctx = { show: (text: string, kind?: Kind) => void };

const ToastCtx = createContext<Ctx>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, kind: Kind = "success") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, text, kind }]);
    tg.haptic(kind === "error" ? "error" : kind === "success" ? "success" : "light");
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 4500 : 3000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(12px+var(--tg-content-safe-area-inset-top,0px))]" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-medium text-white shadow-lg animate-fade-up",
              t.kind === "error" ? "bg-[#c62f24]" : t.kind === "info" ? "bg-ink" : "bg-[#14824c]",
            )}
          >
            {t.kind === "error" ? <XCircle className="size-4 shrink-0" /> : t.kind === "info" ? <Info className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
