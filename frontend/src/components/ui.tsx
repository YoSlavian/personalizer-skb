import { AlertTriangle, ChevronRight, Inbox, Lock, RefreshCw, WifiOff, X } from "./icons";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../lib/api";
import { useLatest } from "../lib/hooks";
import { tg } from "../lib/telegram";
import type { AppStatus, TaskStatus } from "../lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "md", loading, block, icon, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-brand text-white active:bg-brand-press disabled:opacity-50",
    // bg-btn: в тёмной теме — непрозрачный графит, чтобы кнопка читалась на чёрном фоне страницы
    secondary: "bg-btn text-text active:bg-btn-press disabled:opacity-50",
    ghost: "bg-btn text-text active:bg-btn-press disabled:opacity-50",
    danger: "bg-btn text-danger active:bg-btn-press disabled:opacity-50",
    dark: "bg-text text-bg active:opacity-85 disabled:opacity-50",
  }[variant];
  const sizes = { sm: "h-9 px-3.5 text-[14px] rounded-full", md: "h-11 px-5 text-[15px] rounded-full", lg: "h-[52px] px-6 text-[16px] rounded-full" }[size];
  return (
    <button
      type="button"
      className={cx("inline-flex items-center justify-center gap-2 font-medium transition-[transform,opacity,background-color] duration-150 active:scale-[0.97] select-none", styles, sizes, block && "w-full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx("card block w-full text-left transition-transform active:scale-[0.99]", className)}>
        {children}
      </button>
    );
  }
  return <div className={cx("card", className)}>{children}</div>;
}

