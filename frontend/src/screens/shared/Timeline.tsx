import { cx } from "../../components/ui";
import { dateTime } from "../../lib/format";
import type { Change } from "../../lib/types";

export function Timeline({ items }: { items: Change[] }) {
  return (
    <ol className="card px-4 py-3">
      {items.map((c, i) => (
        <li key={c.id} className="relative flex gap-3 pb-3 last:pb-0">
          {i < items.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-sep" aria-hidden />}
          <span className={cx("mt-1.5 size-[11px] shrink-0 rounded-full border-2", i === items.length - 1 ? "border-brand bg-brand" : "border-hint bg-surface")} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">{c.to_name}</div>
            <div className="text-[12px] text-hint">{dateTime(c.created_at)}{c.actor ? ` · ${c.actor.full_name}` : " · система"}</div>
            {c.comment && <div className="mt-1 rounded-xl bg-subtle px-3 py-2 text-[13px]">{c.comment}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
