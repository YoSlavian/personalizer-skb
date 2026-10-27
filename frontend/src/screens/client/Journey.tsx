import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bank, Coins, PiggyBank, Receipt } from "@phosphor-icons/react";
import { BarChart3, Building2, Check, ChevronLeft, ChevronRight, Clock, GitCompare, type IconType, Lightbulb, RefreshCw, Truck, X, Zap } from "../../components/icons";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth, useMe } from "../../auth/AuthProvider";
import { ThemeButton } from "../../components/Layout";
import { PrimaryAction } from "../../components/PrimaryAction";
import { useToast } from "../../components/toast";
import { Banner, Button, Chips, cx, ErrorState, Field, IconBadge, inputCls, Segmented, Skeleton, Tag } from "../../components/ui";
import { ApiError, get, newIdempotencyKey, patch, post } from "../../lib/api";
import { annuity, DEMO_RATES, mln, money, plural } from "../../lib/format";
import { useClosingConfirmation, useLatest } from "../../lib/hooks";
import { tg } from "../../lib/telegram";
import type { Adaptation, ApplicationDetail, CabinetHome, JourneySession, Showcase } from "../../lib/types";

type Step = "showcase" | "calc" | "form" | "done";

const PRODUCT_INFO: Record<string, { purpose: string; speed: string; how: string }> = {
  working: { purpose: "Закупки и текущие расходы", speed: "Решение за 1–2 дня", how: "Онлайн-заявка" },
  concession: { purpose: "Развитие по госпрограмме", speed: "Проверка 2–3 дня", how: "Онлайн-заявка" },
  leasing: { purpose: "Техника и транспорт", speed: "Решение за 2–3 дня", how: "Онлайн + менеджер" },
  factoring: { purpose: "Отсрочка покупателям", speed: "Лимит за 3 дня", how: "Онлайн-заявка" },
  deposit: { purpose: "Доход на свободные деньги", speed: "Сразу", how: "Онлайн" },
};
const NAMES: Record<string, string> = {
  working: "Оборотный кредит", concession: "Льготный кредит", project: "Проектное финансирование", leasing: "Лизинг", factoring: "Факторинг",
  ved: "ВЭД: конвертация и валютный контроль", deposit: "Депозит для свободных остатков", digital: "Интеграция с учётной системой",
  pool: "Единый остаток группы (cash pooling)", glimit: "Общий кредитный лимит группы", syndic: "Синдицированный кредит или облигации",
};
/** Творительный падеж для «Сравнить с …». */
const INSTR: Record<string, string> = {
  working: "оборотным кредитом", concession: "льготным кредитом", project: "проектным финансированием",
  leasing: "лизингом", factoring: "факторингом", deposit: "депозитом",
};
/** Сравниваем продукт с близким по смыслу: финансирование — с финансированием, размещение — с размещением. */
const FINANCING = new Set(["working", "concession", "project", "leasing", "factoring"]);
const kindOf = (code: string) => (code === "deposit" ? "deposit" : FINANCING.has(code) ? "financing" : "other");
const ICONS: Record<string, IconType> = { working: Coins, concession: Bank, leasing: Truck, factoring: Receipt, deposit: PiggyBank };
export const CALCULABLE = new Set(["working", "concession", "leasing", "factoring", "deposit"]);
const TERMS: Record<string, number[]> = { working: [6, 12, 24, 36], concession: [12, 24, 36], leasing: [12, 24, 36, 48], factoring: [1, 2, 3, 4], deposit: [3, 6, 12] };
const STEPS: { key: Step; label: string }[] = [
  { key: "showcase", label: "Витрина" },
  { key: "calc", label: "Расчёт" },
  { key: "form", label: "Заявка" },
];

/** Крупные суммы — в миллионах, мелкие — в рублях. */
function compact(rub: number): string {
  return Math.abs(rub) >= 1e6 ? mln(rub) : money(rub);
}

