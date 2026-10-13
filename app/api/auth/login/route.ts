import { NextResponse } from "next/server";
import { comparePassword, signToken, verifyToken } from "@/lib/auth";
import {
  ensureSeedAdmin,
  findFallbackAdminByEmail,
  getPublicUser,
  getUserByEmail,
  getUserById,
  getUserByPhone,
  getUserDisplayName,
  isReadOnlyMode,
  saveMemoryUser,
  verifyFallbackAdmin,
  type UserRole,
} from "@/lib/db";
import { normalizeTajikPhone } from "@/lib/phone";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";

/** П.3: собрать JWT с id, email, name, role. */
function issueSessionToken(user: { id: string; email: string; firstName: string; lastName: string; role: UserRole }) {
  const publicUser = getPublicUser(user as Parameters<typeof getPublicUser>[0]);
  return signToken({
    id: publicUser.id,
    email: publicUser.email,
    name: publicUser.name || getUserDisplayName(user),
    role: publicUser.role as UserRole,
  });
}

/** П.3: установить session cookie — httpOnly, path=/, sameSite=lax, secure. */
function withSessionCookie(response: NextResponse, request: Request, token: string) {
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(request));
  return response;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { emailOrPhone?: string; password?: string };
    const { emailOrPhone, password } = body;

    if (!emailOrPhone || !password) {
      return NextResponse.json({ error: "Укажите email или телефон и пароль." }, { status: 400 });
    }

    // П.2 (Vercel): автосоздание админа najmiddinovavasto5@gmail.com с ролью ADMIN.
    await ensureSeedAdmin();

    const identifier = emailOrPhone.trim();
    const normalizedIdentifier = identifier.toLowerCase();
    let user = normalizedIdentifier.includes("@")
      ? await getUserByEmail(normalizedIdentifier)
      : normalizeTajikPhone(identifier) ? await getUserByPhone(identifier) : undefined;

    // П.2: главный админ входит даже в read-only режиме БД —
    // сверяем с in-memory массивом. Приоритет — fallback-карточке.
    if (normalizedIdentifier.includes("@")) {
      const fallbackMatch = await verifyFallbackAdmin(identifier, password);
      if (fallbackMatch) {
        user = fallbackMatch;
      } else if (!user) {
        const known = await findFallbackAdminByEmail(identifier);
        if (known) user = known;
      }
    }

    // П.2: в read-only окружении новые пользователи живут в памяти —
    // дублируем найденную запись, чтобы сессия не терялась.
    if (user && isReadOnlyMode()) saveMemoryUser(user);

    if (!user || user.isBlocked || !await comparePassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Неверный Email/телефон или пароль." }, { status: 401 });
    }

    // П.3: JWT { id, email, name, role } + secure cookie.
    const token = issueSessionToken(user);
    const response = NextResponse.json({ token, user: getPublicUser(user) });
    return withSessionCookie(response, request, token);
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json({ error: "Не удалось выполнить вход. Проверьте настройки авторизации." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") || "";
  if (!token) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    const payload = verifyToken(token);
    let user = await getUserById(payload.id);
    // П.3: fallback-сессия (id вида fallback-...) — пользователя нет в БД,
    // восстанавливаем карточку из in-memory массива по email из токена.
    if (!user && payload.id.startsWith("fallback-")) {
      user = await findFallbackAdminByEmail(payload.email);
    }
    if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    return NextResponse.json({ user: getPublicUser(user) });
  } catch {
    return NextResponse.json({ error: "Сессия недействительна" }, { status: 401 });
  }
}
