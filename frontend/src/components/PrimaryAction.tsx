import { useEffect } from "react";
import { useLatest } from "../lib/hooks";
import { tg } from "../lib/telegram";
import { Button } from "./ui";

/** Высота нижней панели вкладок (Layout): кнопка в браузере закрепляется над ней, а не под ней. */
const TAB_BAR = "60px";

/**
 * Окно после принятого нажатия, в которое повторные нажатия отбрасываются. MainButton стоит на месте, а её действие
 * меняется за несколько миллисекунд: без окна второй тап двойного нажатия выполнил бы уже следующее действие
 * (отправил заявку, минуя форму; закрыл задачу без результата). Общее для всех экранов.
 */
const REPEAT_GUARD_MS = 500;
let lastAcceptedAt = -Infinity;

function acceptPress(): boolean {
  const now = Date.now();
  if (now - lastAcceptedAt < REPEAT_GUARD_MS) return false;
  lastAcceptedAt = now;
  return true;
}

/**
 * Главное действие экрана. В Telegram — нативная MainButton (внизу окна), в браузере — закреплённая красная кнопка.
 * Повторные нажатия игнорируются, пока действие выполняется или недоступно, и в течение REPEAT_GUARD_MS после принятого.
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
      if (!acceptPress()) return;
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
      // Сначала прогресс, потом параметры: hideProgress() в SDK включает неактивную кнопку (isActive = true),
      // поэтому последним в Telegram должно уйти is_active из setParams. Без прогресса hideProgress не зовём вовсе.
      if (loading) mb.showProgress(false);
      else if (mb.isProgressVisible) mb.hideProgress();
      mb.setParams({ text, is_visible: true, is_active: !disabled && !loading, color: "#EF3124", text_color: "#FFFFFF" });
    } catch {
      /* старый клиент — без прогресса */
    }
  }, [mb, text, disabled, loading]);

  useEffect(
    () => () => {
      try {
        // Сначала прячем: у скрытой кнопки hideProgress() ничего не отправляет в Telegram (без мигания активной)
        mb?.hide();
        if (mb?.isProgressVisible) mb.hideProgress();
      } catch {
        /* ignore */
      }
    },
    [mb],
  );

  if (mb) return null;
  // Общий нижний отступ (index.css): на Android WebView env() = 0, высоту полоски «домой» даёт только Telegram
  const safe = "var(--app-bottom, 0px)";
  const press = () => {
    if (disabled || loading || !acceptPress()) return;
    onClick();
  };
  return (
    <div
      className="sticky z-20 -mx-4 mt-4 bg-bg px-4 pb-3 pt-3"
      style={{ bottom: aboveTabBar ? `calc(${TAB_BAR} + ${safe})` : `calc(${safe})` }}
    >
      <Button block size="lg" onClick={press} disabled={disabled} loading={loading}>
        {text}
      </Button>
    </div>
  );
}