export function Section({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-5", className)}>
      {(title || action) && (
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
          {title && <h2 className="font-display text-[15px] uppercase leading-tight tracking-[-0.01em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({
  title,
  subtitle,
  left,
  right,
  onClick,
  chevron = !!onClick,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const inner = (
    <>
      {left && <div className="shrink-0">{left}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 line-clamp-2 text-[13px] text-hint">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-hint" aria-hidden />}
    </>
  );
  const base = cx("flex w-full items-center gap-3 px-4 py-3 text-left", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(base, "transition-colors active:bg-subtle")}>
      {inner}
    </button>
  ) : (
    <div className={base}>{inner}</div>
  );
}

export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cx("card divide-y divide-sep overflow-hidden", className)}>{children}</div>;
}

const APP_STATUS: Record<AppStatus, { label: string; cls: string }> = {
  draft: { label: "Черновик", cls: "bg-subtle text-hint" },
  submitted: { label: "Отправлена", cls: "bg-text text-bg" },
  in_review: { label: "На рассмотрении", cls: "bg-subtle text-text" },
  // Нужен ответ клиента — ключевой сигнал, красная плашка (белый на #ef3124 = 4.7:1); «Отказ» — мягкая красная
  needs_info: { label: "Нужны уточнения", cls: "bg-brand text-white" },
  approved: { label: "Одобрена", cls: "bg-lime text-ink" },
  declined: { label: "Отказ", cls: "bg-brand-soft text-brand" },
  cancelled: { label: "Отменена", cls: "bg-subtle text-hint" },
};

export function StatusPill({ status }: { status: AppStatus }) {
  const s = APP_STATUS[status];
  return <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap", s.cls)}>{s.label}</span>;
}

const TASK_STATUS: Record<TaskStatus, { label: string; cls: string }> = {
  open: { label: "Новая", cls: "bg-text text-bg" },
  in_progress: { label: "В работе", cls: "bg-subtle text-text" },
  done: { label: "Выполнена", cls: "bg-lime text-ink" },
  cancelled: { label: "Отменена", cls: "bg-subtle text-hint" },
};

export function TaskPill({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap", s.cls)}>{s.label}</span>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "lime" | "violet" | "blue" }) {
  const cls = {
    neutral: "bg-subtle text-hint",
    brand: "bg-brand-soft text-brand",
    lime: "bg-lime text-ink",
    violet: "bg-text text-bg",
    blue: "bg-subtle text-text",
  }[tone];
  return <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap", cls)}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-sep overflow-hidden" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {/* Как в Row с IconBadge: плитка 40×40, радиус 14 — строки не прыгают после загрузки */}
          <Skeleton className="size-10 shrink-0 rounded-[14px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center animate-fade">
      <div className="mb-3 flex size-12 items-center justify-center rounded-[16px] bg-subtle text-hint">{icon ?? <Inbox className="size-6" />}</div>
      <div className="text-[16px] font-medium">{title}</div>
      {text && <p className="mt-1 max-w-xs text-[14px] text-hint">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function errorText(e: unknown): { title: string; text: string; icon: ReactNode } {
  if (e instanceof ApiError) {
    if (e.isNetwork) return { title: e.code === "timeout" ? "Медленное соединение" : "Нет соединения", text: e.message, icon: <WifiOff className="size-6" /> };
    if (e.status === 403) return { title: "Недостаточно прав", text: e.message, icon: <Lock className="size-6" /> };
    if (e.status === 404) return { title: "Не найдено", text: "Запись удалена или недоступна для вашей организации", icon: <Inbox className="size-6" /> };
    if (e.status >= 500) return { title: "Ошибка сервера", text: "Мы уже знаем о проблеме. Попробуйте ещё раз через минуту", icon: <AlertTriangle className="size-6" /> };
    return { title: "Не получилось", text: e.message, icon: <AlertTriangle className="size-6" /> };
  }
  return { title: "Что-то пошло не так", text: "Попробуйте ещё раз", icon: <AlertTriangle className="size-6" /> };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = errorText(error);
  const canRetry = !(error instanceof ApiError && (error.status === 403 || error.status === 404));
  return (
    <EmptyState
      icon={t.icon}
      title={t.title}
      text={t.text}
      action={
        onRetry && canRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry} icon={<RefreshCw className="size-4" />}>
            Повторить
          </Button>
        ) : undefined
      }
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="block">
      <label htmlFor={htmlFor} className="mb-1.5 block px-1 text-[13px] font-medium text-hint">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 px-1 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 px-1 text-[13px] text-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** Поле ввода. Фон задаёт класс .field (index.css): белый на фоне страницы, серый внутри карточки и шторки. */
export const inputCls =
  "field w-full rounded-[14px] border border-transparent px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-hint focus:border-brand aria-[invalid=true]:border-danger";

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-0.5 rounded-[12px] bg-btn p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-9 min-w-0 flex-1 truncate rounded-[10px] px-2 text-[14px] transition-colors",
            value === o.value ? "bg-text font-medium text-bg" : "text-text active:bg-subtle",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, ariaLabel, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string; disabled?: (v: T) => boolean }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value;
        const off = disabled?.(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-9 rounded-full px-3.5 text-[14px] transition-colors disabled:opacity-40",
              on ? "bg-brand font-medium text-white" : "bg-btn text-text active:bg-btn-press",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {description && <div className="mt-0.5 text-[13px] text-hint">{description}</div>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand" : "bg-subtle-2")}
      >
        <span className={cx("absolute left-0 top-[3px] size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[23px]" : "translate-x-[3px]")} />
      </button>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Свежий onClose без переподписки: родители передают стрелку, новую на каждый рендер, и эффект
  // перезапускался бы при каждом вводе — фокус уходил из поля в шторку после первой буквы
  const close = useLatest(onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    // Системная «Назад» Telegram сначала закрывает шторку, а не уводит с экрана под ней.
    // На корневой вкладке кнопка появляется на время показа шторки вместо «Закрыть» (Android: жест «назад»)
    const offBack = tg.pushBack(() => {
      tg.haptic("light");
      close.current();
    }, "overlay");
    return () => {
      window.removeEventListener("keydown", onKey);
      offBack();
    };
  }, [open, close]);
  if (!open) return null;
  // Портал в body: fixed-позиционирование не зависит от анимаций и transform родителей
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/40 animate-fade" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className="relative w-full max-w-lg rounded-t-[24px] bg-surface px-4 pb-safe pt-3 outline-none animate-sheet">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-subtle-2" />
        <div className="mb-3 flex items-start gap-3">
          <div className="flex-1 font-display text-[18px] uppercase leading-tight">{title}</div>
          {/* Видимый кружок 32 px, зона нажатия 44 px */}
          <button type="button" onClick={onClose} aria-label="Закрыть"
            className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-hint before:absolute before:-inset-1.5 before:content-['']">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// Два акцента на всё приложение: ошибки и «требует внимания» — красные (warn = brand), успех — нейтральная плашка
// с лаймовой меткой-кружком у иконки. Никаких жёлтых/зелёных оттенков.
export function Banner({ tone = "info", children, icon }: { tone?: "info" | "warn" | "success" | "brand"; children: ReactNode; icon?: ReactNode }) {
  const cls = {
    info: "bg-surface text-text",
    warn: "bg-brand-soft text-text",
    success: "bg-surface text-text",
    brand: "bg-brand-soft text-text",
  }[tone];
  const iconCls = {
    info: "mt-0.5",
    warn: "mt-0.5 text-brand",
    success: "-my-0.5 flex size-6 items-center justify-center rounded-full bg-lime text-ink",
    brand: "mt-0.5 text-brand",
  }[tone];
  return (
    <div className={cx("flex gap-3 rounded-[18px] px-4 py-3 text-[14px]", cls)}>
      {icon && <div className={cx("shrink-0", iconCls)}>{icon}</div>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "brand" | "good" | "bad" }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] text-hint">{label}</div>
      {/* tone="good" — без цвета: лайм на белом нечитаем, зелёного в палитре нет */}
      <div className={cx("mt-1 font-display text-[22px] leading-tight tabular", tone === "brand" && "text-brand", tone === "bad" && "text-danger")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-hint">{hint}</div>}
    </div>
  );
}

export function IconBadge({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "violet" | "blue" | "lime" | "neutral" }) {
  const cls = {
    brand: "bg-brand text-white",
    violet: "bg-subtle text-text",
    blue: "bg-subtle text-text",
    lime: "bg-lime text-ink",
    neutral: "bg-subtle text-text",
  }[tone];
  return <div className={cx("flex size-10 items-center justify-center rounded-[14px]", cls)}>{children}</div>;
}
