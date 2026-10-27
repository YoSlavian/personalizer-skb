import { cx } from "../../components/ui";
import { dateTime } from "../../lib/format";
import type { Change } from "../../lib/types";

/**
 * История статусов: пройденные шаги — точка цвета текста, текущий — красная, ожидаемые — бледные.
 * `future` — названия ещё не наступивших шагов (необязательно).
 */
export function Timeline({ items, future = [] }: { items: Change[]; future?: string[] }) {
  const total = items.length + future.length;
  return (
    <ol className="card px-4 py-4">
      {items.map((c, i) => {
        const current = i === items.length - 1;
        return (
          <li key={c.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={current ? "step" : undefined}>
            {i < total - 1 && <span className="absolute left-[5px] top-[18px] h-[calc(100%-16px)] w-0.5 rounded-full bg-subtle-2" aria-hidden />}
            <span
              className={cx(
                "relative mt-1 size-3 shrink-0 rounded-full",
                current ? "bg-brand ring-4 ring-brand-soft" : "bg-text",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className={cx("text-[14px] leading-snug", current ? "font-medium" : "")}>{c.to_name}</div>
              <div className="mt-0.5 text-[12px] text-hint">
                {dateTime(c.created_at)}
                {c.actor ? ` · ${c.actor.full_name}` : " · система"}
              </div>
              {c.comment && <div className="mt-1.5 rounded-[14px] bg-subtle px-3 py-2 text-[13px] leading-snug">{c.comment}</div>}
            </div>
          </li>
        );
      })}
      {future.map((label, i) => (
        <li key={`f-${label}`} className="relative flex gap-3 pb-4 last:pb-0">
          {items.length + i < total - 1 && <span className="absolute left-[5px] top-[18px] h-[calc(100%-16px)] w-0.5 rounded-full bg-subtle" aria-hidden />}
          <span className="relative mt-1 size-3 shrink-0 rounded-full border-2 border-subtle-2 bg-surface" aria-hidden />
          <div className="min-w-0 flex-1 text-[14px] leading-snug text-hint">{label}</div>
        </li>
      ))}
    </ol>
  );
}
