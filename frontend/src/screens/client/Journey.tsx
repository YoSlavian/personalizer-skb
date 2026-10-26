import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Clock, GitCompare, Lightbulb, RefreshCw, Save, Send, Sparkles, UserRound, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth, useMe } from "../../auth/AuthProvider";
import { PrimaryAction } from "../../components/PrimaryAction";
import { useToast } from "../../components/toast";
import { Banner, Button, Card, Chips, cx, ErrorState, Field, inputCls, Sheet, Skeleton, Tag } from "../../components/ui";
import { ApiError, get, newIdempotencyKey, patch, post } from "../../lib/api";
import { annuity, DEMO_RATES, mln, money } from "../../lib/format";
import { useClosingConfirmation, useLatest } from "../../lib/hooks";
import { tg } from "../../lib/telegram";
import type { Adaptation, ApplicationDetail, CabinetHome, JourneySession, Showcase } from "../../lib/types";

type Step = "showcase" | "calc" | "form" | "done";

const PRODUCT_INFO: Record<string, { purpose: string; speed: string; how: string }> = {
  working: { purpose: "Закупки и текущие расходы", speed: "Решение за 1–2 дня", how: "Онлайн-заявка" },
  concession: { purpose: "Развитие по госпрограмме", speed: "Проверка программы 2–3 дня", how: "Онлайн-заявка" },
  leasing: { purpose: "Техника и транспорт", speed: "Решение за 2–3 дня", how: "Онлайн + менеджер" },
  factoring: { purpose: "Отсрочка покупателям", speed: "Лимит за 3 дня", how: "Онлайн-заявка" },
  deposit: { purpose: "Доход на свободные деньги", speed: "Сразу", how: "Онлайн" },
};
const NAMES: Record<string, string> = {
  working: "Оборотный кредит", concession: "Льготный кредит", project: "Проектное финансирование", leasing: "Лизинг", factoring: "Факторинг",
  ved: "ВЭД: конвертация и валютный контроль", deposit: "Депозит для свободных остатков", digital: "Интеграция с учётной системой",
  pool: "Единый остаток группы (cash pooling)", glimit: "Общий кредитный лимит группы", syndic: "Синдицированный кредит или облигации",
};
const CALCULABLE = new Set(["working", "concession", "leasing", "factoring", "deposit"]);
const TERMS: Record<string, number[]> = { working: [6, 12, 24, 36], concession: [12, 24, 36], leasing: [12, 24, 36, 48], factoring: [1, 2, 3, 4], deposit: [3, 6, 12] };

