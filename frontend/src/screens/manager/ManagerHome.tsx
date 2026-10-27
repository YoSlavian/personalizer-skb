import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FileText, SlidersHorizontal, Users } from "../../components/icons";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { Hint } from "../../components/Hint";
import { BellButton, Screen } from "../../components/Layout";
import { cx, EmptyState, ErrorState, IconBadge, List, ListSkeleton, Row, Section, Skeleton, StatusPill } from "../../components/ui";
import { get } from "../../lib/api";
import { mln, plural, relative } from "../../lib/format";
import type { Org, Page, StaffDashboard } from "../../lib/types";
import { TaskRow } from "./Tasks";

function KpiTile({ value, label, alert, onClick }: { value: number; label: string; alert?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${value} ${label}`}
      className={cx("flex h-[92px] flex-col justify-between rounded-[18px] p-3.5 text-left transition-transform active:scale-[0.97]",
        alert ? "bg-brand text-white" : "bg-surface text-text")}>
      <span className="font-display text-[28px] leading-none tabular">{value}</span>
      <span className={cx("truncate text-[13px]", alert ? "text-white/85" : "text-hint")}>{label}</span>
    </button>
  );
}

const linkCls = "-mr-1 flex h-9 items-center px-1 text-[14px] font-medium text-link active:opacity-60";

export function ManagerHome() {
  const me = useMe();
  const navigate = useNavigate();
  const d = useQuery({ queryKey: ["dashboard"], queryFn: () => get<StaffDashboard>("/dashboard"), refetchInterval: 60_000 });
  // Размер портфеля для подзаголовка: /orgs для менеджера уже ограничен его клиентами
  const orgs = useQuery({ queryKey: ["orgs", "count"], queryFn: () => get<Page<Org>>("/orgs?size=1") });
  const k = d.data?.kpi;
  const clients = orgs.data?.total;

  return (
    <Screen title="Портфель"
      subtitle={`${me.user.full_name}${clients !== undefined ? ` · ${clients} ${plural(clients, "клиент", "клиента", "клиентов")}` : ""}`}
      right={<BellButton />}>
      <Hint id="manager" title="Как устроен портфель" steps={[
        "Задачи создают правила персонализации: «клиент сомневается», «уточните роль в CRM».",
        "В задаче написано, что сделать, — отметьте результат.",
        "Статус заявки меняйте во вкладке «Заявки» — клиент получит уведомление в боте.",
      ]} />
      {d.isError && <div className="mt-4"><ErrorState error={d.error} onRetry={() => d.refetch()} /></div>}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {k ? (
          <>
            <KpiTile value={k.open_tasks} label={plural(k.open_tasks, "задача", "задачи", "задач")} onClick={() => navigate("/tasks")} />
            <KpiTile value={k.overdue_tasks} label={plural(k.overdue_tasks, "просрочена", "просрочены", "просрочено")} alert={k.overdue_tasks > 0}
              onClick={() => navigate("/tasks", { state: { overdue: true } })} />
            <KpiTile value={k.open_applications} label={plural(k.open_applications, "заявка", "заявки", "заявок")} onClick={() => navigate("/applications")} />
          </>
        ) : (
          !d.isError && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[92px] rounded-[18px]" />)
        )}
      </div>

      <Section title="Ближайшие задачи" action={<button type="button" className={linkCls} onClick={() => navigate("/tasks")}>Все</button>}>
        {d.isLoading ? <ListSkeleton rows={3} /> : d.data && d.data.tasks.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title="Задач нет" text="Задача появится, когда клиенту понадобится менеджер" />
        ) : (
          d.data && <List>{d.data.tasks.map((t) => <TaskRow key={t.id} t={t} onClick={() => navigate(`/tasks/${t.id}`)} />)}</List>
        )}
      </Section>

      <Section title="Последние заявки" action={<button type="button" className={linkCls} onClick={() => navigate("/applications")}>Все</button>}>
        {d.isLoading ? <ListSkeleton rows={2} /> : d.data && d.data.applications.length === 0 ? (
          <EmptyState icon={<FileText className="size-6" />} title="Заявок пока нет" />
        ) : (
          d.data && (
            <List>
              {d.data.applications.map((a) => (
                <Row key={a.id} onClick={() => navigate(`/applications/${a.id}`)} chevron={false}
                  title={<span className="line-clamp-2 whitespace-normal leading-snug">{`${a.product_name} · ${mln(a.amount_rub).replace(/ /g, "\u00a0")}`}</span>}
                  subtitle={`${a.organization.name} · ${relative(a.updated_at)}`}
                  right={<StatusPill status={a.status} />} />
              ))}
            </List>
          )
        )}
      </Section>

      <Section title="Инструменты">
        <List>
          <Row onClick={() => navigate("/clients")} left={<IconBadge tone="neutral"><Users className="size-5" /></IconBadge>}
            title="Клиенты" subtitle="Профиль, роль ЛПР, решение оптимизатора" />
          <Row onClick={() => navigate("/simulator")} left={<IconBadge tone="neutral"><SlidersHorizontal className="size-5" /></IconBadge>}
            title="Симулятор" subtitle="Как профиль меняет предложение" />
        </List>
      </Section>
    </Screen>
  );
}
