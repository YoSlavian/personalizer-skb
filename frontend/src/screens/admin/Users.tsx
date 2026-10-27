import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwise, Buildings, Check } from "@phosphor-icons/react";
import { Search, UserPlus, Users as UsersIcon } from "../../components/icons";
import { type FormEvent, useState } from "react";
import { Hint } from "../../components/Hint";
import { Screen } from "../../components/Layout";
import { useToast } from "../../components/toast";
import { Banner, Button, Chips, cx, EmptyState, ErrorState, Field, inputCls, List, ListSkeleton, Row, Sheet, Spinner, Tag } from "../../components/ui";
import { ApiError, get, patch, post, qs } from "../../lib/api";
import { useDebounced } from "../../lib/hooks";
import type { Org, Page, Role } from "../../lib/types";

type AdminUser = { id: number; email: string; full_name: string; role: Role; is_active: boolean; last_login_at: string | null };

const ROLE_NAME: Record<Role, string> = { client: "Клиент", manager: "Менеджер", analyst: "Аналитик", admin: "Администратор" };
const POSITIONS = [{ value: "owner", label: "Собственник" }, { value: "fd", label: "Финдиректор" }, { value: "acc", label: "Бухгалтер" }, { value: "ops", label: "Операционист" }];

/** Поле ввода внутри шторки: фон шторки — surface, поэтому поле на подложке. */
const sheetInputCls = `${inputCls} bg-subtle!`;

/** Пароль для нового участника: 12 символов, буквы и цифры, без похожих символов. */
function genPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  const p = Array.from(buf, (n) => abc[n % abc.length]).join("");
  return /\d/.test(p) && /[a-z]/i.test(p) ? p : genPassword();
}

function errText(e: unknown) {
  return e instanceof ApiError ? e.message : "Не получилось";
}

function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function Avatar({ name, muted = false, size = "md" }: { name: string; muted?: boolean; size?: "md" | "lg" }) {
  return (
    <div
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full font-display",
        size === "lg" ? "size-14 text-[20px]" : "size-10 text-[14px]",
        muted ? "bg-subtle text-hint" : "bg-text text-bg",
      )}
    >
      {initialsOf(name)}
    </div>
  );
}

