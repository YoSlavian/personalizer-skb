import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CalendarClock, IdentificationCard, type IconType, Plus, Search, SlidersHorizontal, X, Zap } from "../../components/icons";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, Chips, cx, ErrorState, IconBadge, List, Row, Section, Segmented, Sheet, Skeleton, Tag } from "../../components/ui";
import { api, ApiError, get, patch, post } from "../../lib/api";
import { date, plural } from "../../lib/format";
import type { Catalog, Contact, OrgDecision, OrgDetail } from "../../lib/types";
import { IndustryBadge, splitName } from "./Clients";
import { DecisionView } from "./DecisionView";
import { type GroupPlan, GroupPlanView } from "./GroupPlanView";

const POSITIONS = [
  { value: "owner", label: "Собственник" },
  { value: "fd", label: "Финдиректор" },
  { value: "acc", label: "Главный бухгалтер" },
  { value: "ops", label: "Операционист" },
];
const SIGNALS = [
  { value: "fx_payment", label: "Валютный платёж" },
  { value: "deposit_ending", label: "Депозит заканчивается" },
  { value: "bki_request", label: "Запрос в БКИ" },
];
const SIGNAL_ICON: Record<string, IconType> = { fx_payment: ArrowRightLeft, deposit_ending: CalendarClock, bki_request: Search };
const SOURCE = { crm: "CRM", inferred: "выведено по правам ИБ", none: "нет данных" } as Record<string, string>;
const ACT = { high: "высокая", mid: "средняя", low: "низкая" };

/** «Группа 85352 (датасет)» → «Группа · 3 юрлица»; у именованной группы — её название. */
function groupLabel(name: string, members: number): string {
  const clean = name.replace(/\s*\(датасет\)\s*$/, "").replace(/^Группа\s+\d+$/, "Группа");
  return members > 0 ? `${clean} · ${members} ${plural(members, "юрлицо", "юрлица", "юрлиц")}` : clean;
}

const revFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
/** Выручка в плитке 175px: от 1 000 млн — в млрд, чтобы «25 000 млн ₽» не обрезалось. */
function revenue(mlnRub: number): string {
  return mlnRub >= 1000 ? `${revFmt.format(mlnRub / 1000)} млрд ₽` : `${revFmt.format(mlnRub)} млн ₽`;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-surface p-3.5">
      <div className="truncate text-[12px] text-hint">{label}</div>
      <div className="mt-1.5 truncate font-display text-[22px] leading-none tabular">{value}</div>
      {hint && <div className="mt-1.5 truncate text-[12px] text-hint">{hint}</div>}
    </div>
  );
}

function ConsentPill({ refused, ok }: { refused: boolean; ok: string }) {
  return <Tag tone={refused ? "brand" : "neutral"}>{refused ? "отказ" : ok}</Tag>;
}

