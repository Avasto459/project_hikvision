/**
 * Роли по ТЗ 0.1: Admin, Distributor, Dealer, Customer.
 * Покупатель (Customer) аккаунта не имеет и оформляет заказ без входа;
 * "USER" оставлен только для уже существующих учётных записей магазина.
 * Файл edge-safe (без БД) — его можно импортировать и в proxy.ts.
 */
export const APP_ROLES = ["USER", "ADMIN", "DISTRIBUTOR", "DEALER"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** Куда вести пользователя после входа. */
export function dashboardPathForRole(role?: string | null): string {
  switch (role) {
    case "ADMIN": return "/admin";
    case "DEALER": return "/dealer/dashboard";
    case "DISTRIBUTOR": return "/distributor/dashboard";
    default: return "/customer/dashboard";
  }
}

/** Какая роль нужна для префикса пути (используется в proxy.ts). */
export function requiredRoleForPath(pathname: string): AppRole | null {
  if (pathname === "/dealer" || pathname.startsWith("/dealer/")) return "DEALER";
  if (pathname === "/distributor" || pathname.startsWith("/distributor/")) return "DISTRIBUTOR";
  if (pathname === "/customer" || pathname.startsWith("/customer/")) return "USER";
  return null;
}
