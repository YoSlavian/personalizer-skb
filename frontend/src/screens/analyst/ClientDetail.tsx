import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, Chips, ErrorState, List, Row, Section, Segmented, Sheet, Skeleton, Tag } from "../../components/ui";
import { api, ApiError, get, patch, post } from "../../lib/api";
import { date } from "../../lib/format";
import type { Contact, OrgDecision, OrgDetail } from "../../lib/types";
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
const SOURCE = { crm: "CRM", inferred: "выведено по правам ИБ", none: "нет данных" } as Record<string, string>;
const ACT = { high: "высокая", mid: "средняя", low: "низкая" };

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

  if (org.isLoading) return <div className="space-y-3 pt-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-64 rounded-[18px]" /></div>;
  if (org.isError) return <div className="pt-6"><ErrorState error={org.error} onRetry={() => org.refetch()} /></div>;
  const o = org.data!;
  const canEdit = me.user.role !== "client";

  return (
    <Screen title={o.name} subtitle={`${o.industry_name} · ${o.size === "large" ? "крупный" : "средний"} бизнес · ИНН ${o.inn} (синт.)`}>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Tag tone={o.ab_variant === "test" ? "blue" : "neutral"}>{o.ab_variant === "test" ? "A/B: тест" : "A/B: контроль"}</Tag>
        <Tag tone={o.completeness >= 50 ? "lime" : "brand"}>Полнота {o.completeness}%</Tag>
        {o.group && <Tag tone="violet">{o.group.name}</Tag>}
      </div>
      <div className="mt-3">
        <Segmented ariaLabel="Раздел" value={view} onChange={setView}
          options={[{ value: "decision", label: "Решение" }, { value: "profile", label: "Профиль" }, ...(o.group ? [{ value: "group" as const, label: "Группа" }] : [])]} />
      </div>

      {view === "decision" && (
        <div className="mt-3 animate-fade">
          {decision.isLoading && <Skeleton className="h-[420px] rounded-[18px]" />}
          {decision.isError && <ErrorState error={decision.error} onRetry={() => decision.refetch()} />}
          {decision.data && (
            <>
              {decision.data.group_level && <div className="mb-3"><Banner tone="info">Решение принимается на уровне группы: одно предложение ФД головной компании.</Banner></div>}
              <DecisionView r={decision.data.result} variant={decision.data.variant} />
              <Button className="mt-4" block variant="secondary" icon={<SlidersHorizontal className="size-4" />}
                onClick={() => navigate("/", { state: { profile: decision.data!.profile } })}>
                Что если… (открыть в симуляторе)
              </Button>
            </>
          )}
        </div>
      )}

      {view === "profile" && (
        <div className="animate-fade">
          <Section title="Признаки">
            <List>
              <Row title="Цифровая активность" right={<span className="text-[14px]">{o.logins_30d} входов · {ACT[o.activity_level]}</span>} />
              <Row title="Выручка" right={<span className="text-[14px] tabular">{o.revenue_mln.toLocaleString("ru-RU")} млн ₽</span>} />
              <Row title="Сезонный бизнес" right={<span className="text-[14px]">{o.seasonal ? "да" : "нет"}</span>} />
              <Row title="Клиентский менеджер" right={<span className="text-[14px]">{o.manager?.full_name ?? "—"}</span>} />
            </List>
          </Section>
          <Section title="ЛПР и роли (без ФИО — 152-ФЗ)">
            <List>
              {o.contacts.map((c) => (
                <Row key={c.id} title={`${c.label}${c.is_primary ? " · основной" : ""}`} subtitle={`${c.role_name} · ${SOURCE[c.role_source]}. ${c.role_explanation}`}
                  right={canEdit ? <Button size="sm" variant="secondary" onClick={() => { setRoleSheet(c); setRolePick(c.crm_position ?? c.role ?? "fd"); }}>Роль</Button> : undefined} />
              ))}
            </List>
          </Section>
          <Section title="События" action={canEdit ? <button type="button" className="inline-flex items-center gap-1 text-[14px] font-medium text-link" onClick={() => setSignalSheet(true)}><Plus className="size-4" />Добавить</button> : undefined}>
            <List>
              {o.signals.length === 0 && <Row title="Активных событий нет" subtitle="Платёж, окончание депозита, запрос в БКИ меняют момент предложения" />}
              {o.signals.map((s) => (
                <Row key={s.id} title={s.name} subtitle={`${s.note ?? ""} до ${date(s.expires_at)}`.trim()}
                  right={canEdit ? <button type="button" aria-label="Снять событие" onClick={() => removeSignal.mutate(s.id)} className="flex size-8 items-center justify-center rounded-full bg-subtle text-hint"><X className="size-4" /></button> : undefined} />
              ))}
            </List>
          </Section>
          <Section title="Согласия на коммуникации">
            <List>
              <Row title="Все маркетинговые" right={<span className="text-[14px]">{o.consents.all ? "отказ" : "разрешены"}</span>} />
              <Row title="Email" right={<span className="text-[14px]">{o.consents.email ? "отказ" : "разрешён"}</span>} />
              <Row title="Push / Telegram" right={<span className="text-[14px]">{o.consents.push ? "отказ" : "разрешён"}</span>} />
            </List>
          </Section>
        </div>
      )}

      {view === "group" && (
        <div className="mt-3 animate-fade">
          <List>
            {o.group_members.map((m) => <Row key={m.id} title={m.name} subtitle={`${m.industry_name}${m.head ? " · головная" : ""}`} onClick={m.id !== o.id ? () => navigate(`/clients/${m.id}`) : undefined} />)}
          </List>
          <div className="mt-3">
            {plan.isLoading && <Skeleton className="h-64 rounded-[18px]" />}
            {plan.isError && <ErrorState error={plan.error} onRetry={() => plan.refetch()} />}
            {plan.data && <GroupPlanView plan={plan.data.plan} />}
          </div>
        </div>
      )}

      <Sheet open={!!roleSheet} onClose={() => setRoleSheet(null)} title="Роль ЛПР в CRM">
        <div className="space-y-3">
          <p className="text-[14px] text-hint">{roleSheet?.label}: подтвердите должность. Заявленная в CRM роль получает полный вес персонализации; открытые задачи «Уточнить роль» закроются.</p>
          <Chips ariaLabel="Должность" value={rolePick} onChange={setRolePick} options={POSITIONS} />
          <Button block loading={setRole.isPending} onClick={() => roleSheet && setRole.mutate({ cid: roleSheet.id, pos: rolePick })}>Сохранить в CRM</Button>
        </div>
      </Sheet>
      <Sheet open={signalSheet} onClose={() => setSignalSheet(false)} title="Новое событие клиента">
        <div className="space-y-3">
          <Chips ariaLabel="Событие" value={signalKind} onChange={setSignalKind} options={SIGNALS} />
          <p className="text-[13px] text-hint">Событие действует 7 дней. Оптимизатор сразу пересчитает момент и продукт.</p>
          <Button block loading={addSignal.isPending} onClick={() => addSignal.mutate()}>Добавить</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