function calcSummary(product: string, amountMln: number, term: number): { main: string; label: string; note: string } {
  const r = DEMO_RATES[product];
  const amount = amountMln * 1e6;
  if (!r) return { main: mln(amount), label: "Объём", note: "Условия обсудит менеджер" };
  if (r.kind === "deposit") {
    return { main: money(Math.round((amount * r.rate * term) / 12)), label: `Доход за ${term} мес.`, note: `${r.label}: ${(r.rate * 100).toFixed(1).replace(".", ",")}% годовых` };
  }
  if (r.kind === "factoring") {
    const fee = Math.round((amount * r.rate * term) / 12);
    return { main: money(Math.round(amount * 0.9)), label: "Получите сразу (90%)", note: `Комиссия ≈ ${money(fee)} за ${term * 30} дней отсрочки` };
  }
  const principal = r.kind === "leasing" ? amount * 0.9 : amount;
  return { main: `${money(Math.round(annuity(principal, term, r.rate)))}/мес.`, label: r.kind === "leasing" ? "Лизинговый платёж" : "Ежемесячный платёж", note: `${r.label}: ${(r.rate * 100).toFixed(1).replace(".", ",")}%` };
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
  const [step, setStep] = useState<Step>(draftId ? "form" : CALCULABLE.has(initialProduct) ? "showcase" : "form");
  const [session, setSession] = useState<JourneySession | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const [amountMln, setAmountMln] = useState(20);
  const [term, setTerm] = useState(TERMS[initialProduct]?.[1] ?? 12);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ApplicationDetail | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const idemKey = useRef(newIdempotencyKey());
  const started = useRef(false);
  const startedAt = useRef(Date.now());
  const idleSent = useRef(false);

  const showcase = useQuery({ queryKey: ["showcase", initialProduct], queryFn: () => get<Showcase>(`/cabinet/showcase?product=${encodeURIComponent(initialProduct)}`), enabled: step === "showcase" });
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
        if (next.new.some((a) => a.type === "hint_sheet")) {
          tg.haptic("warning");
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
    if (step !== "calc" || !session) return;
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
    else navigate(-1);
  }, [step, product, draftId, navigate]);
  useEffect(() => (step === "done" ? tg.backButton(null) : tg.backButton(goBack)), [goBack, step]);

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

  const fe = formError?.fieldErrors ?? {};
  const summary = calcSummary(product, amountMln, term);
  const steps: { key: Step; label: string }[] = [
    { key: "showcase", label: "Витрина" },
    { key: "calc", label: "Расчёт" },
    { key: "form", label: "Заявка" },
  ];
  const stepIndex = step === "done" ? 3 : steps.findIndex((s) => s.key === step);
  const alt = showcase.data?.items.find((i) => i.code !== product)?.name ?? "Лизинг";

  if (startError && !session) return <div className="pt-6"><ErrorState error={startError} onRetry={() => window.location.reload()} /></div>;

  return (
    <div className="animate-fade-up pt-safe">
      <header className="flex items-center gap-2 pt-4">
        {!inTelegram && step !== "done" && (
          <button type="button" onClick={goBack} aria-label="Назад" className="flex size-9 items-center justify-center rounded-xl bg-surface shadow-[var(--shadow)]">
            <ChevronLeft className="size-5" />
          </button>
        )}
        <h1 className="font-display text-[24px] leading-tight">{step === "done" ? "Готово" : NAMES[product] ?? "Заявка"}</h1>
      </header>
      {step !== "done" && CALCULABLE.has(product) && (
        <ol className="mt-3 flex gap-1.5" aria-label="Шаги">
          {steps.map((s, i) => (
            <li key={s.key} className="flex-1">
              <div className={cx("h-1 rounded-full transition-colors", i <= stepIndex ? "bg-brand" : "bg-subtle-2")} />
              <div className={cx("mt-1 text-[12px]", i === stepIndex ? "font-medium text-text" : "text-hint")}>{s.label}</div>
            </li>
          ))}
        </ol>
      )}

      {step === "showcase" && (
        <div className="mt-4 space-y-3">
          {active.has("compare_block") && showcase.data && (
            <Card className="border border-lime/60 bg-[color-mix(in_srgb,var(--lime)_14%,var(--surface))] p-4 animate-fade-up">
              <div className="flex items-center gap-2 font-medium"><GitCompare className="size-4" /> Коротко: чем подходит вашему бизнесу</div>
              <table className="mt-3 w-full text-[13px]">
                <thead>
                  <tr className="text-left text-hint"><th className="pb-1 font-normal" /><th className="pb-1 font-medium text-text">{NAMES[product]}</th><th className="pb-1 font-medium text-text">{alt}</th></tr>
                </thead>
                <tbody>
                  {(["purpose", "speed", "how"] as const).map((k) => (
                    <tr key={k} className="border-t border-sep">
                      <td className="py-1.5 pr-2 text-hint">{{ purpose: "Зачем", speed: "Срок", how: "Оформление" }[k]}</td>
                      <td className="py-1.5 pr-2">{PRODUCT_INFO[product]?.[k] ?? "Ваша задача"}</td>
                      <td className="py-1.5">{PRODUCT_INFO[showcase.data!.items.find((i) => i.code !== product)?.code ?? "leasing"]?.[k] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-hint">Показываем, потому что вы несколько раз вернулись к выбору.</p>
            </Card>
          )}
          {showcase.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-[18px]" />)}
          {showcase.isError && <ErrorState error={showcase.error} onRetry={() => showcase.refetch()} />}
          {showcase.data?.items.map((item) => (
            <Card key={item.code} className={cx("p-4", item.code === product && "ring-2 ring-brand")}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {item.recommended && <Tag tone="brand">Рекомендуем для вас</Tag>}
                  <div className="mt-1 text-[16px] font-medium">{item.name}</div>
                  <div className="mt-0.5 text-[13px] text-hint">{PRODUCT_INFO[item.code]?.purpose}</div>
                  {item.why.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{item.why.map((w) => <Tag key={w}>{w}</Tag>)}</div>}
                </div>
                <Button size="sm" variant={item.recommended ? "primary" : "secondary"}
                  onClick={() => { setProduct(item.code); setTerm(TERMS[item.code]?.[1] ?? 12); poke(); setStep("calc"); }}>
                  Рассчитать
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {step === "calc" && (
        <div className="mt-4 space-y-3">
          {active.has("quick_apply") && (
            <Card className="flex items-center gap-3 bg-[color-mix(in_srgb,var(--lime)_16%,var(--surface))] p-4 animate-fade-up" onClick={() => setStep("form")}>
              <div className="flex size-9 items-center justify-center rounded-xl bg-lime text-ink"><Zap className="size-4" /></div>
              <div className="flex-1">
                <div className="font-medium">Оформить сразу</div>
                <div className="text-[13px] text-hint">Данные компании уже заполнены — осталось подтвердить сумму</div>
              </div>
            </Card>
          )}
          <Card className="p-4">
            <Field label={product === "factoring" ? "Сумма поставки" : product === "leasing" ? "Стоимость техники" : product === "deposit" ? "Сумма размещения" : "Сумма"} htmlFor="amount">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[28px] tabular">{amountMln} млн ₽</span>
              </div>
              <input id="amount" type="range" min={product === "factoring" ? 1 : 5} max={product === "deposit" ? 500 : 200} step={product === "factoring" ? 1 : 5}
                value={amountMln} onChange={(e) => { setAmountMln(Number(e.target.value)); poke(); tg.haptic("select"); }} aria-valuetext={`${amountMln} млн рублей`} />
            </Field>
            <div className="mt-3">
              <Field label={product === "factoring" ? "Отсрочка покупателю" : "Срок"}>
                <Chips ariaLabel="Срок" value={String(term)} onChange={(v) => { setTerm(Number(v)); poke(); }}
                  options={(TERMS[product] ?? [12]).map((t) => ({ value: String(t), label: product === "factoring" ? `${t * 30} дн.` : `${t} мес.` }))} />
              </Field>
            </div>
            <div className="mt-4 rounded-2xl bg-subtle px-4 py-3">
              <div className="text-[13px] text-hint">{summary.label}</div>
              <div className="font-display text-[24px] tabular">{summary.main}</div>
              <div className="text-[12px] text-hint">{summary.note}</div>
            </div>
            <Button className="mt-3" variant="ghost" block icon={<RefreshCw className="size-4" />}
              onClick={() => { poke(); void sendEvent("recalc", { meta }); toast.show("Расчёт обновлён", "info"); }}>
              Пересчитать
            </Button>
          </Card>
          <PrimaryAction text="Оформить заявку" onClick={() => setStep("form")} />
        </div>
      )}

      {step === "form" && (
        <div className="mt-4 space-y-3">
          {draft.isLoading && <Skeleton className="h-40 rounded-[18px]" />}
          <Card className="p-4">
            <div className="text-[13px] text-hint">Компания</div>
            <div className="font-medium">{home.data?.organization.name ?? "…"}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><div className="text-[13px] text-hint">Продукт</div><div className="font-medium">{NAMES[product]}</div></div>
              <div><div className="text-[13px] text-hint">Контакт</div><div className="font-medium">{me.user.full_name}</div></div>
            </div>
          </Card>
          {!CALCULABLE.has(product) || draftId ? (
            <Card className="space-y-3 p-4">
              <Field label="Объём, млн ₽" htmlFor="vol" error={fe.amount_rub}>
                <input id="vol" className={inputCls} inputMode="numeric" value={amountMln} aria-invalid={!!fe.amount_rub}
                  onChange={(e) => setAmountMln(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))} />
              </Field>
              <Field label="Срок, мес." error={fe.term_months}>
                <Chips ariaLabel="Срок" value={String(term)} onChange={(v) => setTerm(Number(v))}
                  options={[3, 6, 12, 24, 36].map((t) => ({ value: String(t), label: `${t}` }))} />
              </Field>
            </Card>
          ) : (
            <Card className="flex items-center justify-between p-4">
              <div><div className="text-[13px] text-hint">Сумма и срок</div><div className="font-medium">{amountMln} млн ₽ · {product === "factoring" ? `${term * 30} дн.` : `${term} мес.`}</div></div>
              <Button size="sm" variant="secondary" onClick={() => setStep("calc")}>Изменить</Button>
            </Card>
          )}
          <Field label="Комментарий для менеджера (необязательно)" htmlFor="comment" error={fe.comment} hint={`${comment.length}/2000`}>
            <textarea id="comment" className={cx(inputCls, "min-h-24 resize-none")} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="Например: нужна предоплата поставщику до 15 числа" aria-invalid={!!fe.comment} />
          </Field>
          {formError && !Object.keys(fe).length && <Banner tone="warn">{formError.message}</Banner>}
          {formError && Object.keys(fe).length > 0 && <Banner tone="warn">Проверьте поля формы</Banner>}
          <p className="px-1 text-[12px] text-hint">Отправляя заявку, вы передаёте её клиентскому менеджеру.</p>
          <PrimaryAction text={submitting ? "Отправляем…" : "Отправить заявку"} onClick={submit} loading={submitting} disabled={amountMln <= 0} />
        </div>
      )}

      {step === "done" && result && (
        <div className="mt-6 text-center animate-fade-up">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></div>
          <h2 className="mt-4 font-display text-[22px]">Заявка {result.number} отправлена</h2>
          <p className="mx-auto mt-2 max-w-sm text-[15px] text-hint">
            {result.assignee ? `${result.assignee.full_name} рассмотрит её` : "Менеджер рассмотрит её"} в течение 2 рабочих дней. Статус придёт в Telegram и сюда.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-subtle px-3 py-1.5 text-[13px] text-hint">
            <Clock className="size-4" /> Время до заявки: {Math.round((Date.now() - startedAt.current) / 1000)} с
          </div>
          <div className="mt-6 space-y-2">
            <Button block size="lg" onClick={() => navigate(`/applications/${result.id}`, { replace: true })}>Открыть заявку</Button>
            <Button block variant="ghost" onClick={() => navigate("/", { replace: true })}>На главную</Button>
          </div>
        </div>
      )}

      {me.demo_mode && session && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowMetrics((v) => !v)} className="flex items-center gap-1.5 text-[13px] text-hint">
            <Sparkles className="size-3.5" /> Метрики сессии · адаптация {session.adapt ? "включена" : "выключена"}
          </button>
          {showMetrics && (
            <Card className="mt-2 p-3 text-[13px] animate-fade">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["переходов", session.metrics.steps], ["возвратов", session.metrics.returns], ["пересчётов", session.metrics.recalcs],
                  ["подсказок", session.metrics.hints_shown], ["закрыто", session.metrics.hints_closed], ["сек. в пути", Math.round((Date.now() - startedAt.current) / 1000)]]
                  .map(([l, v]) => <div key={l as string} className="rounded-xl bg-subtle py-2"><div className="font-display text-[18px]">{v}</div><div className="text-hint">{l}</div></div>)}
              </div>
              {session.log.length > 0 && <ul className="mt-2 space-y-0.5 text-hint">{session.log.slice(0, 6).map((l, i) => <li key={i}>• {l}</li>)}</ul>}
            </Card>
          )}
        </div>
      )}

      <Sheet open={hintOpen && step === "calc"} onClose={() => { setHintOpen(false); void sendEvent("hint_close"); }} title="Сомневаетесь в условиях?">
        <div className="space-y-2">
          <Button block variant="ghost" icon={<Save className="size-4" />} onClick={() => { setHintOpen(false); void sendEvent("hint_action", { action: "save", meta }); }}>
            Сохранить расчёт
          </Button>
          <Button block variant="ghost" icon={<GitCompare className="size-4" />} onClick={() => { setHintOpen(false); void sendEvent("hint_action", { action: "compare", meta }); setStep("showcase"); }}>
            Сравнить с «{alt}»
          </Button>
          {hintVariant === "send_to_fd" ? (
            <Button block icon={<Send className="size-4" />} onClick={() => { setHintOpen(false); void sendEvent("hint_action", { action: "send_fd", meta }); }}>
              Отправить расчёт финдиректору
            </Button>
          ) : (
            <Button block icon={<UserRound className="size-4" />} onClick={() => { setHintOpen(false); void sendEvent("hint_action", { action: "ask_manager", meta }); }}>
              Спросить менеджера
            </Button>
          )}
          <p className="flex items-start gap-2 pt-2 text-[12px] text-hint">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0" /> Почему я это вижу: вы несколько раз меняли расчёт или задержались на нём. Подсказка показывается один раз.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