function CreateUser({ onDone }: { onDone: (u: AdminUser, password: string) => void }) {
  const [role, setRole] = useState<Role>("client");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(genPassword);
  const [orgSearch, setOrgSearch] = useState("");
  const [org, setOrg] = useState<Org | null>(null);
  const [position, setPosition] = useState("fd");
  const [error, setError] = useState<ApiError | null>(null);
  const q = useDebounced(orgSearch.trim(), 300);
  const orgs = useQuery({ queryKey: ["orgs-pick", q], queryFn: () => get<Page<Org>>(`/orgs${qs({ search: q, size: 6 })}`), enabled: role === "client" && !org });
  const create = useMutation({
    mutationFn: () => post<AdminUser>("/admin/users", { email, full_name: fullName, role, password, org_id: role === "client" ? org?.id : null,
      position: role === "client" ? position : null }),
    onSuccess: (u) => onDone(u, password),
    onError: (e) => setError(e instanceof ApiError ? e : new ApiError(0, "unknown", "Не получилось")),
  });
  const fe = error?.fieldErrors ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Роль">
        <Chips ariaLabel="Роль" value={role} onChange={(v) => setRole(v as Role)}
          options={(["client", "manager", "analyst", "admin"] as Role[]).map((r) => ({ value: r, label: ROLE_NAME[r] }))} />
      </Field>
      <Field label="Имя и фамилия" htmlFor="u-name" error={fe.full_name}>
        <input id="u-name" className={sheetInputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иван Петров" aria-invalid={!!fe.full_name} />
      </Field>
      <Field label="Логин (email)" htmlFor="u-email" error={fe.email}>
        <input id="u-email" className={sheetInputCls} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ivan@company.ru" aria-invalid={!!fe.email} />
      </Field>
      <Field label="Пароль" htmlFor="u-pass" error={fe.password}>
        <div className="flex gap-2">
          <input id="u-pass" className={`${sheetInputCls} min-w-0 flex-1 font-mono`} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fe.password} />
          <button type="button" onClick={() => setPassword(genPassword())} aria-label="Сгенерировать новый пароль"
            className="flex size-[50px] shrink-0 items-center justify-center rounded-[14px] bg-subtle text-text transition-transform active:scale-[0.97]">
            <ArrowClockwise className="size-5" />
          </button>
        </div>
      </Field>
      {role === "client" && (
        <>
          <Field label="Компания клиента" error={fe.org_id}>
            {org ? (
              <div className="flex min-h-[50px] items-center gap-3 rounded-[14px] bg-subtle py-2 pl-4 pr-2">
                <Buildings className="size-5 shrink-0 text-hint" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{org.name}</span>
                <button type="button" className="h-9 shrink-0 rounded-full px-3 text-[14px] font-medium text-link active:bg-subtle-2" onClick={() => setOrg(null)}>Изменить</button>
              </div>
            ) : (
              <>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-hint" />
                  <input className={`${sheetInputCls} pl-10`} placeholder="Название или ИНН" value={orgSearch} onChange={(e) => setOrgSearch(e.target.value)} aria-label="Поиск компании" />
                </label>
                <div className="mt-1.5">
                  {orgs.isLoading && <div className="flex h-11 items-center px-4 text-hint"><Spinner /></div>}
                  {orgs.data?.items.map((o) => (
                    <button key={o.id} type="button" onClick={() => setOrg(o)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-[14px] px-4 py-2 text-left text-[15px] transition-colors active:bg-subtle">
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      <span className="shrink-0 text-[13px] text-hint">{o.industry_name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Field>
          <Field label="Должность в компании">
            <Chips ariaLabel="Должность" value={position} onChange={setPosition} options={POSITIONS} />
          </Field>
        </>
      )}
      {error && !Object.keys(fe).length && <Banner tone="warn">{error.message}</Banner>}
      <Button type="submit" block size="lg" loading={create.isPending} disabled={!fullName || !email || !password || (role === "client" && !org)}>
        Зарегистрировать
      </Button>
    </form>
  );
}

function UserCard({ u, onClose }: { u: AdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [newPass, setNewPass] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (data: Record<string, unknown>) => patch<AdminUser>(`/admin/users/${u.id}`, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (e) => toast.show(errText(e), "error"),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3.5">
        <Avatar name={u.full_name} muted={!u.is_active} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-medium leading-tight">{u.full_name}</div>
          <div className="mt-1 truncate text-[14px] text-hint">{u.email}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Tag>{ROLE_NAME[u.role]}</Tag>
            {!u.is_active && <Tag tone="brand">заблокирован</Tag>}
          </div>
        </div>
      </div>
      {newPass && (
        <Banner tone="success" icon={<Check className="size-4" weight="bold" />}>
          Новый пароль: <b className="font-mono">{newPass}</b>
          <div className="mt-0.5 text-[13px] text-hint">Показывается один раз — передайте участнику.</div>
        </Banner>
      )}
      <div className="space-y-2">
        <Button block variant="secondary" loading={update.isPending && !newPass} onClick={() => {
          const p = genPassword();
          update.mutate({ password: p }, { onSuccess: () => setNewPass(p) });
        }}>Сбросить пароль</Button>
        <Button block variant={u.is_active ? "danger" : "secondary"} onClick={() => update.mutate({ is_active: !u.is_active }, {
          onSuccess: () => { toast.show(u.is_active ? "Доступ заблокирован" : "Доступ восстановлен"); onClose(); } })}>
          {u.is_active ? "Заблокировать доступ" : "Разблокировать"}
        </Button>
      </div>
    </div>
  );
}

export function UsersScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ u: AdminUser; password: string } | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const q = useDebounced(search.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: ["admin-users", role, q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => get<Page<AdminUser>>(`/admin/users${qs({ role: role === "all" ? null : role, search: q, page: pageParam, size: 25 })}`, signal),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0].total;

  return (
    <Screen title="Участники" subtitle={total !== undefined ? `${total} учётных записей` : " "}
      right={<Button size="sm" icon={<UserPlus className="size-4" weight="bold" />} onClick={() => setAdding(true)}>Добавить</Button>}>
      <Hint id="users" steps={[
        "«Добавить»: роль, имя, логин и пароль. Клиента привязываем к компании.",
        "Участник входит в боте или в браузере: «У меня есть учётная запись».",
        "Нажмите на участника — сброс пароля или блокировка.",
      ]} />
      <div className="mt-4 space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-hint" />
          <input className={`${inputCls} pl-10`} placeholder="Имя или email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск участников" />
        </label>
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
          <Chips ariaLabel="Роль" value={role} onChange={setRole}
            options={[{ value: "all", label: "Все" }, ...(["client", "manager", "analyst", "admin"] as Role[]).map((r) => ({ value: r, label: ROLE_NAME[r] }))]} />
        </div>
      </div>
      <div className="mt-3">
        {list.isLoading && <ListSkeleton rows={6} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && <EmptyState icon={<UsersIcon className="size-6" />} title="Никого не нашли" text="Измените поиск или добавьте участника" />}
        {items.length > 0 && (
          <List>
            {items.map((u) => (
              <Row key={u.id} onClick={() => setSelected(u)} left={<Avatar name={u.full_name} muted={!u.is_active} />} title={u.full_name} subtitle={u.email}
                right={u.is_active ? <Tag>{ROLE_NAME[u.role]}</Tag> : <Tag tone="brand">заблокирован</Tag>} />
            ))}
          </List>
        )}
        {list.hasNextPage && <Button className="mt-3" block variant="ghost" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Показать ещё</Button>}
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Новый участник">
        <CreateUser onDone={(u, password) => { setAdding(false); setCreated({ u, password }); void qc.invalidateQueries({ queryKey: ["admin-users"] }); }} />
      </Sheet>
      <Sheet open={!!created} onClose={() => setCreated(null)} title="Участник добавлен">
        {created && (
          <div className="space-y-4">
            <div className="divide-y divide-sep overflow-hidden rounded-[18px] bg-subtle">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[14px] text-hint">Логин</span>
                <span className="min-w-0 truncate font-mono text-[15px] font-medium">{created.u.email}</span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[14px] text-hint">Пароль</span>
                <span className="min-w-0 truncate font-mono text-[15px] font-medium">{created.password}</span>
              </div>
            </div>
            <p className="px-1 text-[13px] text-hint">Пароль показывается один раз. Вход: в боте или в браузере — «У меня есть учётная запись».</p>
            <Button block size="lg" onClick={() => setCreated(null)}>Готово</Button>
          </div>
        )}
      </Sheet>
      <Sheet open={!!selected} onClose={() => setSelected(null)} title="Участник">
        {selected && <UserCard u={selected} onClose={() => setSelected(null)} />}
      </Sheet>
    </Screen>
  );
}
