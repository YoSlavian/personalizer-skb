import { ChevronDown, Lightbulb, X } from "./icons";
import { useStoredState } from "../lib/hooks";

/**
 * Подсказка «как пользоваться экраном»: одна строка, пункты раскрываются по нажатию.
 * Не занимает экран на демо; крестик убирает её совсем (состояние помнится на устройстве).
 */
export function Hint({ id, title = "Как пользоваться", steps }: { id: string; title?: string; steps: string[] }) {
  const [hidden, setHidden] = useStoredState<boolean>(`hint.${id}`, false);
  if (hidden) return null;
  return (
    <details className="group card mt-4 animate-fade">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2.5 pl-3 pr-2 text-[14px] font-medium">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lime text-ink"><Lightbulb className="size-4" weight="fill" /></span>
        <span className="min-w-0 flex-1">{title}</span>
        <ChevronDown className="size-4 shrink-0 text-hint transition-transform group-open:rotate-180" />
        {/* Зона нажатия 44 px; отрицательные поля держат высоту строки прежней */}
        <button type="button" aria-label="Скрыть подсказку" onClick={(e) => { e.preventDefault(); setHidden(true); }}
          className="-my-2 -mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-hint active:bg-subtle">
          <X className="size-4" />
        </button>
      </summary>
      {/* Короткие строки без нумерации — не инструкция «шаг 1 / шаг 2», а памятка */}
      <ul className="space-y-1 pb-3.5 pl-[50px] pr-4">
        {steps.map((s) => (
          <li key={s} className="relative text-[14px] leading-snug before:absolute before:-left-3 before:top-[0.6em] before:size-1 before:rounded-full before:bg-hint before:content-['']">
            {s}
          </li>
        ))}
      </ul>
    </details>
  );
}
