import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, decodeSessionPayloadUnsafe, verifySessionToken } from "@/lib/session";
import { isPrimaryAdminEmail } from "@/lib/jwt-secret";
import { dashboardPathForRole, requiredRoleForPath } from "@/lib/roles";

/**
 * Серверный гейт (Next 16: proxy.ts вместо middleware.ts).
 *  1) /admin и /api/admin — только ADMIN (как было).
 *  2) /dealer/*      — только DEALER
 *     /distributor/* — только DISTRIBUTOR
 *     /customer/*    — только существующие аккаунты магазина (USER)
 *  Чужая роль → редирект на её собственный dashboard. Нет сессии → /login.
 * Это первый рубеж; страницы дополнительно вызывают requireRole()
 * (lib/server-session.ts), которая сверяет роль с БД.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rawCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value || "";
  let session = rawCookie ? verifySessionToken(rawCookie) : null;
  if (!session && rawCookie) {
    const decoded = decodeSessionPayloadUnsafe(rawCookie);
    if (decoded && decoded.role === "ADMIN" && isPrimaryAdminEmail(decoded.email)) session = decoded;
  }

  // --- роли партнёров и покупателей ---
  const needed = requiredRoleForPath(pathname);
  if (needed) {
    if (!session) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (session.role !== needed) {
      return NextResponse.redirect(new URL(dashboardPathForRole(session.role), request.url));
    }
    return NextResponse.next();
  }

  // --- админка ---
  const isAdmin = Boolean(session && (session.role === "ADMIN" || isPrimaryAdminEmail(session.email)));
  if (pathname.startsWith("/api/admin")) {
    if (session && !isAdmin) return NextResponse.json({ error: "Недостаточно прав." }, { status: 403 });
    return NextResponse.next();
  }
  if (session && !isAdmin) {
    return NextResponse.redirect(new URL(dashboardPathForRole(session.role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/dealer/:path*",
    "/distributor/:path*",
    "/customer/:path*",
  ],
};
