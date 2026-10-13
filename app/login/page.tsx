"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SiteShell } from "@/components/site-shell";
import { PasswordInput } from "@/components/auth-fields";
import { dashboardPathForRole } from "@/lib/roles";

function LoginForm() {
  const router = useRouter();
  // После сброса пароля пользователь попадает сюда с ?email=… — подставляем его.
  const searchParams = useSearchParams();
  const [emailOrPhone, setEmailOrPhone] = useState(searchParams.get("email")?.trim() || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailOrPhone, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось выполнить вход.");
      localStorage.setItem("hasi-token", result.token);
      window.dispatchEvent(new Event("hasi-auth-changed"));
      // Administrators land in the admin panel, everyone else in the personal account.
      router.push(dashboardPathForRole(result.user?.role));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить вход.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-3xl font-black text-slate-900 dark:text-white">Вход</h2>
      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Email или телефон</label>
          <input value={emailOrPhone} onChange={(event) => setEmailOrPhone(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="example@mail.com" />
        </div>
        <PasswordInput
          id="login-password"
          label="Пароль"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="current-password"
        />

        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-200">{error}</div> : null}

        <button type="submit" disabled={loading} className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-500 disabled:opacity-70">
          {loading ? "Выполняем вход..." : "Войти"}
        </button>

        <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <Link href="/register" className="text-violet-600 hover:text-violet-500 dark:text-violet-300">Создать аккаунт</Link>
          <Link href="/recover" className="text-slate-600 hover:text-violet-500 dark:text-slate-300">Забыли пароль?</Link>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <SiteShell>
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-2 lg:p-10">
          <div className="rounded-[28px] bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_30%),linear-gradient(135deg,_#0f172a_0%,_#111827_45%,_#312e81_100%)] p-8 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">HASI.TJ</div>
            <h1 className="mt-5 text-4xl font-black">Добро пожаловать</h1>
            <p className="mt-4 text-sm leading-7 text-slate-200">
              Войдите в личный кабинет, чтобы отслеживать заказы, управлять профилем и следить за обновлениями каталога.
            </p>
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              Войдите в свой аккаунт, чтобы работать с заказами и профилем. Для оформления заказа регистрация не обязательна.
            </div>
          </div>

          {/* useSearchParams требует Suspense (как на /search) */}
          <Suspense fallback={<div className="flex items-center justify-center py-12 text-sm text-slate-500 dark:text-slate-400">Загрузка…</div>}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </SiteShell>
  );
}
