import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FileText, SlidersHorizontal, Users } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../../auth/AuthProvider";
import { BellButton, Screen } from "../../components/Layout";
import { Card, EmptyState, ErrorState, IconBadge, List, Row, Section, Skeleton, Stat, StatusPill } from "../../components/ui";
import { get } from "../../lib/api";
import { mln, relative } from "../../lib/format";
import type { StaffDashboard } from "../../lib/types";
import { TaskRow } from "./Tasks";

export function ManagerHome() {
  const me = useMe();
  const navigate = useNavigate();
  const d = useQuery({ queryKey: ["dashboard"], queryFn: () => get<StaffDashboard>("/dashboard"), refetchInterval: 60_000 });
  const k = d.data?.kpi;

  return (
    <Screen title={`Добрый день, ${me.user.full_name.split(" ")[0]}`} subtitle="Портфель клиентского менеджера" right={<BellButton />}>
      {d.isError && <div className="mt-4"><ErrorState error={d.error} onRetry={() => d.refetch()} /></div>}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {k ? (
          <>
            <Stat label="Задачи" value={k.open_tasks} />
            <Stat label="Просрочено" value={k.overdue_tasks} tone={k.overdue_tasks ? "bad" : undefined} />
            <Stat label="Заявки" value={k.open_applications} />
          </>
        ) : (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-[74px] rounded-[18px]" />)
        )}
      </div>

      <Section title="Ближайшие задачи" action={<button type="button" className="text-[14px] font-medium text-link" onClick={() => navigate("/tasks")}>Все</button>}>
        {d.isLoading ? <Skeleton className="h-40 rounded-[18px]" /> : d.data && d.data.tasks.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title="Задач нет" text="Правила персонализации создадут задачу, когда клиенту понадобится менеджер" />
        ) : (
          <List>{d.data?.tasks.map((t) => <TaskRow key={t.id} t={t} onClick={() => navigate(`/tasks/${t.id}`)} />)}</List>
        )}
      </Section>

      <Section title="Последние заявки" action={<button type="button" className="text-[14px] font-medium text-link" onClick={() => navigate("/applications")}>Все</button>}>
        {d.data && d.data.applications.length === 0 ? (
          <EmptyState icon={<FileText className="size-6" />} title="Заявок пока нет" />
        ) : (
          <List>
            {d.data?.applications.map((a) => (
              <Row key={a.id} onClick={() => navigate(`/applications/${a.id}`)} title={a.organization.name}
                subtitle={`${a.product_name}, ${mln(a.amount_rub)} · ${relative(a.updated_at)}`} right={<StatusPill status={a.status} />} chevron={false} />
            ))}
          </List>
        )}
      </Section>

      <Section title="Инструменты">
        <div className="grid grid-cols-2 gap-2">
          <Card className="p-4" onClick={() => navigate("/clients")}>
            <IconBadge tone="blue"><Users className="size-4" /></IconBadge>
            <div className="mt-2 font-medium">Клиенты</div>
            <div className="text-[13px] text-hint">Профиль, роль ЛПР, решение оптимизатора</div>
          </Card>
          <Card className="p-4" onClick={() => navigate("/simulator")}>
            <IconBadge tone="violet"><SlidersHorizontal className="size-4" /></IconBadge>
            <div className="mt-2 font-medium">Симулятор</div>
            <div className="text-[13px] text-hint">Как профиль меняет предложение</div>
          </Card>
        </div>
      </Section>
    </Screen>
  );
}
