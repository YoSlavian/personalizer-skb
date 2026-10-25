import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Calculator, FileEdit, Info, Plus, UserRound } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { OfferCard } from "../../components/Offer";
import { useToast } from "../../components/toast";
import { Banner, Button, Card, ErrorState, IconBadge, List, Row, Section, Skeleton, StatusPill } from "../../components/ui";
import { get, post } from "../../lib/api";
import { mln, relative } from "../../lib/format";
import type { CabinetHome } from "../../lib/types";

const ROLE_SOURCE: Record<string, string> = { crm: "из CRM", inferred: "по правам в интернет-банке", none: "не указана" };

export function ClientHome() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const home = useQuery({ queryKey: ["cabinet-home"], queryFn: () => get<CabinetHome>("/cabinet/home") });

  const offerEvent = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: "clicked" | "hidden" }) => post(`/cabinet/offers/${id}/event`, { kind }),
  });

  const firstName = me.user.full_name.split(" ")[0];
  const h = home.data;

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
      await offerEvent.mutateAsync({ id: h.offer.communication_id, kind: "hidden" });
      toast.show("Скрыли предложение. Не покажем его 30 дней");
      await qc.invalidateQueries({ queryKey: ["cabinet-home"] });
    } catch {
      toast.show("Не удалось скрыть. Попробуйте ещё раз", "error");
    }
  };

  return (
    <Screen title={`Здравствуйте, ${firstName}`} subtitle={h ? `${h.organization.name} · ${h.role.name}` : " "}>
      {home.isLoading && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-[330px] rounded-[18px]" />
          <Skeleton className="h-16 rounded-[18px]" />
        </div>
      )}
      {home.isError && <div className="mt-4"><ErrorState error={home.error} onRetry={() => home.refetch()} /></div>}
      {h && (
        <>
          {h.drafts.length > 0 && (
            <Card className="mt-4 flex items-center gap-3 border-2 border-brand p-4" onClick={() => navigate(`/journey?product=${h.drafts[0].product_code}&draft=${h.drafts[0].id}`)}>
              <IconBadge><FileEdit className="size-4" /></IconBadge>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Продолжить черновик заявки</div>
                <div className="text-[13px] text-hint">{h.drafts[0].product_name}, {mln(h.drafts[0].amount_rub)} · {relative(h.drafts[0].updated_at)}</div>
              </div>
            </Card>
          )}

          <Section title="Для вашей компании">
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
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <IconBadge tone="neutral"><BellOff className="size-4" /></IconBadge>
                  <div>
                    <div className="font-medium">Вы отказались от предложений банка</div>
                    <p className="mt-1 text-[14px] text-hint">Сервисные уведомления по заявкам продолжают приходить. Изменить можно в профиле.</p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => navigate("/profile")}>Настройки коммуникаций</Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-4">
                <div className="font-medium">Сейчас новых предложений нет</div>
                <p className="mt-1 text-[14px] text-hint">Мы не присылаем лишнего: предложение появится, когда оно будет полезно вашей компании.</p>
              </Card>
            )}
            {h.routing && (
              <div className="mt-3">
                <Banner tone="info" icon={<Info className="size-4 text-blue" />}>
                  Кредитные продукты и размещение средств мы обсуждаем с руководителем или финансовым директором компании. Вам — то, что упрощает ежедневную работу.
                </Banner>
              </div>
            )}
          </Section>

          <Section
            title="Заявки"
            action={<button type="button" className="text-[14px] font-medium text-link" onClick={() => navigate("/applications")}>Все</button>}
          >
            {h.applications.length === 0 ? (
              <Card className="flex items-center gap-3 p-4" onClick={() => navigate("/journey")}>
                <IconBadge><Calculator className="size-4" /></IconBadge>
                <div className="flex-1">
                  <div className="font-medium">Рассчитать и подать заявку</div>
                  <div className="text-[13px] text-hint">Кредит, лизинг, факторинг или депозит</div>
                </div>
              </Card>
            ) : (
              <List>
                {h.applications.slice(0, 3).map((a) => (
                  <Row key={a.id} onClick={() => navigate(`/applications/${a.id}`)} title={a.product_name}
                    subtitle={`${a.number} · ${mln(a.amount_rub)} · ${relative(a.updated_at)}`} right={<StatusPill status={a.status} />} chevron={false} />
                ))}
                <Row onClick={() => navigate("/journey")} left={<IconBadge><Plus className="size-4" /></IconBadge>} title="Новая заявка" subtitle="Расчёт займёт пару минут" />
              </List>
            )}
          </Section>

          <Section title="Ваш менеджер">
            <List>
              <Row left={<IconBadge tone="neutral"><UserRound className="size-4" /></IconBadge>} title={h.organization.manager ?? "Будет назначен"}
                subtitle="Клиентский менеджер. Ответит в комментариях к заявке" />
              <Row title="Роль в компании" subtitle={`${h.role.name} · ${ROLE_SOURCE[h.role.source]}`} />
            </List>
          </Section>
          <p className="mt-6 px-1 text-center text-[12px] text-hint">Персонализатор СКБ · MVP · данные: датасеты кейса</p>
        </>
      )}
    </Screen>
  );
}