function calcSummary(product: string, amountMln: number, term: number): { label: string; main: string; label2: string; value2: string } {
  const r = DEMO_RATES[product];
  const amount = amountMln * 1e6;
  if (!r) return { label: "Объём", main: mln(amount), label2: "Условия", value2: "у менеджера" };
  const rate = `${(r.rate * 100).toFixed(1).replace(".", ",")}%`;
  if (r.kind === "deposit") {
    return { label: `Доход за ${term} мес.`, main: compact(Math.round((amount * r.rate * term) / 12)), label2: r.label, value2: rate };
  }
  if (r.kind === "factoring") {
    const fee = Math.round((amount * r.rate * term) / 12);
    return { label: "Получите сразу, 90%", main: compact(Math.round(amount * 0.9)), label2: `Комиссия за ${term * 30} дн.`, value2: compact(fee) };
  }
  const principal = r.kind === "leasing" ? amount * 0.9 : amount;
  return {
    label: r.kind === "leasing" ? "Лизинговый платёж" : "Ежемесячный платёж",
    main: compact(Math.round(annuity(principal, term, r.rate))),
    label2: r.label,
    value2: rate,
  };
}

function duration(sec: number): string {
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} мин ${s} с` : `${m} мин`;
}

/** Шаги пути — пилюли, соединённые тонкой линией: пройденный — с галочкой, текущий — инвертированный, будущий — бледный. */
function Stepper({ index, onPick }: { index: number; onPick?: (step: Step) => void }) {
  return (
    <ol className="flex min-w-0 flex-1 items-center" aria-label="Шаги">
      {STEPS.map((s, i) => {
        const done = i < index;
        const current = i === index;
        const pill = cx(
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] whitespace-nowrap",
          current ? "bg-text font-medium text-bg" : done ? "bg-surface text-text" : "text-hint ring-1 ring-inset ring-subtle-2",
        );
        const content = (
          <>
            {done ? <Check className="size-3.5" weight="bold" aria-hidden /> : <span className="tabular">{i + 1}</span>}
            {s.label}
          </>
        );
        return (
          <li key={s.key} className={cx("flex items-center", i > 0 && "flex-1")} aria-current={current ? "step" : undefined}>
            {i > 0 && <span className={cx("mx-1 h-px min-w-2 flex-1", i <= index ? "bg-text/35" : "bg-subtle-2")} aria-hidden />}
            {done && onPick ? (
              <button type="button" onClick={() => onPick(s.key)}
                className={cx(pill, "relative transition-transform active:scale-[0.97] before:absolute before:inset-x-0 before:-inset-y-1.5")}>
                {content}
              </button>
            ) : (
              <span className={pill}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Ползунок суммы: красная заливка до бегунка (своя дорожка под прозрачной нативной). */
function AmountRange({ id, min, max, step, value, onChange, valueText }: { id: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; valueText: string }) {
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return (
    <div className="relative mt-3 h-7">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-subtle-2" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `calc(13px + (100% - 26px) * ${frac})` }} />
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        className="relative block [&::-moz-range-track]:bg-transparent! [&::-webkit-slider-runnable-track]:bg-transparent!" />
    </div>
  );
}

function HintChip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex min-h-9 items-center rounded-full bg-subtle px-3.5 py-1.5 text-left text-[14px] font-medium leading-snug transition-[transform,background-color] active:scale-[0.97] active:bg-subtle-2">
      {children}
    </button>
  );
}

export function Journey() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const { inTelegram } = useAuth();
  const draftId = params.get("draft") ? Number(params.get("draft")) : null;
  const offerId = params.get("offer") ? Number(params.get("offer")) : null;
  const initialProduct = params.get("product") ?? "working";

  const [product, setProduct] = useState(initialProduct);
  // Персональное предложение с главной уже выбрало продукт — сразу расчёт; витрина остаётся шагом «Назад» и для сравнения.
  // Ссылки из бота и push несут только offer, без product: для них витрина, чтобы не открыть расчёт чужого продукта
  const [step, setStep] = useState<Step>(
    draftId ? "form" : !CALCULABLE.has(initialProduct) ? "form" : offerId && params.has("product") ? "calc" : "showcase",
  );
  const [session, setSession] = useState<JourneySession | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const [amountMln, setAmountMln] = useState(20);
  const [term, setTerm] = useState(TERMS[initialProduct]?.[1] ?? 12);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ApplicationDetail | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [hintReason, setHintReason] = useState<string | undefined>(undefined);
  const [showMetrics, setShowMetrics] = useState(false);
  // Клиент сам попросил сравнение — блок «Коротко» показываем сразу, не дожидаясь порога возвратов на сервере
  const [compareForced, setCompareForced] = useState(false);
  const idemKey = useRef(newIdempotencyKey());
  const started = useRef(false);
  const startedAt = useRef(Date.now());
  const idleSent = useRef(false);
  const hintRef = useRef<HTMLElement>(null);

  const showcase = useQuery({ queryKey: ["showcase", initialProduct], queryFn: () => get<Showcase>(`/cabinet/showcase?product=${encodeURIComponent(initialProduct)}`),
    // В калькуляторе витрина нужна для подсказки «Сравнить с …», даже если клиент пришёл сразу на расчёт
    enabled: step === "showcase" || step === "calc" });
  const draft = useQuery({ queryKey: ["application", draftId], queryFn: () => get<ApplicationDetail>(`/applications/${draftId}`), enabled: !!draftId });
  const home = useQuery({ queryKey: ["cabinet-home"], queryFn: () => get<CabinetHome>("/cabinet/home"), staleTime: 60_000 });

  useEffect(() => {
    if (draft.data) {
      setProduct(draft.data.product_code);
      setAmountMln(Math.max(1, Math.round(draft.data.amount_rub / 1e6)));
      setTerm(draft.data.term_months);
      setComment(draft.data.comment ?? "");
    }
  }, [draft.data]);

  // Сессия пути: сервер считает сигналы и решает, какие адаптации показать
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    post<JourneySession>("/cabinet/journey", { product_code: initialProduct, communication_id: offerId, source: inTelegram ? "miniapp" : "web" })
      .then(setSession)
      .catch(setStartError);
  }, [initialProduct, offerId, inTelegram]);

  const sessionRef = useLatest(session);
  const sendEvent = useCallback(
    async (kind: string, extra: { screen?: string; action?: string; meta?: Record<string, unknown> } = {}) => {
      const s = sessionRef.current;
      if (!s) return null;
      try {
        const next = await post<JourneySession>(`/cabinet/journey/${s.id}/events`, { kind, ...extra });
        setSession((prev) => ({ ...next, config: prev?.config ?? next.config }));
        if (next.message) toast.show(next.message, "info");
        const hint = next.new.find((a) => a.type === "hint_sheet");
        if (hint) {
          tg.haptic("warning");
          setHintReason(hint.reason);
          setHintOpen(true);
        }
        return next;
      } catch {
        return null; // аналитика пути не должна мешать клиенту
      }
    },
    [sessionRef, toast],
  );

  // Каждый показ шага — событие пути
  const sessionId = session?.id;
  useEffect(() => {
    if (sessionId && step !== "done") void sendEvent("view", { screen: step });
  }, [sessionId, step, sendEvent]);

  const active = useMemo(() => new Set((session?.active ?? []).map((a: Adaptation) => a.type)), [session]);
  const hintVariant = session?.active.find((a) => a.type === "hint_sheet")?.variant ?? "ask_manager";
  const meta = { amount_rub: amountMln * 1e6, term_months: term };

  // Пауза в калькуляторе → событие idle (сервер сверяет время по своим часам)
  const idleSeconds = session?.config?.idle_seconds ?? 8;
  const touch = useRef(0);
  const [, bump] = useState(0);
  const poke = () => {
    touch.current += 1;
    idleSent.current = false;
    bump((x) => x + 1);
  };
  useEffect(() => {
    // Пришёл из предложения сразу в расчёт — паузу считаем после первого действия, а не с открытия экрана
    if (step !== "calc" || !session || (offerId && touch.current === 0)) return;
    const t = window.setTimeout(() => {
      if (!idleSent.current) {
        idleSent.current = true;
        void sendEvent("idle", { meta });
      }
    }, idleSeconds * 1000);
    return () => window.clearTimeout(t);
  }, [step, session?.id, touch.current, idleSeconds]);

  // Уход с незавершённой формы → черновик на сервере
  const stepRef = useLatest({ step, result, meta });
  useEffect(
    () => () => {
      const s = stepRef.current;
      if (s.step === "form" && !s.result && sessionRef.current) {
        void post(`/cabinet/journey/${sessionRef.current.id}/events`, { kind: "form_leave", meta: s.meta }).catch(() => {});
      }
    },
    [stepRef, sessionRef],
  );

  useClosingConfirmation(step === "form" && !result && (comment.length > 0 || !!draftId));

  const goBack = useCallback(() => {
    tg.haptic("light");
    if (step === "form" && CALCULABLE.has(product) && !draftId) setStep("calc");
    else if (step === "calc") setStep("showcase");
    else {
      // Путь открыт первым экраном (пуш бота с ?route=, прямая ссылка): своей записи истории до него нет —
      // navigate(-1) ничего не делает или уводит из приложения. idx ведёт сам react-router и после replace в DeepLink он 0.
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
      else navigate("/", { replace: true });
    }
  }, [step, product, draftId, navigate]);
  // После отправки «назад» ведёт на главную, а не обратно в отправленную форму (и не закрывает приложение на Android)
  const goHome = useCallback(() => {
    tg.haptic("light");
    navigate("/", { replace: true });
  }, [navigate]);
  useEffect(() => tg.backButton(step === "done" ? goHome : goBack), [goBack, goHome, step]);

  // Новый шаг открывается сверху: шаги, заголовок и сравнение не остаются за краем экрана
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    document.scrollingElement?.scrollTo?.({ top: 0 });
  }, [step]);

  // Подсказка появляется под калькулятором — прокручиваем к ней, чтобы её заметили
  const hintVisible = hintOpen && step === "calc";
  useEffect(() => {
    if (hintVisible) hintRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [hintVisible]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      let app: ApplicationDetail;
      if (draftId) {
        await patch(`/applications/${draftId}`, { amount_rub: amountMln * 1e6, term_months: term, comment: comment || null });
        app = await post<ApplicationDetail>(`/applications/${draftId}/status`, { status: "submitted", journey_session_id: session?.id ?? null });
      } else {
        app = await post<ApplicationDetail>(
          "/applications",
          { product_code: product, amount_rub: amountMln * 1e6, term_months: term, comment: comment || null, source: inTelegram ? "miniapp" : "web",
            communication_id: offerId, journey_session_id: session?.id ?? null },
          { idempotencyKey: idemKey.current },
        );
      }
      setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
      setResult(app);
      setStep("done");
      tg.haptic("success");
      void qc.invalidateQueries({ queryKey: ["cabinet-home"] });
      void qc.invalidateQueries({ queryKey: ["applications"] });
    } catch (e) {
      setFormError(e instanceof ApiError ? e : new ApiError(0, "unknown", "Не удалось отправить заявку"));
      tg.haptic("error");
    } finally {
      setSubmitting(false);
    }
  };

  const closeHint = () => {
    setHintOpen(false);
    void sendEvent("hint_close");
  };
  const hintAction = (action: "save" | "compare" | "send_fd" | "ask_manager") => {
    setHintOpen(false);
    void sendEvent("hint_action", { action, meta });
    if (action === "compare") {
      setCompareForced(true);
      setStep("showcase");
    }
  };

  const fe = formError?.fieldErrors ?? {};
  const summary = calcSummary(product, amountMln, term);
  const stepIndex = step === "done" ? 3 : STEPS.findIndex((s) => s.key === step);
  // Сравниваем только с тем, что есть на витрине клиента: близкий по смыслу продукт, иначе первый другой
  const others = (showcase.data?.items ?? []).filter((i) => i.code !== product);
  const altItem = others.find((i) => kindOf(i.code) === kindOf(product)) ?? others[0];
  const altCode = altItem?.code;
  const alt = altItem?.name ?? "";
  const compareLabel = altCode && INSTR[altCode] && kindOf(altCode) === kindOf(product) ? `Сравнить с ${INSTR[altCode]}` : "Сравнить с другим продуктом";
  const showCompare = !!altItem && (active.has("compare_block") || compareForced);
  const info = PRODUCT_INFO[product];
  const termLabel = (t: number) => (product === "factoring" ? `${t * 30} дн.` : `${t} мес`);
  const recalcs = session?.metrics.recalcs ?? 0;
  const hintWhy =
    hintReason === "idle"
      ? "Показываем, потому что вы задержались на расчёте"
      : hintReason === "recalc" && recalcs > 0
        ? recalcs === 3
          ? "Показываем, потому что вы трижды пересчитали"
          : `Показываем, потому что вы пересчитали ${recalcs} ${plural(recalcs, "раз", "раза", "раз")}`
        : "Показываем, потому что вы несколько раз меняли расчёт";

  if (startError && !session) return <div className="pt-6"><ErrorState error={startError} onRetry={() => window.location.reload()} /></div>;

  const title = step === "showcase" ? "Выберите продукт" : NAMES[product] ?? "Заявка";
  const subtitle =
    step === "showcase"
      ? "Подобрали под задачи компании"
      : step === "calc" && info
        ? `${info.purpose} · ${info.speed.charAt(0).toLowerCase()}${info.speed.slice(1)}`
        : step === "form"
          ? "Проверьте данные и отправьте"
          : null;
  const showStepper = step !== "done" && CALCULABLE.has(product);
  const showBack = !inTelegram && step !== "done";

  return (
    <div className="animate-fade-up pt-safe">
      {step !== "done" && (
        <header className="pt-4">
          {(showStepper || showBack) && (
            <div className="mb-5 flex items-center gap-2">
              {showBack && (
                <button type="button" onClick={goBack} aria-label="Назад"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface transition-transform active:scale-95">
                  <ChevronLeft className="size-5" />
                </button>
              )}
              {showStepper && <Stepper index={stepIndex} onPick={draftId ? undefined : (s) => { tg.haptic("light"); setStep(s); }} />}
            </div>
          )}
          {/* Как в Screen: смена темы — справа от заголовка, шаги получают всю ширину строки */}
          <div className={cx("flex items-start gap-3", !(showStepper || showBack) && "pt-1")}>
            <h1 lang="ru" className="title-xl min-w-0 flex-1 hyphens-manual break-words text-[28px]">{title}</h1>
            <div className="shrink-0"><ThemeButton /></div>
          </div>
          {subtitle && <p className="mt-1.5 text-[14px] leading-snug text-hint">{subtitle}</p>}
        </header>
      )}

      {step === "showcase" && (
        <div className="mt-4 space-y-3">
          {showCompare && (
            <section className="rounded-[22px] border-2 border-lime bg-surface p-4 animate-fade-up" aria-label="Коротко: чем подходит вашему бизнесу">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime text-ink"><GitCompare className="size-4" weight="bold" /></span>
                <div className="text-[15px] font-medium leading-snug">Коротко: чем подходит бизнесу</div>
              </div>
              <table className="mt-3 w-full table-fixed text-[13px] leading-snug">
                <thead>
                  <tr className="text-left">
                    <th className="w-[30%] pb-1.5 font-normal" />
                    <th className="pb-1.5 pr-2 font-medium">{NAMES[product]}</th>
                    <th className="pb-1.5 font-medium">{alt}</th>
                  </tr>
                </thead>
                <tbody>
                  {(["purpose", "speed", "how"] as const).map((k) => (
                    <tr key={k} className="border-t border-sep align-top">
                      <td className="py-2 pr-3 text-hint">{{ purpose: "Зачем", speed: "Срок", how: "Оформление" }[k]}</td>
                      <td className="py-2 pr-2">{PRODUCT_INFO[product]?.[k] ?? "Ваша задача"}</td>
                      <td className="py-2">{(altCode && PRODUCT_INFO[altCode]?.[k]) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[12px] text-hint">
                {active.has("compare_block") ? "Показываем, потому что вы вернулись к выбору" : "Сравнение по вашему запросу"}
              </p>
            </section>
          )}
          {showcase.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[156px] rounded-[22px]" />)}
          {showcase.isError && <ErrorState error={showcase.error} onRetry={() => showcase.refetch()} />}
          {showcase.data?.items.map((item) => {
            const Icon = ICONS[item.code] ?? Coins;
            const pi = PRODUCT_INFO[item.code];
            return (
              <article key={item.code} className="card p-4 animate-fade-up">
                <div className="flex items-start gap-3">
                  <IconBadge tone={item.recommended ? "brand" : "neutral"}>
                    <Icon className="size-5" weight={item.recommended ? "fill" : "regular"} />
                  </IconBadge>
                  <div className="min-w-0 flex-1">
                    {item.recommended && <div className="mb-1.5"><Tag tone="lime">Рекомендуем для вас</Tag></div>}
                    <h2 lang="ru" className="hyphens-manual break-words font-display text-[17px] uppercase leading-tight tracking-[-0.01em]">{item.name}</h2>
                    {pi && <p className="mt-1 truncate text-[13px] text-hint">{pi.purpose}</p>}
                    {item.why.length > 0 && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-hint">Почему: {item.why.join(" · ")}</p>}
                  </div>
                </div>
                {/* Срок решения — одна пилюля рядом с кнопкой; способ оформления есть в блоке сравнения */}
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1">
                    {pi && (
                      <span className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-subtle px-2.5 text-[12px]">
                        <Clock className="size-3.5 shrink-0 text-hint" aria-hidden /><span className="truncate">{pi.speed}</span>
                      </span>
                    )}
                  </div>
                  <Button className="shrink-0" variant={item.recommended ? "primary" : "secondary"}
                    onClick={() => { setProduct(item.code); setTerm(TERMS[item.code]?.[1] ?? 12); poke(); setStep("calc"); }}>
                    Рассчитать
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {step === "calc" && (
        <div className="mt-4 space-y-3">
          {active.has("quick_apply") && (
            <button type="button" onClick={() => setStep("form")}
              className="card flex w-full items-center gap-3 p-3 pr-4 text-left transition-transform active:scale-[0.99] animate-fade-up">
              <IconBadge tone="lime"><Zap className="size-5" weight="fill" /></IconBadge>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">Оформить сразу</div>
                <div className="text-[13px] text-hint">Данные компании уже заполнены</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-hint" aria-hidden />
            </button>
          )}
          <div className="card p-4">
            <label htmlFor="amount" className="block text-[13px] text-hint">
              {product === "factoring" ? "Сумма поставки" : product === "leasing" ? "Стоимость техники" : product === "deposit" ? "Сумма размещения" : "Сумма"}
            </label>
            <div className="mt-1 font-display text-[40px] leading-none tracking-[-0.02em] tabular" aria-live="polite">{amountMln} млн ₽</div>
            <AmountRange id="amount" min={product === "factoring" ? 1 : 5} max={product === "deposit" ? 500 : 200} step={product === "factoring" ? 1 : 5}
              value={amountMln} valueText={`${amountMln} млн рублей`} onChange={(v) => { setAmountMln(v); poke(); tg.haptic("select"); }} />
            <div className="mt-3 text-[13px] text-hint">{product === "factoring" ? "Отсрочка покупателю" : "Срок"}</div>
            <div className="mt-1.5">
              <Segmented ariaLabel={product === "factoring" ? "Отсрочка покупателю" : "Срок"} value={String(term)} onChange={(v) => { setTerm(Number(v)); poke(); tg.haptic("select"); }}
                options={(TERMS[product] ?? [12]).map((t) => ({ value: String(t), label: termLabel(t) }))} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-sep pt-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] text-hint">{summary.label}</div>
                <div className="mt-0.5 font-display text-[20px] leading-tight tabular">{summary.main}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12px] text-hint">{summary.label2}</div>
                <div className="mt-0.5 font-display text-[20px] leading-tight tabular">{summary.value2}</div>
              </div>
            </div>
            <Button className="mt-4" variant="secondary" block icon={<RefreshCw className="size-4" />}
              onClick={() => { poke(); void sendEvent("recalc", { meta }); toast.show("Расчёт обновлён", "info"); }}>
              Пересчитать
            </Button>
          </div>

          {hintVisible && (
            <section ref={hintRef} role="dialog" aria-label="Сомневаетесь в сумме?"
              className="relative rounded-[22px] border-2 border-lime bg-surface p-4 animate-fade-up">
              <button type="button" onClick={closeHint} aria-label="Закрыть подсказку"
                className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full text-hint active:bg-subtle">
                <X className="size-4" />
              </button>
              <div className="flex items-center gap-2.5 pr-9">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime text-ink"><Lightbulb className="size-[18px]" weight="fill" /></span>
                <h2 className="text-[16px] font-medium leading-snug">Сомневаетесь в сумме?</h2>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-hint">{hintWhy}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {altItem && <HintChip onClick={() => hintAction("compare")}>{compareLabel}</HintChip>}
                <HintChip onClick={() => hintAction("save")}>Сохранить расчёт</HintChip>
                {hintVariant === "send_to_fd" ? (
                  <HintChip onClick={() => hintAction("send_fd")}>Отправить расчёт финдиректору</HintChip>
                ) : (
                  <HintChip onClick={() => hintAction("ask_manager")}>Спросить менеджера</HintChip>
                )}
              </div>
            </section>
          )}
          <PrimaryAction text="Оформить заявку" onClick={() => setStep("form")} />
        </div>
      )}

      {step === "form" && (
        <div className="mt-4 space-y-3">
          {draft.isLoading && <Skeleton className="h-[120px] rounded-[22px]" />}
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <IconBadge tone="neutral"><Building2 className="size-5" /></IconBadge>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-hint">Компания</div>
                <div className="truncate text-[15px] font-medium">{home.data?.organization.name ?? "…"}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-sep pt-3">
              <div className="min-w-0"><div className="text-[12px] text-hint">Продукт</div><div className="text-[14px] font-medium leading-snug">{NAMES[product]}</div></div>
              <div className="min-w-0"><div className="text-[12px] text-hint">Контакт</div><div className="text-[14px] font-medium leading-snug">{me.user.full_name}</div></div>
            </div>
          </div>
          {/* Объём и срок: у продуктов без калькулятора и у черновиков вводятся здесь; у рассчитанных — сводка с «Изменить» */}
          {!CALCULABLE.has(product) || draftId ? (
            <div className="space-y-3">
              <Field label="Объём, млн ₽" htmlFor="vol" error={fe.amount_rub}>
                <input id="vol" className={inputCls} inputMode="numeric" value={amountMln} aria-invalid={!!fe.amount_rub}
                  onChange={(e) => setAmountMln(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))} />
              </Field>
              <Field label="Срок, мес." error={fe.term_months}>
                <Chips ariaLabel="Срок" value={String(term)} onChange={(v) => setTerm(Number(v))}
                  options={[3, 6, 12, 24, 36].map((t) => ({ value: String(t), label: `${t}` }))} />
              </Field>
            </div>
          ) : (
            <div className="card flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-hint">Сумма и срок</div>
                <div className="mt-0.5 font-display text-[22px] leading-tight tabular">{amountMln} млн ₽ · {termLabel(term)}</div>
              </div>
              <Button className="shrink-0" variant="secondary" onClick={() => setStep("calc")}>Изменить</Button>
            </div>
          )}
          <Field label="Комментарий для менеджера" htmlFor="comment" error={fe.comment} hint={comment.length ? `${comment.length}/2000` : "Необязательно"}>
            <textarea id="comment" className={cx(inputCls, "min-h-24 resize-none")} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder={CALCULABLE.has(product) ? "Например: предоплата поставщику до 15 числа" : "Например: что подключить и к какому сроку"} aria-invalid={!!fe.comment} />
          </Field>
          {formError && !Object.keys(fe).length && <Banner tone="warn">{formError.message}</Banner>}
          {formError && Object.keys(fe).length > 0 && (
            <Banner tone="warn">Проверьте поля формы</Banner>
          )}
          <p className="px-1 text-[12px] text-hint">Заявка уйдёт вашему клиентскому менеджеру</p>
          <PrimaryAction text={submitting ? "Отправляем…" : "Отправить заявку"} onClick={submit} loading={submitting} disabled={amountMln <= 0} />
        </div>
      )}

      {step === "done" && result && (
        <div className="animate-fade-up">
          <div className="flex justify-end pt-4"><ThemeButton /></div>
          <div className="flex flex-col items-center pt-2 text-center">
            <div className="flex size-[72px] items-center justify-center rounded-full bg-lime text-ink">
              <Check className="size-9" weight="bold" />
            </div>
            <h1 className="title-xl mt-5 text-[28px]">Заявка отправлена</h1>
            <div className="mt-2 font-display text-[18px] tabular">{result.number}</div>
            <p className="mt-2 max-w-xs text-[14px] leading-snug text-hint">
              {result.assignee ? result.assignee.full_name : "Менеджер"} рассмотрит её за 2 рабочих дня.{" "}
              {me.user.telegram.length > 0 && me.user.settings.notify_telegram ? "Статус придёт в Telegram" : "Статус появится в уведомлениях"}
            </p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-[18px] bg-surface p-4">
              <div className="flex items-center gap-1 text-[12px] text-hint"><Clock className="size-3.5" aria-hidden /> Время до заявки</div>
              <div className="mt-1 font-display text-[22px] leading-tight tabular">{duration(elapsed)}</div>
            </div>
            <div className="rounded-[18px] bg-surface p-4">
              <div className="text-[12px] text-hint">{result.product_name}</div>
              <div className="mt-1 font-display text-[22px] leading-tight tabular">{mln(result.amount_rub)}</div>
            </div>
          </div>
          <div className="mt-6 space-y-2">
            {/* В Telegram главное действие — MainButton внизу окна, в браузере — красная кнопка на месте */}
            {inTelegram ? (
              <PrimaryAction text="Открыть заявку" onClick={() => navigate(`/applications/${result.id}`, { replace: true })} />
            ) : (
              <Button block size="lg" onClick={() => navigate(`/applications/${result.id}`, { replace: true })}>Открыть заявку</Button>
            )}
            <Button block variant="secondary" onClick={() => navigate("/", { replace: true })}>На главную</Button>
          </div>
        </div>
      )}

      {me.demo_mode && session && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowMetrics((v) => !v)} aria-expanded={showMetrics}
            className="-ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-1 text-[13px] text-hint active:bg-subtle">
            <BarChart3 className="size-4" /> Метрики сессии · адаптация {session.adapt ? "включена" : "выключена"}
          </button>
          {showMetrics && (
            <div className="card mt-2 p-3 text-[13px] animate-fade">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["переходов", session.metrics.steps], ["возвратов", session.metrics.returns], ["пересчётов", session.metrics.recalcs],
                  ["подсказок", session.metrics.hints_shown], ["закрыто", session.metrics.hints_closed], ["сек. в пути", Math.round((Date.now() - startedAt.current) / 1000)]]
                  .map(([l, v]) => (
                    <div key={l as string} className="rounded-[14px] bg-subtle py-2">
                      <div className="font-display text-[18px] tabular">{v}</div>
                      <div className="text-[12px] text-hint">{l}</div>
                    </div>
                  ))}
              </div>
              {session.log.length > 0 && (
                <ul className="mt-2.5 space-y-1 px-1 text-[12px] text-hint">
                  {session.log.slice(0, 6).map((l, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-hint" aria-hidden />{l}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
