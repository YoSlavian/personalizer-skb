import type { GroupEntity, Profile } from "../../lib/types";

/** Составы групп и пресеты клиентов — те же, что в прототипе команды (index.html). Синтетика. */
export const GROUPS: Record<"agro" | "div", { name: string; entities: GroupEntity[] }> = {
  agro: {
    name: "Группа «Поле-Инвест»",
    entities: [
      { name: "ООО «Поле-Инвест» (головная)", industry: "agro", share: 62, balance: "credit" },
      { name: "ООО «Поле-Транс»", industry: "log", share: 28, balance: "surplus" },
      { name: "ООО «Поле-Маркет»", industry: "retail", share: 10, balance: "surplus" },
    ],
  },
  div: {
    name: "Группа «Вектор»",
    entities: [
      { name: "АО «Вектор Софт» (головная)", industry: "it", share: 40, balance: "surplus" },
      { name: "ООО «Вектор Ритейл»", industry: "retail", share: 35, balance: "credit" },
      { name: "ООО «Вектор Завод»", industry: "mfg", share: 25, balance: "credit" },
    ],
  },
};

const base: Profile = {
  company: "Компания",
  industry: "agro",
  seasonal: false,
  weeks_to_peak: 6,
  role: "fd",
  role_source: "crm",
  structure: "solo",
  size: "mid",
  group: null,
  mixed_balances: false,
  logins_30d: 4,
  fx_payment: false,
  deposit_ending: false,
  bki_request: false,
  hidden_products: [],
  stopped_products: [],
  opt_out_email: false,
  opt_out_push: false,
  opt_out_all: false,
  turnover_by_month: null,
};

export const PRESETS: { id: string; title: string; sub: string; profile: Profile }[] = [
  {
    id: "A",
    title: "Агрохолдинг",
    sub: "группа · ФД · сезон",
    profile: { ...base, company: "Группа «Поле-Инвест»", industry: "agro", seasonal: true, weeks_to_peak: 5, structure: "group", group: GROUPS.agro, mixed_balances: true, logins_30d: 4 },
  },
  {
    id: "B",
    title: "IT-компания",
    sub: "бухгалтер · онлайн",
    profile: { ...base, company: "АО «Код-Сервис»", industry: "it", role: "acc", role_source: "inferred", logins_30d: 22 },
  },
  {
    id: "C",
    title: "Логистика",
    sub: "роли нет в CRM · офлайн",
    profile: { ...base, company: "ООО «Транс-Линия»", industry: "log", role: "owner", role_source: "none", logins_30d: 0 },
  },
  {
    id: "D",
    title: "Импортёр",
    sub: "ФД · валютный платёж",
    profile: { ...base, company: "ТД «Восток-Импорт»", industry: "trade", size: "large", logins_30d: 12, fx_payment: true },
  },
];
