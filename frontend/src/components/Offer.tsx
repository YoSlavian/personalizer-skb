import { EyeOff, Info } from "./icons";
import { type ReactNode, useState } from "react";
import type { VisualData } from "../lib/types";
import { cx } from "./ui";

/**
 * Креатив предложения в стиле «Альфа-Будущее»: чёрная (графитовая в тёмной теме) или красная карточка,
 * лайм — только метка «для вас» и пик на графике. Визуал собирается из данных клиента (обороты, группа, событие).
 */
type Tone = "creative" | "red";
// Красный — для «групповых» и «развивающих» сюжетов, чтобы лента предложений не была однотонной
const RED_TYPES = new Set(["group", "invoice", "growth"]);
const toneOf = (type: string): Tone => (RED_TYPES.has(type) ? "red" : "creative");

// Палитра графики под фон: на чёрном акцент — лайм, на красном — белый и чёрный
const PAL = {
  creative: { accent: "#A9F000", accentInk: "#0B0B0B", strong: "#FFFFFF", strongInk: "#0B0B0B", muted: "rgba(255,255,255,.22)", line: "rgba(255,255,255,.55)" },
  red: { accent: "#FFFFFF", accentInk: "#0B0B0B", strong: "#0B0B0B", strongInk: "#FFFFFF", muted: "rgba(255,255,255,.32)", line: "rgba(255,255,255,.7)" },
} as const;

