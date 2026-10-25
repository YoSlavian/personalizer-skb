import { Lightbulb, X } from "lucide-react";
import { useStoredState } from "../lib/hooks";

/** Короткая подсказка «как пользоваться экраном». Закрывается крестиком, состояние помнится на устройстве. */
export function Hint({ id, title = "Как пользоваться", steps }: { id: string; title?: string; steps: string[] }) {
  const [hidden, setHidden] = useStoredState<boolean>(`hint.${id}`, false);
  if (hidden) return null;
  return (
    <div className="card relative mt-4 border border-lime/60 bg-[color-mix(in_srgb,var(--lime)_12%,var(--surface))] p-4 animate-fade">
      <button type="button" aria-label="Скрыть подсказку" onClick={() => setHidden(true)}
        className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full text-hint active:bg-subtle">
        <X className="size-4" />
      </button>
      <div className="flex items-center gap-2 pr-8 text-[15px] font-medium">
        <Lightbulb className="size-4 text-brand" /> {title}
      </div>
      <ol className="mt-2 space-y-1.5">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2.5 text-[14px] leading-snug">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
