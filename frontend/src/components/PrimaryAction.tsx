import { useEffect } from "react";
import { useLatest } from "../lib/hooks";
import { tg } from "../lib/telegram";
import { Button } from "./ui";

/**
 * Главное действие экрана. В Telegram — нативная MainButton (внизу окна), в браузере — закреплённая кнопка.
 * Повторные нажатия игнорируются, пока действие выполняется или недоступно.
 */
export function PrimaryAction({ text, onClick, disabled, loading }: { text: string; onClick: () => void; disabled?: boolean; loading?: boolean }) {
  const mb = tg.mainButton();
  const cb = useLatest({ onClick, disabled, loading });

  useEffect(() => {
    if (!mb) return;
    const handler = () => {
      const s = cb.current;
      if (s.disabled || s.loading) return;
      tg.haptic("light");
      s.onClick();
    };
    mb.onClick(handler);
    return () => {
      mb.offClick(handler);
    };
  }, [mb, cb]);

  useEffect(() => {
    if (!mb) return;
    try {
      mb.setParams({ text, is_visible: true, is_active: !disabled && !loading, color: "#EF3124", text_color: "#FFFFFF" });
      if (loading) mb.showProgress(false);
      else mb.hideProgress();
    } catch {
      /* старый клиент — без прогресса */
    }
  }, [mb, text, disabled, loading]);

  useEffect(
    () => () => {
      try {
        mb?.hideProgress();
        mb?.hide();
      } catch {
        /* ignore */
      }
    },
    [mb],
  );

  if (mb) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pb-safe pt-3">
      <Button block size="lg" onClick={onClick} disabled={disabled} loading={loading} className="mb-3">
        {text}
      </Button>
    </div>
  );
}
