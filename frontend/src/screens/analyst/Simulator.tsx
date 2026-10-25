import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Screen } from "../../components/Layout";
import { Banner, Button, Card, Chips, cx, ErrorState, Field, Section, Segmented, Skeleton, Spinner, Toggle } from "../../components/ui";
import { get, post } from "../../lib/api";
import { useDebounced, useStoredState } from "../../lib/hooks";
import { tg } from "../../lib/telegram";
import type { Catalog, DecisionResult, Profile } from "../../lib/types";
import { DecisionSummary, DecisionView } from "./DecisionView";
import { GroupPlanView, type GroupPlan } from "./GroupPlanView";
import { GROUPS, PRESETS } from "./presets";

const ACT_LABEL = (n: number) => (n >= 8 ? "высокая" : n >= 2 ? "средняя" : "низкая");

export function Simulator() {
  const location = useLocation();
  const fromClient = (location.state as { profile?: Profile; company?: string } | null)?.profile;
  const [profile, setProfile] = useStoredState<Profile>("sim.profile", fromClient ?? PRESETS[0].profile);
  const [preset, setPreset] = useStoredState<string | null>("sim.preset", fromClient ? null : "A");
  const [tab, setTab] = useState<"profile" | "result" | "group">("profile");
  useEffect(() => {
    if (fromClient) {
      setProfile(fromClient);
      setPreset(null);
    }
    // профиль клиента подставляем один раз при переходе из карточки
  }, [fromClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => get<Catalog>("/catalog"), staleTime: Infinity });
  const p = useDebounced(profile, 200);

  const sim = useQuery({
    queryKey: ["simulate", p],
    queryFn: () => post<{ result: DecisionResult }>("/decisions/simulate", { profile: p }),
    placeholderData: keepPreviousData,
  });
  const plan = useQuery({
    queryKey: ["simulate-group", p],
    queryFn: () => post<{ plan: GroupPlan }>("/groups/plan/simulate", { profile: p }),
    enabled: p.structure === "group" && !!p.group,
    placeholderData: keepPreviousData,
  });

  const set = (patch: Partial<Profile>) => {
    tg.haptic("select");
    setPreset(null);
    setProfile((prev) => ({ ...prev, ...patch }));
  };
  const r = sim.data?.result;
  const industry = catalog.data?.industries.find((i) => i.code === profile.industry);
  const groupKey = profile.group?.name === GROUPS.div.name ? "div" : "agro";

  return (
    <Screen title="Симулятор" subtitle="Меняем профиль клиента — меняется предложение, текст, канал и частота">
      <div className="sticky top-0 z-20 -mx-4 mt-3 bg-bg/95 px-4 pb-2 pt-2 backdrop-blur">
        <Card className="flex items-center gap-3 px-4 py-3" onClick={() => setTab("result")}>
          <div className="min-w-0 flex-1 text-[14px] leading-snug">
            {r ? <DecisionSummary r={r} /> : <span className="text-hint">Считаем…</span>}
            {r && !r.suppressed && <div className="truncate text-[12px] text-hint">{r.recipient} · {r.nba}</div>}
          </div>
          {sim.isFetching ? <Spinner className="text-brand" /> : <span className="text-[13px] font-medium text-link">Результат</span>}
        </Card>
        <div className="mt-2">
          <Segmented ariaLabel="Раздел" value={tab} onChange={setTab}
            options={[{ value: "profile", label: "Профиль" }, { value: "result", label: "Результат" }, ...(profile.structure === "group" ? [{ value: "group" as const, label: "Группа" }] : [])]} />
        </div>
      </div>

      {fromClient && <div className="mt-2"><Banner tone="info">Профиль клиента из базы: изменения — сценарий «что если» и не сохраняются.</Banner></div>}

      {tab === "profile" && (
        <div className="animate-fade">
          <Section title="Клиент">
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((x) => (
                <button key={x.id} type="button" onClick={() => { setPreset(x.id); setProfile(x.profile); tg.haptic("light"); }}
                  className={cx("card p-3 text-left transition-transform active:scale-[0.98]", preset === x.id && "ring-2 ring-brand")}>
                  <div className="text-[14px] font-medium">{x.id} · {x.title}</div>
                  <div className="mt-0.5 text-[12px] text-hint">{x.sub}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Отрасль и сезон">
            <Card className="space-y-3 p-4">
              <Chips ariaLabel="Отрасль" value={profile.industry} onChange={(v) => set({ industry: v })}
                options={(catalog.data?.industries ?? []).map((i) => ({ value: i.code, label: i.name }))} />
              <div className="-mx-4">
                <Toggle checked={profile.seasonal} onChange={(v) => set({ seasonal: v })} label="Сезонный пик по оборотам РКО"
                  description={industry && !industry.seasonal ? "Для этой отрасли сезонность не учитывается" : "Окно предложения — 4–6 недель до пика закупок"} />
              </div>
              {profile.seasonal && (
                <Field label={`До пика закупок: ${profile.weeks_to_peak} нед.`}>
                  <input type="range" min={0} max={12} value={profile.weeks_to_peak} onChange={(e) => set({ weeks_to_peak: Number(e.target.value) })} aria-label="Недель до пика" />
                </Field>
              )}
            </Card>
          </Section>

          <Section title="Кому: роль получателя">
            <Card className="space-y-3 p-4">
              <Field label="Откуда знаем роль">
                <Chips ariaLabel="Источник роли" value={profile.role_source} onChange={(v) => set({ role_source: v })}
                  options={(catalog.data?.role_sources ?? []).map((s) => ({ value: s.code as Profile["role_source"], label: s.name }))} />
              </Field>
              <Field label="Роль">
                <Chips ariaLabel="Роль" value={profile.role} onChange={(v) => set({ role: v })} disabled={() => profile.role_source === "none"}
                  options={(catalog.data?.roles ?? []).map((x) => ({ value: x.code, label: x.name }))} />
              </Field>
              <p className="text-[12px] text-hint">
                {profile.role_source === "crm" ? "Роль заполнена в CRM: полный вес персонализации." : profile.role_source === "inferred"
                  ? "В CRM пусто: роль выведена по правам в ИБ (подписант, доступ к Альфа-Босс). Вес ×0,9, метка «выведено»."
                  : "Роли нет: нейтральный текст, канал Альфа-Босс или КМ, задача КМ уточнить роль. Вес ×0,85."}
              </p>
            </Card>
          </Section>

          <Section title="Структура бизнеса">
            <Card className="space-y-3 p-4">
              <Segmented ariaLabel="Структура" value={profile.structure}
                onChange={(v) => set({ structure: v, group: v === "group" ? profile.group ?? GROUPS.agro : null })}
                options={[{ value: "solo", label: "Самостоятельная" }, { value: "group", label: "Группа компаний" }]} />
              <Segmented ariaLabel="Размер" value={profile.size} onChange={(v) => set({ size: v })}
                options={[{ value: "mid", label: "Средний бизнес" }, { value: "large", label: "Крупный" }]} />
              {profile.structure === "group" && (
                <>
                  <Chips ariaLabel="Состав группы" value={groupKey} onChange={(v) => set({ group: GROUPS[v] })}
                    options={[{ value: "agro", label: "Агрохолдинг: АПК 62%" }, { value: "div", label: "Диверсифицированная" }]} />
                  <div className="-mx-4">
                    <Toggle checked={profile.mixed_balances} onChange={(v) => set({ mixed_balances: v })} label="Разнонаправленные остатки"
                      description="Одна компания в кредите, другая держит свободные деньги" />
                  </div>
                </>
              )}
            </Card>
          </Section>

          <Section title="Как: цифровая активность ЛПР">
            <Card className="p-4">
              <Field label={`Входов в ИБ и Альфа-Босс за 30 дней: ${profile.logins_30d} · ${ACT_LABEL(profile.logins_30d)}`}>
                <input type="range" min={0} max={30} value={profile.logins_30d} onChange={(e) => set({ logins_30d: Number(e.target.value) })} aria-label="Входов за 30 дней" />
              </Field>
            </Card>
          </Section>

          <Section title="События и согласия">
            <div className="card divide-y divide-sep overflow-hidden">
              <Toggle checked={profile.fx_payment} onChange={(v) => set({ fx_payment: v })} label="Валютный платёж сегодня" />
              <Toggle checked={profile.deposit_ending} onChange={(v) => set({ deposit_ending: v })} label="Депозит заканчивается через 14 дней" />
              <Toggle checked={profile.bki_request} onChange={(v) => set({ bki_request: v })} label="Запрос в БКИ: ищет кредит в другом банке" />
              <Toggle checked={profile.hidden_products.includes("working")} label="Скрыл баннер по оборотному кредиту"
                onChange={(v) => set({ hidden_products: v ? ["working"] : [] })} />
              <Toggle checked={profile.opt_out_email} onChange={(v) => set({ opt_out_email: v })} label="Отказ от email" />
              <Toggle checked={profile.opt_out_push} onChange={(v) => set({ opt_out_push: v })} label="Отказ от push" />
              <Toggle checked={profile.opt_out_all} onChange={(v) => set({ opt_out_all: v })} label="Отказ от всех маркетинговых коммуникаций" />
            </div>
          </Section>
          <Button className="mt-4" block variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => { setPreset("A"); setProfile(PRESETS[0].profile); }}>
            Сбросить к пресету A
          </Button>
          <Button className="mt-2" block onClick={() => { setTab("result"); window.scrollTo({ top: 0 }); }}>Показать результат</Button>
        </div>
      )}

      {tab === "result" && (
        <div className="mt-3 animate-fade">
          {sim.isError && <ErrorState error={sim.error} onRetry={() => sim.refetch()} />}
          {!r && sim.isLoading && <Skeleton className="h-[420px] rounded-[18px]" />}
          {r && <DecisionView r={r} />}
        </div>
      )}

      {tab === "group" && (
        <div className="mt-3 animate-fade">
          {plan.isError && <ErrorState error={plan.error} onRetry={() => plan.refetch()} />}
          {plan.isLoading && <Skeleton className="h-[320px] rounded-[18px]" />}
          {plan.data && <GroupPlanView plan={plan.data.plan} />}
        </div>
      )}
    </Screen>
  );
}
