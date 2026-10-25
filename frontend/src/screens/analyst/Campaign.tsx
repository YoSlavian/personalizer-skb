import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Megaphone, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, Card, ErrorState, List, Row, Section, Skeleton, Stat, Tag } from "../../components/ui";
import { ApiError, get, post } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { CampaignStats, Page } from "../../lib/types";

const CH: Record<string, string> = { boss: "Альфа-Босс", banner_ib: "Баннер ИБ", push: "Push в Telegram", email: "Email (mock)", km_call: "Задача КМ", fx_placement: "Плейсмент у валютного перевода" };

function StatsView({ s }: { s: CampaignStats }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Клиентов" value={s.units} hint={`тест ${s.variants.test ?? 0} · контроль ${s.variants.control ?? 0}`} />
        <Stat label="Отправим" value={s.sent_total} tone="good" />
        <Stat label="Не отправим" value={s.blocked_total + s.suppressed_opt_out} tone={s.blocked_total ? "bad" : undefined} />
      </div>
      <Section title="По каналам">
        <List>
          {Object.entries(s.sent_by_channel).length === 0 && <Row title="Нет отправок" />}
          {Object.entries(s.sent_by_channel).map(([k, v]) => <Row key={k} left={<CheckCircle2 className="size-5 text-success" />} title={CH[k] ?? k} right={<span className="tabular">{v}</span>} />)}
        </List>
      </Section>
      <Section title="Остановила политика коммуникаций">
        <List>
          {s.suppressed_opt_out > 0 && <Row left={<Ban className="size-5 text-hint" />} title="Отказ от всех коммуникаций" right={<span className="tabular">{s.suppressed_opt_out}</span>} />}
          {Object.entries(s.blocked_by_reason).map(([k, v]) => <Row key={k} left={<Ban className="size-5 text-hint" />} title={k} right={<span className="tabular">{v}</span>} />)}
          {s.blocked_total === 0 && s.suppressed_opt_out === 0 && <Row title="Ничего не заблокировано" />}
        </List>
      </Section>
      {s.examples.length > 0 && (
        <Section title="Примеры решений">
          <List>
            {s.examples.map((e) => <Row key={e.org_id} title={e.company} subtitle={`${e.product} → ${e.recipient} · ${e.channels.join(" + ")}`} right={<Tag tone="blue">тест</Tag>} />)}
          </List>
        </Section>
      )}
      {!s.dry_run && <Banner tone="info">Задач КМ создано: {s.tasks_created}. Push-предложения уходят в Telegram клиентам, у которых привязан бот и не отключены push.</Banner>}
    </div>
  );
}

export function Campaign() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preview = useMutation({ mutationFn: () => post<CampaignStats>("/campaigns/run", { dry_run: true }) });
  const run = useMutation({
    mutationFn: () => post<CampaignStats>("/campaigns/run", { dry_run: false }),
    onSuccess: (s) => {
      toast.show(`Кампания запущена: ${s.sent_total} коммуникаций`);
      void qc.invalidateQueries({ queryKey: ["campaign-runs"] });
      void qc.invalidateQueries({ queryKey: ["analytics"] });
      preview.reset();
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : "Не удалось запустить", "error"),
  });
  const runs = useQuery({ queryKey: ["campaign-runs"], queryFn: () => get<Page<{ id: number; started_at: string; stats: CampaignStats; started_by: { full_name: string } | null }>>("/campaigns?size=5") });
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      preview.mutate();
    }
  }, [preview]);

  const confirmRun = async () => {
    if (run.isPending) return;
    if (await tg.confirm("Запустить прогон оптимизатора по всем клиентам? Коммуникации будут отправлены с учётом лимитов частоты.")) run.mutate();
  };

  return (
    <Screen title="Кампания" subtitle="Решение → политика коммуникаций → доставка → задачи КМ">
      <Section title={run.data ? "Результат запуска" : "Предпросмотр (ничего не отправлено)"} action={!run.data ? (
        <button type="button" className="inline-flex items-center gap-1 text-[14px] font-medium text-link" onClick={() => preview.mutate()} disabled={preview.isPending}>
          <RefreshCw className="size-4" /> Обновить
        </button>
      ) : undefined}>
        {preview.isPending && !run.data && <Skeleton className="h-64 rounded-[18px]" />}
        {preview.isError && !run.data && <ErrorState error={preview.error} onRetry={() => preview.mutate()} />}
        {run.data ? <StatsView s={run.data} /> : preview.data && <StatsView s={preview.data} />}
      </Section>
      <div className="mt-4">
        {run.data ? (
          <Button block size="lg" variant="secondary" onClick={() => navigate("/")}>К метрикам пилота</Button>
        ) : (
          <Button block size="lg" icon={<Megaphone className="size-4" />} loading={run.isPending} disabled={!preview.data} onClick={confirmRun}>Запустить кампанию</Button>
        )}
        <p className="mt-2 px-1 text-[12px] text-hint">Повторный запуск сразу после первого покажет работу лимитов: большинство коммуникаций будет остановлено политикой частоты.</p>
      </div>
      <Section title="Последние запуски">
        {runs.isLoading ? <Skeleton className="h-24 rounded-[18px]" /> : (
          <Card className="divide-y divide-sep overflow-hidden">
            {(runs.data?.items ?? []).length === 0 && <div className="px-4 py-3 text-[14px] text-hint">Запусков ещё не было</div>}
            {runs.data?.items.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="text-[15px] font-medium">Прогон #{r.id} · {dateTime(r.started_at)}</div>
                <div className="text-[13px] text-hint">отправлено {r.stats.sent_total} · остановлено {r.stats.blocked_total} · задач {r.stats.tasks_created}{r.started_by ? ` · ${r.started_by.full_name}` : ""}</div>
              </div>
            ))}
          </Card>
        )}
      </Section>
    </Screen>
  );
}
