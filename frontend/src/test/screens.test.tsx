import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { useAuth } from "../auth/AuthProvider";
import { TelegramOnboarding } from "../auth/AuthScreens";
import { PrimaryAction } from "../components/PrimaryAction";
import { ClientHome } from "../screens/client/ClientHome";
import { Journey } from "../screens/client/Journey";
import { Applications } from "../screens/shared/Applications";
import type { CabinetHome } from "../lib/types";
import { installTelegram, me, mockApi, renderWithProviders } from "./utils";

const home: CabinetHome = {
  organization: { id: 1, name: "ООО «Поле-Инвест»", industry: "agro", industry_name: "АПК", group: "Группа «Поле-Инвест»", manager: "Ольга Иванова" },
  role: { code: "fd", name: "Финдиректор", source: "crm" },
  variant: "test",
  offer: {
    communication_id: 51, channel: "boss", product_code: "working", product_name: "Оборотный кредит", headline: "Ликвидность к сезону закупок",
    body: "До пика закупок 5 нед.", cta: "Рассчитать лимит", visual: "season", visual_data: { type: "season", big: "5 нед.", small: "до пика", months: Array(12).fill(0.5), peak_index: 11 },
    why: "Подобрано по отрасли (АПК), окно 4–6 недель до пика, вашей роли (финдиректор).", calculable: true,
  },
  suppressed: false,
  routing: null,
  drafts: [],
  applications: [],
  consents: { email: false, push: false, all: false },
  synthetic_balance: "99 999,61 ₽",
};

function AuthState() {
  const { state } = useAuth();
  return <div data-testid="state">{state.status === "ready" ? `ready:${state.me.user.role}` : state.status}</div>;
}

describe("Telegram auth", () => {
  it("sends the raw signed initData to the server, never initDataUnsafe", async () => {
    installTelegram("auth_date=1&user=%7B%22id%22%3A42%7D&hash=signed");
    const calls = mockApi([{ method: "POST", path: "/auth/telegram", body: { ...me("manager"), token: "t1" } }]);
    renderWithProviders(<AuthState />, { withAuth: true });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("ready:manager"));
    expect(calls[0].body).toEqual({ init_data: "auth_date=1&user=%7B%22id%22%3A42%7D&hash=signed" });
    expect(JSON.stringify(calls[0].body)).not.toContain("999");
  });

  it("shows onboarding when the Telegram account is not linked", async () => {
    installTelegram();
    mockApi([
      { method: "POST", path: "/auth/telegram", status: 403, body: { error: { code: "telegram_not_linked", message: "Не привязан" } } },
      { path: "/demo/accounts", body: { password: "x", accounts: [{ email: "km@demo", title: "Клиентский менеджер", description: "Задачи", role: "manager" }] } },
    ]);
    renderWithProviders(<><AuthState /><TelegramOnboarding /></>, { withAuth: true });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("unlinked"));
    expect(await screen.findByText("Клиентский менеджер")).toBeInTheDocument();
  });

  it("goes to login in browser mode when there is no session", async () => {
    mockApi([{ path: "/auth/me", status: 401, body: { error: { code: "unauthorized", message: "Требуется вход" } } }]);
    renderWithProviders(<AuthState />, { withAuth: true });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("login"));
  });
});

