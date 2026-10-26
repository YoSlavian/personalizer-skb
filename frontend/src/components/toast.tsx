import { Check, Info, XCircle } from "./icons";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { tg } from "../lib/telegram";
import { cx } from "./ui";

type Kind = "success" | "error" | "info";
type Toast = { id: number; text: string; kind: Kind };
type Ctx = { show: (text: string, kind?: Kind) => void };

const ToastCtx = createContext<Ctx>({ show: () => {} });

/**
 * Тост — инвертированная «пилюля» вверху экрана, под зоной кнопок Telegram; ошибка — красная.
 * Сверху он не перекрывает ни таббар, ни закреплённую кнопку действия, ни шторку. Нажатия проходят сквозь него.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, kind: Kind = "success") => {
    const id = ++seq.current;
    // Повтор того же тоста не копится стопкой: прежняя копия уходит, новая живёт полный срок
    setItems((xs) => [...xs.filter((x) => x.text !== text || x.kind !== kind).slice(-2), { id, text, kind }]);
    tg.haptic(kind === "error" ? "error" : kind === "success" ? "success" : "light");
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 4500 : 3000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ paddingTop: "calc(max(env(safe-area-inset-top, 0px), var(--app-top, 0px)) + 10px)" }}
        aria-live="polite"
      >
        {/* Новый тост — сверху стопки: старые сдвигаются вниз и исчезают, не дёргая свежий */}
        {[...items].reverse().map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cx(
              "flex min-h-11 max-w-md items-center gap-2.5 rounded-[22px] py-2.5 pl-3 pr-4 text-[14px] font-medium leading-snug shadow-[0_10px_30px_rgba(0,0,0,0.18)] translate-y-0 opacity-100 transition-[opacity,translate] duration-200 ease-out starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none",
              t.kind === "error" ? "bg-brand text-white" : "bg-text text-bg",
            )}
          >
            {t.kind === "error" ? (
              <XCircle className="size-5 shrink-0" weight="fill" aria-hidden />
            ) : t.kind === "info" ? (
              <Info className="size-5 shrink-0" weight="fill" aria-hidden />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-lime text-ink" aria-hidden>
                <Check className="size-3" weight="bold" />
              </span>
            )}
            <span className="min-w-0">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
