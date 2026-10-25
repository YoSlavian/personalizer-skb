import { describe, expect, it, vi } from "vitest";
import { api, ApiError, qs, setToken } from "../lib/api";
import { annuity, mln, pct, plural } from "../lib/format";
import { getWebApp, tg } from "../lib/telegram";
import { installTelegram, mockApi } from "./utils";

describe("api client", () => {
  it("maps validation errors to field errors", async () => {
    mockApi([{ method: "POST", path: "/applications", status: 422, body: { error: { code: "validation_error", message: "Проверьте поля", details: [{ loc: "amount_rub", msg: "Сумма от 100 тыс." }] } } }]);
    const err = (await api("POST", "/applications", { body: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toEqual({ amount_rub: "Сумма от 100 тыс." });
  });

  it("reports network failure as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = (await api("GET", "/dashboard").catch((e) => e)) as ApiError;
    expect(err.isNetwork).toBe(true);
    expect(err.code).toBe("network");
  });

  it("sends bearer token, idempotency key and no CSRF when token is present", async () => {
    const calls = mockApi([{ method: "POST", path: "/applications", status: 201, body: { id: 1 } }]);
    setToken("tok");
    await api("POST", "/applications", { body: { a: 1 }, idempotencyKey: "key-12345678" });
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    expect(calls[0].headers["Idempotency-Key"]).toBe("key-12345678");
    expect(calls[0].headers["X-CSRF-Token"]).toBeUndefined();
    setToken(null);
  });

  it("uses CSRF cookie for cookie sessions", async () => {
    const calls = mockApi([{ method: "POST", path: "/notifications/read-all", body: { updated: 0 } }]);
    document.cookie = "sp_csrf=csrf-value";
    await api("POST", "/notifications/read-all", { body: {} });
    expect(calls[0].headers["X-CSRF-Token"]).toBe("csrf-value");
  });

  it("builds query strings with arrays and skips empty values", () => {
    expect(qs({ status: ["open", "done"], q: "", page: 2, flag: false })).toBe("?status=open&status=done&page=2");
  });
});

describe("format", () => {
  it("formats money, percents and plurals in Russian", () => {
    expect(mln(45_000_000)).toBe("45 млн ₽");
    expect(pct(0.0423)).toBe("4,2%");
    expect(plural(3, "заявка", "заявки", "заявок")).toBe("заявки");
    expect(plural(11, "заявка", "заявки", "заявок")).toBe("заявок");
    expect(Math.round(annuity(12_000_000, 12, 0.12))).toBe(1_066_185);
  });
});

describe("telegram wrapper", () => {
  it("is inactive outside Telegram and falls back to window.confirm", async () => {
    expect(getWebApp()).toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await expect(tg.confirm("Точно?")).resolves.toBe(true);
    expect(tg.initData()).toBeNull();
  });

  it("uses native popups, theme and back button inside Telegram", async () => {
    const wa = installTelegram();
    expect(tg.initData()).toContain("hash=");
    await expect(tg.confirm("Отменить?")).resolves.toBe(true);
    expect(wa.showConfirm).toHaveBeenCalled();
    tg.applyTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(wa.setHeaderColor).toHaveBeenCalledWith("secondary_bg_color");
    const off = tg.backButton(() => {});
    expect(wa.BackButton.show).toHaveBeenCalled();
    off();
    expect(wa.BackButton.offClick).toHaveBeenCalled();
  });
});
