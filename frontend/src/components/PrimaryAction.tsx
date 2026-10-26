import { useEffect } from "react";
import { useLatest } from "../lib/hooks";
import { tg } from "../lib/telegram";
import { Button } from "./ui";

/** Высота нижней панели вкладок (Layout): кнопка в браузере закрепляется над ней, а не под ней. */
const TAB_BAR = "60px";

/**
 * Главное действие экрана. В Telegram — нативная MainButton (внизу окна), в браузере — закреплённая красная кнопка.
 * Повторные нажатия игнорируются, пока действие выполняется или недоступно.
 */
export function PrimaryAction({
  text,
  onClick,
  disabled,
  loading,
  aboveTabBar = true,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  aboveTabBar?: boolean;
}) {
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
  const safe = "env(safe-area-inset-bottom, 0px) + var(--tg-content-safe-area-inset-bottom, 0px)";
  return (
    <div
      className="sticky z-20 -mx-4 mt-4 bg-bg px-4 pb-3 pt-3"
      style={{ bottom: aboveTabBar ? `calc(${TAB_BAR} + ${safe})` : `calc(${safe})` }}
    >
      <Button block size="lg" onClick={onClick} disabled={disabled} loading={loading}>
        {text}
      </Button>
    </div>
  );
}
