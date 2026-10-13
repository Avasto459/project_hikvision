/** Бизнес-константы ТЗ 0.1 (суммы — в сомони). */
export const CENTRAL_WAREHOUSE_ID = "hasi-central";

/** Базовый лимит дилера; админ может изменить и общий, и персональный. */
export const DEFAULT_DEALER_LIMIT = 10_000;
export const DEFAULT_LIMIT_SETTING_KEY = "hasi.defaultDealerLimit";

/** Наценка 10% от закупочной цены: 3% — дилеру, 7% — HASI Market. */
export const DEALER_COMMISSION_RATE = 0.03;
export const HASI_COMMISSION_RATE = 0.07;

/** Закупочная цена по умолчанию = розничная / 1.10 (админ правит её на вкладке «Склад»). */
export const DEFAULT_MARKUP = 1.1;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_dealer: "Свободная заявка",
  accepted: "Принята дилером",
  issued: "Товар выдан",
  payment_reported: "Оплата на проверке",
  completed: "Завершена",
  cancelled: "Отменена",
};

export const ACCOUNT_STATUSES = ["pending", "active", "blocked"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает активации",
  active: "Активен",
  blocked: "Заблокирован",
};
