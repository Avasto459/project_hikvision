import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { getAccountById, type AccountUser } from "@/lib/partners";
import { dashboardPathForRole, type AppRole } from "@/lib/roles";

/**
 * Серверная проверка роли на страницах (второй рубеж после proxy.ts).
 * Роль и блокировка берутся из БД, а не из токена: смена роли действует сразу.
 */
export async function requireRole(role: AppRole): Promise<AccountUser> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect(`/login?next=${encodeURIComponent(dashboardPathForRole(role))}`);

  const user = await getAccountById(session.id);
  if (!user || user.isBlocked) redirect("/login");
  if (user.role !== role) redirect(dashboardPathForRole(user.role));
  return user;
}
