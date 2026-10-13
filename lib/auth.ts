import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { isAppRole, type AppRole } from "@/lib/roles";
import { FALLBACK_JWT_SECRET, getJwtSecret, hasCustomJwtSecret, isPrimaryAdminEmail } from "@/lib/jwt-secret";

export { FALLBACK_JWT_SECRET };

export type AuthUser = {
  id: string;
  email: string;
  /** Имя для отображения (П.3: зашиваем в JWT). */
  name?: string;
  role: AppRole;
};

let fallbackWarned = false;

function currentJwtSecret() {
  if (!hasCustomJwtSecret() && process.env.NODE_ENV === "production" && !fallbackWarned) {
    fallbackWarned = true;
    console.warn("[AUTH] JWT_SECRET is missing or shorter than 32 characters — using the built-in fallback secret. Set JWT_SECRET before production use.");
  }
  return getJwtSecret();
}

/**
 * Secret for hashing verification / password-reset codes:
 * AUTH_CODE_SECRET → JWT_SECRET → built-in fallback (always at least 32 characters).
 * Used by lib/db.ts so code issuance never throws on a missing variable.
 */
export function getCodeSecret(): string {
  const secret = process.env.AUTH_CODE_SECRET;
  return secret && secret.length >= 32 ? secret : getJwtSecret();
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(user: AuthUser) {
  return jwt.sign(user, currentJwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string) {
  const payload = jwt.verify(token, currentJwtSecret());
  if (typeof payload === "string" || typeof payload.id !== "string" ||
      typeof payload.email !== "string" || !isAppRole(payload.role)) {
    throw new Error("Invalid authentication token.");
  }
  // П.2: главный админ — всегда ADMIN, даже если в токене/БД роль другая.
  // П.3: name опционален (старые токены без него остаются валидны).
  const email = payload.email as string;
  const role = isPrimaryAdminEmail(email) ? "ADMIN" : (payload.role as AppRole);
  const name = typeof (payload as { name?: unknown }).name === "string"
    ? ((payload as { name?: string }).name as string)
    : "";
  return { id: payload.id as string, email, name, role };
}

export function getBearerToken(headerValue?: string | null) {
  if (!headerValue) return null;
  return headerValue.startsWith("Bearer ") ? headerValue.slice(7) : null;
}
