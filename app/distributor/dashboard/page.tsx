import { SiteShell } from "@/components/site-shell";
import { Card, DashboardHeader, Field } from "@/components/dashboard-ui";
import { requireRole } from "@/lib/server-session";
import { getDistributorView } from "@/lib/hasi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Кабинет дистрибьютора" };

export default async function DistributorDashboardPage() {
  const account = await requireRole("DISTRIBUTOR");
  const view = await getDistributorView(account.id);

  return (
    <SiteShell>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
        <DashboardHeader title={view?.name || account.name} subtitle={account.email} badge="Дистрибьютор" />
        <Card title="Мои склады">
          {!view || view.warehouses.length === 0 ? (
            <p className="text-sm text-slate-500">Склады ещё не назначены. Обратитесь к администратору HASI.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {view.warehouses.map((w) => (
                <li key={w.id} className="grid gap-3 py-3 sm:grid-cols-3">
                  <Field label="Склад" value={`${w.name} (${w.code})`} />
                  <Field label="Позиций" value={w.positions} />
                  <Field label="Единиц на складе" value={w.units} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </SiteShell>
  );
}