function Graphic({ data, tone }: { data: VisualData; tone: Tone }) {
  const c = PAL[tone];
  const type = data.type;
  if (type === "season") {
    const vals = data.months ?? [0.3, 0.3, 0.5, 0.8, 0.9, 0.6, 0.4, 0.4, 0.7, 0.9, 0.5, 0.3];
    const peak = data.peak_index ?? 4;
    return (
      <div className="flex h-full items-end gap-[3px]">
        {vals.map((v, i) => (
          <div key={i} className="min-w-0 flex-1 rounded-[3px]" style={{ height: `${Math.max(10, v * 100)}%`, background: i === peak ? c.accent : c.muted }} />
        ))}
      </div>
    );
  }
  let g: ReactNode;
  if (type === "group") {
    const ents = data.entities ?? [];
    const xs = [40, 120, 196];
    g = (
      <>
        <path d="M58 50 H100 M140 50 H178" stroke={c.line} strokeWidth={3} strokeDasharray="5 5" />
        {ents.slice(0, 3).map((e, i) => {
          const credit = e.balance === "credit";
          return (
            <g key={i}>
              <circle cx={xs[i]} cy={50} r={14 + e.share * 0.3} fill={credit ? c.strong : "#A9F000"} />
              <text x={xs[i]} y={55} textAnchor="middle" fontSize={13} fontWeight={700} fill={credit ? c.strongInk : "#0B0B0B"}>{e.share}%</text>
            </g>
          );
        })}
      </>
    );
  } else if (type === "fx") {
    g = (
      <>
        <circle cx={58} cy={50} r={34} fill={c.muted} />
        <text x={58} y={62} textAnchor="middle" fontSize={32} fontWeight={700} fill="#fff">₽</text>
        <circle cx={172} cy={50} r={34} fill={c.accent} />
        <text x={172} y={62} textAnchor="middle" fontSize={32} fontWeight={700} fill={c.accentInk}>$</text>
        <path d="M100 40 H130 l-8 -7 M130 60 H100 l8 7" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  } else if (type === "deposit") {
    g = (
      <>
        <polyline points="8,88 60,76 104,72 148,56 190,40 222,18" fill="none" stroke={c.accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={222} cy={18} r={8} fill="#fff" />
      </>
    );
  } else if (type === "sync") {
    g = (
      <>
        <rect x={6} y={24} width={84} height={52} rx={12} fill={c.muted} />
        <text x={48} y={56} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff">Банк</text>
        <rect x={140} y={24} width={84} height={52} rx={12} fill={c.accent} />
        <text x={182} y={56} textAnchor="middle" fontSize={15} fontWeight={700} fill={c.accentInk}>Учёт</text>
        <path d="M98 42 H132 l-7 -6 M132 58 H98 l7 6" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  } else if (type === "truck") {
    g = (
      <>
        <rect x={16} y={26} width={126} height={48} rx={8} fill={c.muted} />
        <rect x={148} y={40} width={62} height={34} rx={8} fill={c.accent} />
        <circle cx={50} cy={80} r={11} fill="#fff" />
        <circle cx={178} cy={80} r={11} fill="#fff" />
      </>
    );
  } else if (type === "invoice") {
    g = (
      <>
        <rect x={20} y={8} width={84} height={84} rx={10} fill={c.muted} />
        <path d="M36 32 H88 M36 50 H88 M36 68 H72" stroke="#fff" strokeWidth={5} strokeLinecap="round" />
        <circle cx={172} cy={50} r={36} fill={c.strong} />
        <text x={172} y={56} textAnchor="middle" fontSize={15} fontWeight={700} fill={c.strongInk}>сразу</text>
      </>
    );
  } else {
    g = <polyline points="8,88 70,70 130,56 190,34 222,14" fill="none" stroke={c.accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />;
  }
  return (
    <svg viewBox="0 0 230 100" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
      {g}
    </svg>
  );
}

/** Визуал баннера: большое число + подпись слева, график по данным клиента справа. Часть карточки, без своей подложки. */
export function OfferVisual({ data, className = "", tone }: { data: VisualData; className?: string; tone?: Tone }) {
  const t = tone ?? toneOf(data.type);
  const caption = [data.small, data.note].filter(Boolean).join(" · ");
  const len = data.big?.length ?? 0;
  // Styrene A широкий: длинные слова уменьшаем, чтобы не вылезали из колонки. «Без ручного» на 22 px — 148 px, одна строка.
  const size = len <= 6 ? "text-[40px]" : len <= 8 ? "text-[32px]" : len <= 10 ? "text-[28px]" : "text-[22px]";
  const tier = len <= 6 ? 40 : len <= 8 ? 32 : len <= 10 ? 28 : 22;
  // На узких экранах (360 px) кегль ещё и ограничен шириной колонки: ≈0,68 em на знак. Без поддержки cqw остаётся класс size.
  const fit = len ? { fontSize: `min(${tier}px, ${(100 / (len * 0.68)).toFixed(2)}cqw)` } : undefined;
  return (
    <div className={cx("flex items-end gap-3", className)} aria-hidden>
      <div className="@container min-w-0 flex-1">
        {data.big && (
          <div className={cx("font-display leading-[0.95] tracking-[-0.02em] tabular", size, t === "creative" ? "text-lime" : "text-white")} style={fit}>
            {data.big}
          </div>
        )}
        {caption && <div className={cx("mt-1.5 text-[12px] leading-snug", t === "creative" ? "text-white/65" : "text-white/80")}>{caption}</div>}
      </div>
      <div className="h-[84px] w-[42%] max-w-[200px] shrink-0">
        <Graphic data={data} tone={t} />
      </div>
    </div>
  );
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/**
 * Текст под визуалом без повтора крупного числа: «До пика закупок 5 нед. Подберём лимит…» при визуале «5 нед. — до пика закупок»
 * превращается в «Подберём лимит…». Первое предложение убираем, только если оно содержит число визуала и после него есть текст.
 */
function bodyWithoutHero(body: string, big?: string): string {
  if (!big) return body;
  const m = /^(.+?[.!?])\s+(?=[«"A-ZА-ЯЁ])/.exec(body);
  if (!m) return body;
  const rest = body.slice(m[0].length).trim();
  return rest && norm(m[1]).includes(norm(big)) ? rest : body;
}

export function OfferCard({
  kicker,
  headline,
  body,
  cta,
  visual,
  why,
  onCta,
  onHide,
  ctaBusy,
  footer,
  tag = "для вас",
}: {
  kicker: string;
  headline: string;
  body: string;
  cta: string;
  visual: VisualData;
  why?: string;
  onCta?: () => void;
  onHide?: () => void;
  ctaBusy?: boolean;
  footer?: ReactNode;
  /** Метка в углу креатива; null — без метки */
  tag?: string | null;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const tone = toneOf(visual.type);
  const red = tone === "red";
  const ctaCls = cx(
    "mt-5 flex h-12 w-full items-center justify-center rounded-full px-5 text-[15px] font-medium",
    red ? "bg-white text-ink" : "bg-brand text-white",
  );
  return (
    <article className={cx("overflow-hidden rounded-[24px] p-5 text-white animate-fade-up", red ? "bg-brand" : "bg-creative")}>
      <div className="flex items-center justify-between gap-3">
        <span className={cx("line-clamp-2 min-w-0 text-[12px] font-medium leading-snug", red ? "text-white/80" : "text-white/65")}>{kicker}</span>
        {tag && <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-lime px-2.5 text-[12px] font-medium text-ink">{tag}</span>}
      </div>
      <h3 className="mt-2.5 font-display text-[22px] uppercase leading-[1.04] tracking-[-0.01em] [overflow-wrap:anywhere]">{headline}</h3>
      <OfferVisual data={visual} tone={tone} className="mt-4" />
      <p className={cx("mt-3.5 text-[15px] leading-snug", red ? "text-white/90" : "text-white/85")}>{bodyWithoutHero(body, visual.big)}</p>
      {onCta ? (
        <button type="button" onClick={onCta} disabled={ctaBusy} aria-busy={ctaBusy || undefined}
          className={cx(ctaCls, "transition-transform active:scale-[0.97] disabled:opacity-60", red ? "active:bg-white/90" : "active:bg-brand-press")}>
          {cta}
        </button>
      ) : (
        // Предпросмотр (симулятор, карточка клиента): кнопка видна как у клиента, но не нажимается
        <div className={ctaCls}>{cta}</div>
      )}
      {(why || onHide) && (
        <div className="-mb-2 mt-1 flex items-center justify-between gap-3 text-[13px]">
          {why ? (
            <button type="button" onClick={() => setShowWhy((v) => !v)} aria-expanded={showWhy}
              className={cx("-ml-1 inline-flex h-11 items-center gap-1.5 px-1 transition-colors", red ? "text-white/80 active:text-white" : "text-white/70 active:text-white")}>
              <Info className="size-4" aria-hidden />
              Почему я это вижу
            </button>
          ) : <span />}
          {onHide && (
            <button type="button" onClick={onHide}
              className={cx("-mr-1 inline-flex h-11 items-center gap-1.5 px-1 transition-colors", red ? "text-white/80 active:text-white" : "text-white/70 active:text-white")}>
              <EyeOff className="size-4" aria-hidden />
              Не интересно
            </button>
          )}
        </div>
      )}
      {showWhy && why && (
        <p className={cx("mb-1 mt-2 rounded-[14px] px-3.5 py-2.5 text-[13px] leading-snug animate-fade", red ? "bg-black/15 text-white" : "bg-white/10 text-white/85")}>{why}</p>
      )}
      {footer}
    </article>
  );
}
