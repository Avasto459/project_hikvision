import jwt from "jsonwebtoken";
import { isAppRole, type AppRole } from "@/lib/roles";
import { getJwtSecret, isPrimaryAdminEmail } from "@/lib/jwt-secret";

export { isPrimaryAdminEmail };

export const SESSION_COOKIE_NAME = "hasi-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = {
  id: string;
  email: string;
  name?: string;
  role: AppRole;
};

/**
 * Verifies the supplementary session cookie without throwing.
 * Fails closed: a malformed or expired token returns null,
 * so the proxy never grants access on a broken session.
 *
 * П.2: главный админ (najmiddinovavasto5@gmail.com) всегда получает
 * роль ADMIN из валидного токена — даже если в БД роль другая или
 * записи нет (Vercel read-only). П.3: валидация идёт только по JWT
 * (подпись + срок), без обращения к БД — DB-failure её не ломает.
 */
export function verifySessionToken(token: string): SessionPayload | null {
  if (!token) return null;
  try {
    // Тот же секрет (с fallback), которым login подписывает токен.
    const payload = jwt.verify(token, getJwtSecret());
    if (typeof payload === "string" || typeof payload.id !== "string" ||
        typeof payload.email !== "string" ||
        !isAppRole(payload.role)) {
      return null;
    }
    // Главный админ — всегда ADMIN, без чтения БД.
    const role: AppRole = isPrimaryAdminEmail(payload.email) ? "ADMIN" : payload.role;
    const name = typeof payload.name === "string" ? payload.name : "";
    return { id: payload.id, email: payload.email, name, role };
  } catch {
    return null;
  }
}

/**
 * Edge-safe декодер payload JWT БЕЗ проверки подписи.
 * Используется только в proxy как мягкий fallback: решение о доступе
 * по нему принимается лишь для главного админа и лишь в связке
 * с Bearer-токеном, который API проверяет строго (verifyToken).
 * Полная проверка подписи в edge невозможна (jsonwebtoken — node-only).
 */
export function decodeSessionPayloadUnsafe(token: string): SessionPayload | null {
  if (!token || token.split(".").length !== 3) return null;
  try {
    const segment = token.split(".")[1] || "";
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    // Edge-safe: в middleware нет Node Buffer, только atob.
    const binary = typeof atob === "function"
      ? atob(padded)
      : (globalThis as unknown as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer!.from(normalized, "base64").toString("utf8");
    const json = typeof atob === "function"
      ? decodeURIComponent(Array.prototype.map.call(binary, (ch: string) => "%" + ("00" + ch.charCodeAt(0).toString(16)).slice(-2)).join(""))
      : binary;
    const payload = JSON.parse(json) as { id?: unknown; email?: unknown; name?: unknown; role?: unknown; exp?: unknown };
    if (typeof payload.id !== "string" || typeof payload.email !== "string") return null;
    if (!isAppRole(payload.role)) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    const role = isPrimaryAdminEmail(payload.email) ? "ADMIN" : payload.role;
    const name = typeof payload.name === "string" ? payload.name : "";
    return { id: payload.id, email: payload.email, name, role };
  } catch {
    return null;
  }
}

/**
 * П.3 — атрибуты session cookie для Vercel (HTTPS):
 * httpOnly: true (защита от XSS), path: '/', sameSite: 'lax' (CSRF-баланс),
 * secure: true в production (браузер иначе отбросит куку на https).
 * maxAge 7 дней — как срок JWT.
 */
export function sessionCookieOptions(request: Request) {
  const isHttps = new URL(request.url).protocol === "https:";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // На Vercel всегда https → secure: true. Локально по http — false,
    // иначе браузер не сохранит куку и будет «Сессия недействительна».
    secure: process.env.NODE_ENV === "production" ? true : isHttps,
  };
}