function DetailSkeleton() {
  return (
    <div className="pt-5" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-3 h-6 w-36 rounded-full" />
      <Skeleton className="mt-3 h-[42px] rounded-[12px]" />
      <Skeleton className="mt-3 h-[420px] rounded-[22px]" />
    </div>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"decision" | "profile" | "group">("decision");
  const [roleSheet, setRoleSheet] = useState<Contact | null>(null);
  const [rolePick, setRolePick] = useState("fd");
  const [signalSheet, setSignalSheet] = useState(false);
  const [signalKind, setSignalKind] = useState("fx_payment");

  const org = useQuery({ queryKey: ["org", Number(id)], queryFn: () => get<OrgDetail>(`/orgs/${id}`) });
  const decision = useQuery({ queryKey: ["org-decision", Number(id)], queryFn: () => get<OrgDecision>(`/orgs/${id}/decision`) });
  const groupId = org.data?.group?.id;
  const plan = useQuery({ queryKey: ["group-plan", groupId], queryFn: () => get<{ plan: GroupPlan }>(`/groups/${groupId}/plan`), enabled: !!groupId && view === "group" });
  // Название отрасли для шага «Что и когда»: решение по группе может считаться по отрасли головной
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => get<Catalog>("/catalog"), staleTime: Infinity });

  const refresh = (data: OrgDetail) => {
    qc.setQueryData(["org", Number(id)], data);
    void qc.invalidateQueries({ queryKey: ["org-decision", Number(id)] });
    void qc.invalidateQueries({ queryKey: ["orgs"] });
  };
  const onErr = (e: unknown) => toast.show(e instanceof ApiError ? e.message : "Не удалось сохранить", "error");
  const setRole = useMutation({
    mutationFn: ({ cid, pos }: { cid: number; pos: string }) => patch<OrgDetail>(`/orgs/${id}/contacts/${cid}`, { crm_position: pos }),
    onSuccess: (d) => { refresh(d); setRoleSheet(null); toast.show("Роль обновлена в CRM — решение пересчитано"); },
    onError: onErr,
  });
  const addSignal = useMutation({
    mutationFn: () => post<OrgDetail>(`/orgs/${id}/signals`, { kind: signalKind, days: 7 }),
    onSuccess: (d) => { refresh(d); setSignalSheet(false); toast.show("Событие добавлено — решение пересчитано"); },
    onError: onErr,
  });
  const removeSignal = useMutation({
    mutationFn: (sid: number) => api<OrgDetail>("DELETE", `/orgs/${id}/signals/${sid}`),
    onSuccess: (d) => { refresh(d); toast.show("Событие снято"); },
    onError: onErr,
  });

  if (org.isLoading) return <DetailSkeleton />;
  if (org.isError) return <div className="pt-6"><ErrorState error={org.error} onRetry={() => org.refetch()} /></div>;
  const o = org.data!;
  const canEdit = me.user.role !== "client";
  const [name, city] = splitName(o.name);
  const decisionIndustry = decision.data?.profile.industry;
  const industryName = catalog.data?.industries.find((i) => i.code === decisionIndustry)?.name
    ?? (decisionIndustry === o.industry ? o.industry_name : undefined);

  return (
    <Screen title={name} subtitle={`${city ? `${city} · ` : ""}${o.industry_name} · ${o.size === "large" ? "крупный" : "средний"} бизнес · ИНН ${o.inn} (синт.)`}>
      {/* A/B и полнота профиля — в блоке решения и во вкладке «Профиль», здесь только группа */}
      {o.group && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Tag tone="neutral">{groupLabel(o.group.name, o.group_members.length)}</Tag>
        </div>
      )}
      <div className="mt-3">
        <Segmented ariaLabel="Раздел" value={view} onChange={setView}
          options={[{ value: "decision", label: "Решение" }, { value: "profile", label: "Профиль" }, ...(o.group ? [{ value: "group" as const, label: "Группа" }] : [])]} />
      </div>

      {view === "decision" && (
        <div className="mt-3 animate-fade">
          {decision.isLoading && <Skeleton className="h-[420px] rounded-[22px]" />}
          {decision.isError && <ErrorState error={decision.error} onRetry={() => decision.refetch()} />}
          {decision.data && (
            <>
              {decision.data.group_level && <div className="mb-3"><Banner tone="info">Решение на уровне группы: одно предложение ФД головной. Профиль — головной компании.</Banner></div>}
              <DecisionView r={decision.data.result} variant={decision.data.variant} industryName={industryName} />
              <Button className="mt-4" block size="lg" variant="secondary" icon={<SlidersHorizontal className="size-5" />}
                onClick={() => navigate("/", { state: { profile: decision.data!.profile } })}>
                Открыть в симуляторе
              </Button>
            </>
          )}
        </div>
      )}

      {view === "profile" && (
        <div className="animate-fade">
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Tile label="Выручка" value={revenue(o.revenue_mln)} hint={o.seasonal ? "сезонный бизнес" : "без сезонности"} />
            <Tile label="Входов за 30 дней" value={String(o.logins_30d)} hint={`активность ${ACT[o.activity_level]}`} />
          </div>
          <List className="mt-2">
            <Row title="Клиентский менеджер" right={<span className="text-[14px] text-hint">{o.manager?.full_name ?? "—"}</span>} />
            <Row title="Пилот A/B" right={<Tag tone={o.ab_variant === "test" ? "violet" : "neutral"}>{o.ab_variant === "test" ? "тест" : "контроль (AS IS)"}</Tag>} />
            <Row title="Полнота профиля" right={<span className={cx("font-display text-[17px] tabular", o.completeness < 50 && "text-brand")}>{o.completeness}%</span>} />
          </List>

          <Section title="ЛПР и роли" action={<span className="text-[12px] text-hint">без ФИО — 152-ФЗ</span>}>
            <List>
              {o.contacts.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <IconBadge tone="neutral"><IdentificationCard className="size-5" /></IconBadge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="text-[15px] font-medium leading-snug">{c.label}</span>
                      {c.is_primary && <Tag tone="violet">основной</Tag>}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-hint">{c.role_name} · {SOURCE[c.role_source] ?? c.role_source}. {c.role_explanation}</div>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="secondary" className="shrink-0" aria-label={`Изменить роль: ${c.label}`}
                      onClick={() => { setRoleSheet(c); setRolePick(c.crm_position ?? c.role ?? "fd"); }}>Роль</Button>
                  )}
                </div>
              ))}
            </List>
          </Section>

          <Section title="События" action={canEdit ? (
            <button type="button" className="-mr-1 inline-flex h-9 items-center gap-1 px-1 text-[14px] font-medium text-link active:opacity-60" onClick={() => setSignalSheet(true)}>
              <Plus className="size-4" weight="bold" />Добавить
            </button>
          ) : undefined}>
            <List>
              {o.signals.length === 0 && <Row title="Активных событий нет" subtitle="Платёж, конец депозита или запрос в БКИ меняют момент предложения" />}
              {o.signals.map((s) => {
                const Icon = SIGNAL_ICON[s.kind] ?? Zap;
                return (
                  <Row key={s.id} left={<IconBadge tone="neutral"><Icon className="size-5" /></IconBadge>} title={s.name}
                    subtitle={`${s.note ? `${s.note} · ` : ""}до ${date(s.expires_at)}`}
                    right={canEdit ? (
                      <button type="button" aria-label="Снять событие" onClick={() => removeSignal.mutate(s.id)} disabled={removeSignal.isPending}
                        className="flex size-10 items-center justify-center rounded-full bg-subtle text-hint active:bg-subtle-2 disabled:opacity-50">
                        <X className="size-4" />
                      </button>
                    ) : undefined} />
                );
              })}
            </List>
          </Section>

          <Section title="Согласия на коммуникации">
            <List>
              <Row title="Все маркетинговые" right={<ConsentPill refused={o.consents.all} ok="разрешены" />} />
              <Row title="Email" right={<ConsentPill refused={o.consents.email} ok="разрешён" />} />
              <Row title="Push / Telegram" right={<ConsentPill refused={o.consents.push} ok="разрешён" />} />
            </List>
          </Section>

          {o.group && o.group_members.length > 0 && (
            <Section title="Компании группы">
              <List>
                {o.group_members.map((m) => (
                  <Row key={m.id} left={<IndustryBadge industry={(m as { industry?: string }).industry} />}
                    title={m.name} subtitle={m.industry_name}
                    right={m.head ? <Tag tone="violet">головная</Tag> : m.id === o.id ? <Tag tone="neutral">открыта</Tag> : undefined}
                    onClick={m.id !== o.id ? () => navigate(`/clients/${m.id}`) : undefined} />
                ))}
              </List>
            </Section>
          )}
        </div>
      )}

      {view === "group" && (
        <div className="animate-fade">
          {/* Юрлица группы перечислены один раз — в плане с продуктами; переход в карточки — во вкладке «Профиль» */}
          <Section title="Продукт для каждого юрлица">
            {plan.isLoading && <Skeleton className="h-64 rounded-[22px]" />}
            {plan.isError && <ErrorState error={plan.error} onRetry={() => plan.refetch()} />}
            {plan.data && <GroupPlanView plan={plan.data.plan} />}
          </Section>
        </div>
      )}

      <Sheet open={!!roleSheet} onClose={() => setRoleSheet(null)} title="Роль ЛПР в CRM">
        <div className="space-y-3">
          <p className="text-[14px] text-hint">{roleSheet?.label}: подтвердите должность. Роль из CRM получает полный вес, задачи «Уточнить роль» закроются.</p>
          <Chips ariaLabel="Должность" value={rolePick} onChange={setRolePick} options={POSITIONS} />
          <Button block size="lg" loading={setRole.isPending} onClick={() => roleSheet && setRole.mutate({ cid: roleSheet.id, pos: rolePick })}>Сохранить в CRM</Button>
        </div>
      </Sheet>
      <Sheet open={signalSheet} onClose={() => setSignalSheet(false)} title="Новое событие клиента">
        <div className="space-y-3">
          <Chips ariaLabel="Событие" value={signalKind} onChange={setSignalKind} options={SIGNALS} />
          <p className="text-[13px] text-hint">Действует 7 дней. Оптимизатор сразу пересчитает момент и продукт.</p>
          <Button block size="lg" loading={addSignal.isPending} onClick={() => addSignal.mutate()}>Добавить</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
