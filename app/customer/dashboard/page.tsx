import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { Card, DashboardHeader, Field } from "@/components/dashboard-ui";
import { requireRole } from "@/lib/server-session";
import { getUserOrders } from "@/lib/db";
import { formatTjs } from "@/lib/currency";

export const dynamic = "force-dynamic";
export const metadata = { title: "Личный кабинет" };

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "Новый", cls: "bg-sky-100 text-sky-700" },
  processing: { label: "В обработке", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Завершён", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Отменён", cls: "bg-slate-200 text-slate-600" },
};

export default async function CustomerDashboardPage() {
  const user = await requireRole("USER");
  const orders = await getUserOrders(user.id);

  return (
    <SiteShell>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
        <DashboardHeader title={`Здравствуйте, ${user.name}`} subtitle={user.email} badge="Покупатель" />

        <Card title="Личные данные">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Имя" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field label="Регистрация" value={new Date(user.createdAt).toLocaleDateString("ru-RU")} />
          </div>
        </Card>

        <Card title="История заказов">
          {orders.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">Заказов пока нет.</p>
              <Link href="/catalog" className="mt-3 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                Перейти в каталог
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {orders.map((o) => {
                const st = STATUS[o.status] ?? { label: o.status, cls: "bg-slate-200 text-slate-700" };
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{o.orderNumber ?? o.id.slice(0, 8)}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(o.createdAt).toLocaleDateString("ru-RU")} · {o.items.length} поз.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{formatTjs(o.total)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </SiteShell>
  );
}