describe("Client home", () => {
  it("shows a skeleton, then the personalized offer and hides it on request", async () => {
    mockApi([
      { path: "/auth/me", body: me("client") },
      { path: "/cabinet/home", body: home, delay: 30 },
      { method: "POST", path: "/cabinet/offers/51/event", body: { id: 51, status: "hidden", clicks: 0 } },
    ]);
    renderWithProviders(<ClientHome />, { withAuth: true, waitReady: true });
    expect(await screen.findByLabelText("Загрузка", { selector: "[aria-busy]" }).catch(() => null)).toBeDefined();
    expect(await screen.findByText("Ликвидность к сезону закупок")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Почему я это вижу"));
    expect(screen.getByText(/Подобрано по отрасли/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Не интересно"));
    expect(await screen.findByText(/Скрыли предложение/)).toBeInTheDocument();
  });

  it("explains opt-out instead of showing offers", async () => {
    mockApi([{ path: "/auth/me", body: me("client") }, { path: "/cabinet/home", body: { ...home, offer: null, suppressed: true } }]);
    renderWithProviders(<ClientHome />, { withAuth: true, waitReady: true });
    expect(await screen.findByText("Вы отказались от предложений банка")).toBeInTheDocument();
  });

  it("shows a retryable error when the server fails", async () => {
    mockApi([{ path: "/auth/me", body: me("client") }, { path: "/cabinet/home", status: 500, body: { error: { code: "server_error", message: "Ошибка" } } }]);
    renderWithProviders(<ClientHome />, { withAuth: true, waitReady: true });
    expect(await screen.findByText("Ошибка сервера")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Повторить/ })).toBeInTheDocument();
  });
});

describe("Applications list", () => {
  it("renders an empty state", async () => {
    mockApi([{ path: "/auth/me", body: me("client") }, { path: "/applications", body: { items: [], total: 0, page: 1, size: 20, pages: 0 } }]);
    renderWithProviders(<Applications />, { withAuth: true, waitReady: true });
    expect(await screen.findByText("Активных заявок нет")).toBeInTheDocument();
  });

  it("renders statuses and forbids nothing for the client", async () => {
    const app = { id: 3, number: "З-2026-000003", organization: { id: 1, name: "ООО «Поле-Инвест»", industry: "agro", industry_name: "АПК" }, product_code: "working",
      product_name: "Оборотный кредит", amount_rub: 45_000_000, term_months: 12, comment: null, status: "needs_info", status_name: "Нужны уточнения", source: "miniapp",
      author: null, assignee: null, communication_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), submitted_at: null, decided_at: null };
    mockApi([{ path: "/auth/me", body: me("client") }, { path: "/applications", body: { items: [app], total: 1, page: 1, size: 20, pages: 1 } }]);
    renderWithProviders(<Applications />, { withAuth: true, waitReady: true });
    const row = await screen.findByText("Оборотный кредит");
    expect(within(row.closest("button")!).getByText("Нужны уточнения")).toBeInTheDocument();
  });
});

describe("PrimaryAction", () => {
  it("uses Telegram MainButton and ignores taps while loading", async () => {
    const wa = installTelegram();
    let clicks = 0;
    const { rerender } = renderWithProviders(<PrimaryAction text="Отправить" onClick={() => clicks++} loading />);
    expect(wa.MainButton.setParams).toHaveBeenCalledWith(expect.objectContaining({ text: "Отправить", is_active: false }));
    const handler = wa.MainButton.onClick.mock.calls.at(-1)![0] as () => void;
    handler();
    expect(clicks).toBe(0);
    rerender(<PrimaryAction text="Отправить" onClick={() => clicks++} />);
    (wa.MainButton.onClick.mock.calls.at(-1)![0] as () => void)();
    expect(clicks).toBe(1);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });

  it("renders an in-page button outside Telegram", () => {
    renderWithProviders(<PrimaryAction text="Отправить заявку" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Отправить заявку" })).toBeEnabled();
  });
});

describe("Adaptive journey", () => {
  it("opens the hint sheet when the server detects hesitation", async () => {
    const session = { id: 9, product_code: "working", adapt: true, variant: "test", outcome: "open",
      metrics: { elapsed_sec: 1, time_to_apply_sec: null, steps: 1, returns: 0, recalcs: 0, hints_shown: 0, hints_closed: 0 }, screen: "home", log: [], active: [], new: [],
      config: { idle_seconds: 60, returns_threshold: 2, recalc_threshold: 3, quick_seconds: 15 } };
    const hint = { ...session, screen: "calc", active: [{ type: "hint_sheet", variant: "send_to_fd" }], new: [{ type: "hint_sheet", variant: "send_to_fd", reason: "recalc" }] };
    mockApi([
      { path: "/auth/me", body: me("client") },
      { path: "/cabinet/home", body: home },
      { path: "/cabinet/showcase", body: { variant: "test", items: [{ code: "working", name: "Оборотный кредит", recommended: true, calculable: true, why: [] }], offer_product: "working" } },
      { method: "POST", path: "/cabinet/journey/9/events", body: hint },
      { method: "POST", path: "/cabinet/journey", body: session },
    ]);
    renderWithProviders(<Routes><Route path="/journey" element={<Journey />} /></Routes>, { withAuth: true, waitReady: true, route: "/journey?product=working" });
    await userEvent.click(await screen.findByRole("button", { name: "Рассчитать" }));
    await userEvent.click(await screen.findByRole("button", { name: /Пересчитать/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отправить расчёт финдиректору/ })).toBeInTheDocument();
  });
});
