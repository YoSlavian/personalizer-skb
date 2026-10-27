import { ArrowsMerge, Bank, Briefcase, Coins, CurrencyCircleDollar, Handshake, PiggyBank, PlugsConnected, Receipt, ShieldCheck, Truck } from "@phosphor-icons/react";
import { FileText, type IconType } from "../../components/icons";
import { IconBadge, StatusPill } from "../../components/ui";
import { date, mln } from "../../lib/format";
import type { Application } from "../../lib/types";

/** Иконка по типу продукта — строки списка различаются не только текстом. */
const PRODUCT_ICON: Record<string, IconType> = {
  working: Coins, concession: Bank, project: Briefcase, leasing: Truck, factoring: Receipt, deposit: PiggyBank,
  ved: CurrencyCircleDollar, digital: PlugsConnected, pool: ArrowsMerge, glimit: ShieldCheck, syndic: Handshake,
};

/** Сумма без разрыва внутри: «20 млн ₽» не распадается на «20 млн / ₽». */
export function amountNb(rub: number): string {
  return mln(rub).replace(/ /g, " ");
}

/** Короткое «когда»: «43 мин», «5 ч», «вчера», «3 дн.», дальше — дата. С `suffix` — «43 мин назад». */
export function ago(iso: string | null | undefined, suffix = false, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const tail = suffix ? " назад" : "";
  if (s < 60) return "только что";
  if (s < 3600) return `${Math.floor(s / 60)} мин${tail}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч${tail}`;
  const days = Math.floor(s / 86400);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн.${tail}`;
  return date(iso);
}

/**
 * Строка заявки: название во всю ширину (до двух строк), под ним номер, сумма и время, ещё ниже — статус.
 * Статус не делит строку с текстом, поэтому ни сумма, ни название не обрезаются.
 * Клиенту заголовок — продукт; сотруднику — продукт и сумма, в подписи — компания.
 */
export function AppRow({ a, staff = false, onClick }: { a: Application; staff?: boolean; onClick: () => void }) {
  const Icon = PRODUCT_ICON[a.product_code] ?? FileText;
  const number = <span className="whitespace-nowrap">{a.number}</span>;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-subtle">
      <IconBadge tone="neutral"><Icon className="size-5" /></IconBadge>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] font-medium leading-snug">
          {staff ? <>{a.product_name} · <span className="whitespace-nowrap">{amountNb(a.amount_rub)}</span></> : a.product_name}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-hint">
          {/* Время привязано неразрывным пробелом к соседнему фрагменту — не остаётся одно на строке */}
          {staff ? <>{a.organization.name} · {number}{"\u00a0·\u00a0"}{ago(a.updated_at)}</> : <>{number} · {amountNb(a.amount_rub)}{"\u00a0·\u00a0"}{ago(a.updated_at)}</>}
        </div>
        <div className="mt-1.5 flex"><StatusPill status={a.status} /></div>
      </div>
    </button>
  );
}
