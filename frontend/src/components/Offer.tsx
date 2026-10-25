import { ArrowRight, ChevronDown, EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { VisualData } from "../lib/types";
import { cx } from "./ui";

const BG: Record<string, string> = {
  season: "#EF3124",
  growth: "#2B72FE",
  truck: "#0B0B0B",
  invoice: "#6F2AFF",
  fx: "#0B0B0B",
  deposit: "#2B72FE",
  sync: "#6F2AFF",
  group: "#EF3124",
};
const MONTHS = ["Я", "Ф", "М", "А", "М", "И", "И", "А", "С", "О", "Н", "Д"];

/** Визуал баннера, собранный из данных клиента (визуал по ОКВЭД, обороты, структура группы). Перенесён из прототипа команды. */
export function OfferVisual({ data, className = "" }: { data: VisualData; className?: string }) {
  const type = data.type;
  let g: ReactNode = null;
  if (type === "season") {
    const vals = data.months ?? [0.3, 0.3, 0.5, 0.8, 0.9, 0.6, 0.4, 0.4, 0.7, 0.9, 0.5, 0.3];
    const peak = data.peak_index ?? 4;
    g = vals.map((v, i) => {
      const h = Math.max(8, v * 100);
      const x = 8 + i * 27;
      const near = i === (peak + 11) % 12 || i === (peak + 10) % 12;
      return (
        <g key={i}>
          <rect x={x} y={112 - h} width={19} height={h} rx={5} fill={i === peak ? "#A9F000" : near ? "#fff" : "rgba(255,255,255,.45)"} />
          <text x={x + 9.5} y={132} fill="#fff" fontSize={12} textAnchor="middle">{MONTHS[i]}</text>
        </g>
      );
    });
  } else if (type === "group") {
    const ents = data.entities ?? [];
    const cx = [60, 170, 275, 320];
    g = (
      <>
        <path d="M90 75 H140 M200 75 H245" stroke="#fff" strokeWidth={3} strokeDasharray="6 6" />
        {ents.slice(0, 3).map((e, i) => (
          <g key={i}>
            <circle cx={cx[i]} cy={75} r={18 + e.share * 0.45} fill={e.balance === "credit" ? "#0B0B0B" : "#A9F000"} />
            <text x={cx[i]} y={80} textAnchor="middle" fontSize={14} fontWeight={700} fill={e.balance === "credit" ? "#fff" : "#000"}>{e.share}%</text>
          </g>
        ))}
      </>
    );
  } else if (type === "fx") {
    g = (
      <>
        <circle cx={100} cy={75} r={44} fill="#EF3124" />
        <text x={100} y={89} textAnchor="middle" fontSize={42} fontWeight={700} fill="#fff">₽</text>
        <circle cx={240} cy={75} r={44} fill="#A9F000" />
        <text x={240} y={89} textAnchor="middle" fontSize={42} fontWeight={700} fill="#000">$</text>
        <path d="M148 62 H192 l-10 -8 M192 88 H148 l10 8" stroke="#fff" strokeWidth={4} fill="none" />
      </>
    );
  } else if (type === "deposit") {
    g = (
      <>
        <polyline points="10,120 70,104 130,98 190,80 250,62 320,36" fill="none" stroke="#A9F000" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={320} cy={36} r={10} fill="#fff" />
      </>
    );
  } else if (type === "sync") {
    g = (
      <>
        <rect x={20} y={40} width={110} height={70} rx={12} fill="#fff" />
        <text x={75} y={81} textAnchor="middle" fontSize={17} fontWeight={700} fill="#0B0B0B">Банк</text>
        <rect x={210} y={40} width={110} height={70} rx={12} fill="#A9F000" />
        <text x={265} y={81} textAnchor="middle" fontSize={17} fontWeight={700} fill="#0B0B0B">Учёт</text>
        <path d="M140 64 H200 M200 86 H140" stroke="#fff" strokeWidth={4} />
      </>
    );
  } else if (type === "truck") {
    g = (
      <>
        <rect x={30} y={44} width={170} height={62} rx={8} fill="#fff" />
        <rect x={206} y={62} width={80} height={44} rx={8} fill="#A9F000" />
        <circle cx={75} cy={112} r={15} fill="#EF3124" />
        <circle cx={245} cy={112} r={15} fill="#EF3124" />
      </>
    );
  } else if (type === "invoice") {
    g = (
      <>
        <rect x={40} y={22} width={110} height={106} rx={10} fill="#fff" />
        <path d="M58 50 H132 M58 72 H132 M58 94 H110" stroke="#ccc" strokeWidth={6} />
        <circle cx={245} cy={75} r={44} fill="#A9F000" />
        <text x={245} y={82} textAnchor="middle" fontSize={18} fontWeight={700} fill="#0B0B0B">сразу</text>
      </>
    );
  } else {
    g = <polyline points="10,120 90,96 170,78 250,52 320,28" fill="none" stroke="#A9F000" strokeWidth={7} strokeLinecap="round" />;
  }
  return (
    <div className={cx("relative overflow-hidden text-white", className)} style={{ background: BG[type] ?? "#EF3124" }} aria-hidden>
      <div className="absolute left-4 top-3 z-10">
        <div className="font-display text-[26px] leading-none">{data.big}</div>
        <div className="mt-1 text-[12px] opacity-90">{data.small}</div>
        {data.note && <div className="mt-0.5 text-[11px] opacity-70">{data.note}</div>}
      </div>
      <svg viewBox="0 0 340 150" preserveAspectRatio="xMaxYMax meet" xmlns="http://www.w3.org/2000/svg"
        className={cx("absolute bottom-2 right-2", type === "season" ? "h-[78%] w-[96%]" : "h-[66%] w-[62%]")}>
        {g}
      </svg>
    </div>
  );
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
}) {
  const [showWhy, setShowWhy] = useState(false);
  return (
    <article className="card overflow-hidden animate-fade-up">
      <OfferVisual data={visual} className="h-[150px]" />
      <div className="p-4">
        <div className="text-[12px] font-medium uppercase tracking-wide text-brand">{kicker}</div>
        <h3 className="mt-1 font-display text-[21px] leading-[1.15]">{headline}</h3>
        <p className="mt-2 text-[15px] text-hint">{body}</p>
        {onCta && (
          <button type="button" onClick={onCta} disabled={ctaBusy}
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-brand px-4 font-medium text-white active:bg-brand-press disabled:opacity-60">
            {cta} <ArrowRight className="size-4" />
          </button>
        )}
        {(why || onHide) && (
          <div className="mt-3 flex items-center gap-4 text-[13px]">
            {why && (
              <button type="button" onClick={() => setShowWhy((v) => !v)} aria-expanded={showWhy} className="inline-flex items-center gap-1 text-hint">
                Почему я это вижу <ChevronDown className={cx("size-3.5 transition-transform", showWhy && "rotate-180")} />
              </button>
            )}
            {onHide && (
              <button type="button" onClick={onHide} className="ml-auto inline-flex items-center gap-1 text-hint">
                <EyeOff className="size-3.5" /> Не интересно
              </button>
            )}
          </div>
        )}
        {showWhy && why && <p className="mt-2 rounded-xl bg-subtle px-3 py-2 text-[13px] animate-fade">{why}</p>}
        {footer}
      </div>
    </article>
  );
}
