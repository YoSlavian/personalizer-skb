import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { ArrowRightLeft, Ban, Briefcase, ClipboardList, type IconType, Megaphone, Phone, RefreshCw, Send } from "../../components/icons";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, cx, ErrorState, IconBadge, List, ListSkeleton, Row, Section, Skeleton, Tag } from "../../components/ui";
import { ApiError, get, post } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { tg } from "../../lib/telegram";
import type { CampaignStats, Page } from "../../lib/types";

const CH: Record<string, string> = { boss: "Альфа-Босс", banner_ib: "Баннер ИБ", push: "Push в Telegram", email: "Email", km_call: "Задача КМ", fx_placement: "Плейсмент у валютного перевода" };
const CH_ICON: Record<string, IconType> = { boss: Briefcase, banner_ib: Megaphone, push: Send, email: EnvelopeSimple, km_call: Phone, fx_placement: ArrowRightLeft };
/** Короткие ключи причин из политики частоты → понятная подпись. */
const REASON: Record<string, string> = { "КМ": "Лимит касаний КМ" };

/** Заголовок строки в две строки вместо обрезки: длинные каналы и причины читаются целиком. */
const wrap = (t: string) => <span className="line-clamp-2 whitespace-normal leading-snug">{t}</span>;

function Num({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className={cx("min-w-0 rounded-[18px] bg-surface p-3.5", className)}>
      <div className="font-display text-[28px] leading-none tabular">{value}</div>
      <div className="mt-2 truncate text-[13px] text-hint">{label}</div>
    </div>
  );
}

const count = (v: number) => <span className="font-display text-[17px] tabular">{v}</span>;

function StatsView({ s }: { s: CampaignStats }) {
  const test = s.variants.test ?? 0;
  const control = s.variants.control ?? 0;
  const share = test + control > 0 ? (test / (test + control)) * 100 : 0;
  const channels = Object.entries(s.sent_by_channel).sort((a, b) => b[1] - a[1]);
  return (
    <div className="animate-fade">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-[18px] bg-surface p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-[28px] leading-none tabular">{s.units}</div>
              <div className="mt-2 text-[13px] text-hint">клиентов в прогоне</div>
            </div>
            {s.dry_run ? <Tag tone="neutral">ничего не отправлено</Tag> : <Tag tone="lime">запущено</Tag>}
          </div>
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-subtle-2" aria-hidden>
            <div className="h-full rounded-full bg-text" style={{ width: `${share}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-hint tabular">
            <span>тест {test}</span>
            <span>контроль {control}</span>
          </div>
        </div>
        <Num value={s.sent_total} label={s.dry_run ? "отправим" : "отправлено"} />
        <Num value={s.blocked_total + s.suppressed_opt_out} label={s.dry_run ? "не отправим" : "остановлено"} />
      </div>

      <Section title="По каналам">
        <List>
          {channels.length === 0 && <Row title="Нет отправок" />}
          {channels.map(([k, v]) => {
            const Icon = CH_ICON[k] ?? Send;
            return <Row key={k} left={<IconBadge tone="neutral"><Icon className="size-5" /></IconBadge>} title={wrap(CH[k] ?? k)} right={count(v)} />;
          })}
        </List>
      </Section>

      <Section title="Остановила политика">
        <List>
          {s.suppressed_opt_out > 0 && (
            <Row left={<IconBadge tone="neutral"><Ban className="size-5" /></IconBadge>} title="Отказ от всех коммуникаций" right={count(s.suppressed_opt_out)} />
          )}
          {Object.entries(s.blocked_by_reason).map(([k, v]) => (
            <Row key={k} left={<IconBadge tone="neutral"><Ban className="size-5" /></IconBadge>} title={wrap(REASON[k] ?? k)} right={count(v)} />
          ))}
          {s.blocked_total === 0 && s.suppressed_opt_out === 0 && <Row title="Ничего не остановлено" subtitle="Лимиты частоты не сработали" />}
        </List>
      </Section>

      {s.examples.length > 0 && (
        <Section title="Примеры решений">
          <List>
            {s.examples.map((e) => (
              <Row key={e.org_id} title={e.company} subtitle={`${e.product} → ${e.recipient} · ${e.channels.join(" + ")}`}
                right={<Tag tone={e.variant === "control" ? "neutral" : "violet"}>{e.variant === "control" ? "контроль" : "тест"}</Tag>} />
            ))}
          </List>
        </Section>
      )}
      {!s.dry_run && (
        <div className="mt-3">
          <Banner tone="info" icon={<ClipboardList className="size-5 text-hint" />}>
            Задач КМ создано: {s.tasks_created}. Push уходят в Telegram клиентам с привязанным ботом и включёнными push.
          </Banner>
        </div>
      )}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка">
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="col-span-2 h-[112px] rounded-[18px]" />
        <Skeleton className="h-[84px] rounded-[18px]" />
        <Skeleton className="h-[84px] rounded-[18px]" />
      </div>
      <div className="mt-5"><ListSkeleton rows={3} /></div>
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
      <Section title={run.data ? "Результат запуска" : "Предпросмотр"} action={!run.data ? (
        <button type="button" className="-mr-1 inline-flex h-9 items-center gap-1 px-1 text-[14px] font-medium text-link active:opacity-60 disabled:opacity-40"
          onClick={() => preview.mutate()} disabled={preview.isPending}>
          <RefreshCw className={cx("size-4", preview.isPending && "animate-spin")} /> Обновить
        </button>
      ) : undefined}>
        {preview.isPending && !run.data && <StatsSkeleton />}
        {preview.isError && !run.data && <ErrorState error={preview.error} onRetry={() => preview.mutate()} />}
        {run.data ? <StatsView s={run.data} /> : preview.data && !preview.isPending && <StatsView s={preview.data} />}
      </Section>

      <div className="mt-5">
        {run.data ? (
          <Button block size="lg" variant="secondary" onClick={() => navigate("/pilot")}>К метрикам пилота</Button>
        ) : (
          <Button block size="lg" icon={<Megaphone className="size-5" weight="fill" />} loading={run.isPending} disabled={!preview.data} onClick={confirmRun}>Запустить кампанию</Button>
        )}
        <p className="mt-2 px-1 text-[12px] leading-snug text-hint">Повторный запуск сразу после первого покажет лимиты частоты: большинство коммуникаций остановит политика.</p>
      </div>

      <Section title="Последние запуски">
        {runs.isLoading ? <ListSkeleton rows={2} /> : (
          <List>
            {(runs.data?.items ?? []).length === 0 && <Row title="Запусков ещё не было" />}
            {runs.data?.items.map((r) => (
              <Row key={r.id} title={`Прогон #${r.id} · ${dateTime(r.started_at)}`}
                subtitle={`отправлено ${r.stats.sent_total} · остановлено ${r.stats.blocked_total} · задач ${r.stats.tasks_created}${r.started_by ? ` · ${r.started_by.full_name}` : ""}`} />
            ))}
          </List>
        )}
      </Section>
    </Screen>
  );
}
