const rubFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export function mln(rub: number): string {
  return `${rubFmt.format(rub / 1e6)} млн ₽`;
}

export function money(rub: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(rub)} ₽`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

export function signedPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = (v * 100).toFixed(0);
  return `${v > 0 ? "+" : ""}${s}%`;
}

export function dec(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(digits).replace(".", ",");
}

export function num(v: number, digits = 3): string {
  return v.toFixed(digits).replace(".", ",");
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function date(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "—";
}

export function dateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  if (abs < 60) return "только что";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return date(iso);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Условный платёж по аннуитету для синтетического калькулятора (ставки демонстрационные). */
export function annuity(amount: number, months: number, annualRate: number): number {
  const r = annualRate / 12;
  if (r === 0) return amount / months;
  return (amount * r) / (1 - Math.pow(1 + r, -months));
}

export const DEMO_RATES: Record<string, { rate: number; label: string; kind: "credit" | "deposit" | "leasing" | "factoring" }> = {
  working: { rate: 0.165, label: "Ставка (демо)", kind: "credit" },
  concession: { rate: 0.09, label: "Льготная ставка (демо)", kind: "credit" },
  leasing: { rate: 0.145, label: "Удорожание (демо)", kind: "leasing" },
  factoring: { rate: 0.12, label: "Комиссия в год (демо)", kind: "factoring" },
  deposit: { rate: 0.13, label: "Доходность (демо)", kind: "deposit" },
};
