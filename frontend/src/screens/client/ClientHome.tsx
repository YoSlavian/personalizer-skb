import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, ChatCircle, ChevronRight, FileEdit, Info, Lightbulb, Plus, UserRound, X } from "../../components/icons";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { OfferCard } from "../../components/Offer";
import { useToast } from "../../components/toast";
import { Banner, Button, ErrorState, IconBadge, List, Row, Section, Skeleton } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useStoredState } from "../../lib/hooks";
import type { CabinetHome } from "../../lib/types";
import { ago, amountNb, AppRow } from "../shared/AppRow";

/** Публичное демо: предложение, скрытое в этой вкладке, — до перезагрузки страницы (на сервере учётка общая) */
let demoHiddenOffer: number | null = null;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Подсказка демо-режима в одну строку, без раскрытия; крестик убирает её (ключ тот же, что у общей подсказки). */
function ClientTip() {
  const [hidden, setHidden] = useStoredState<boolean>("hint.client", false);
  if (hidden) return null;
  return (
    <div className="card mt-4 flex items-center gap-2.5 py-2.5 pl-3 pr-2 animate-fade">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lime text-ink"><Lightbulb className="size-4" weight="fill" /></span>
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-[14px] font-medium">Вы смотрите глазами компании</div>
        <div className="text-[13px] text-hint">Ниже — что ей предложил бы банк</div>
      </div>
      <button type="button" aria-label="Скрыть подсказку" onClick={() => setHidden(true)}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-hint active:bg-subtle">
        <X className="size-4" />
      </button>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="mt-4" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-[340px] rounded-[24px]" />
      <Skeleton className="ml-1 mt-6 h-4 w-24" />
      <div className="card mt-2.5 divide-y divide-sep overflow-hidden">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 rounded-[14px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClientHome() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const home = useQuery({ queryKey: ["cabinet-home"], queryFn: () => get<CabinetHome>("/cabinet/home") });

  const offerEvent = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: "clicked" | "hidden" }) =>
      post<{ demo_local?: boolean }>(`/cabinet/offers/${id}/event`, { kind }),
  });
  const [hiddenHere, setHiddenHere] = useState(demoHiddenOffer);

  const firstName = me.user.full_name.split(" ")[0];
  const data = home.data;
  // Публичное демо: скрытое зрителем предложение убираем только у него, общая учётка не меняется
  const h = data && data.offer && data.offer.communication_id === hiddenHere ? { ...data, offer: null } : data;

  const openOffer = async () => {
    if (!h?.offer) return;
    try {
      await offerEvent.mutateAsync({ id: h.offer.communication_id, kind: "clicked" });
    } catch {
      /* клик фиксируем без блокировки перехода */
    }
    navigate(`/journey?product=${h.offer.product_code}&offer=${h.offer.communication_id}`);
  };
  const hideOffer = async () => {
    if (!h?.offer) return;
    try {
      const r = await offerEvent.mutateAsync({ id: h.offer.communication_id, kind: "hidden" });
      if (r.demo_local) {
        demoHiddenOffer = h.offer.communication_id;
        setHiddenHere(demoHiddenOffer);
        toast.show("Скрыли у вас. В публичном демо это не меняет предложение для других зрителей");
        return;
      }
      toast.show("Скрыли предложение. Не покажем его 30 дней");
      await qc.invalidateQueries({ queryKey: ["cabinet-home"] });
    } catch {
      toast.show("Не удалось скрыть. Попробуйте ещё раз", "error");
    }
  };

  const draft = h?.drafts[0];
  const latestApp = h?.applications[0];

  return (
    <Screen title={`Здравствуйте, ${firstName}`} subtitle={h ? `${h.organization.name} · ${h.role.name}` : " "}>
      <ClientTip />
      {home.isLoading && <HomeSkeleton />}
      {home.isError && <div className="mt-4"><ErrorState error={home.error} onRetry={() => home.refetch()} /></div>}
      {h && (
        <>
          {draft && (
            <button type="button" onClick={() => navigate(`/journey?product=${draft.product_code}&draft=${draft.id}`)}
              className="card mt-4 flex w-full items-center gap-3 p-3 pr-4 text-left transition-transform active:scale-[0.99] animate-fade-up">
              <IconBadge><FileEdit className="size-5" weight="fill" /></IconBadge>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">Продолжить черновик</div>
                <div className="truncate text-[13px] text-hint">{draft.product_name} · {amountNb(draft.amount_rub)} · {ago(draft.updated_at)}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-hint" aria-hidden />
            </button>
          )}

          <div className="mt-4">
            {h.offer ? (
              <OfferCard
                kicker={h.offer.product_name}
                headline={h.offer.headline}
                body={h.offer.body}
                cta={h.offer.cta}
                visual={h.offer.visual_data}
                why={h.offer.why}
                onCta={openOffer}
                ctaBusy={offerEvent.isPending}
                onHide={hideOffer}
              />
            ) : h.suppressed ? (
              <div className="card p-4">
                <div className="flex items-start gap-3">
                  <IconBadge tone="neutral"><BellOff className="size-5" /></IconBadge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">Вы отказались от предложений банка</div>
                    <p className="mt-0.5 text-[13px] text-hint">Уведомления по заявкам приходят как обычно</p>
                  </div>
                </div>
                <Button className="mt-3" size="sm" variant="secondary" onClick={() => navigate("/profile")}>Настройки коммуникаций</Button>
              </div>
            ) : (
              <div className="card flex items-center gap-3 p-4">
                <IconBadge tone="neutral"><Info className="size-5" /></IconBadge>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">Новых предложений нет</div>
                  <p className="mt-0.5 text-[13px] text-hint">Покажем, когда будет полезно компании</p>
                </div>
              </div>
            )}
            {h.routing && (
              <div className="mt-3">
                <Banner tone="info" icon={<Info className="size-4 text-hint" />}>
                  Кредиты и депозиты обсуждаем с руководителем или финдиректором. Вам — сервисы на каждый день.
                </Banner>
              </div>
            )}
          </div>

          <Section
            title="Заявки"
            action={
              <button type="button" className="-my-3 -mr-2 h-11 rounded-full px-3 text-[14px] font-medium text-link active:bg-subtle" onClick={() => navigate("/applications")}>
                Все
              </button>
            }
          >
            <List>
              {h.applications.slice(0, 3).map((a) => (
                <AppRow key={a.id} a={a} onClick={() => navigate(`/applications/${a.id}`)} />
              ))}
              <Row onClick={() => navigate("/journey")} left={<IconBadge tone="neutral"><Plus className="size-5" /></IconBadge>} title="Новая заявка"
                subtitle={h.applications.length ? "Расчёт займёт пару минут" : "Кредит, лизинг, факторинг или депозит"} />
            </List>
          </Section>

          <Section title="Ваш менеджер">
            <List>
              <Row
                onClick={latestApp ? () => navigate(`/applications/${latestApp.id}`) : undefined}
                chevron={false}
                left={
                  h.organization.manager ? (
                    <span className="flex size-10 items-center justify-center rounded-full bg-text font-display text-[14px] text-bg" aria-hidden>
                      {initials(h.organization.manager)}
                    </span>
                  ) : (
                    <IconBadge tone="neutral"><UserRound className="size-5" /></IconBadge>
                  )
                }
                title={h.organization.manager ?? "Будет назначен"}
                subtitle="Ответит в комментариях к заявке"
                right={latestApp ? <ChatCircle className="size-5 text-hint" aria-label="Открыть переписку" /> : undefined}
              />
            </List>
          </Section>
          <p className="mt-6 px-1 text-center text-[12px] text-hint">Персонализатор СКБ · данные кейса</p>
        </>
      )}
    </Screen>
  );
}
