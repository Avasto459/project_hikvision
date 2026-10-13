import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";

export function DashboardHeader({ title, subtitle, badge }: { title: string; subtitle: string; badge: string }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {badge}
        </span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
      </div>
      <LogoutButton />
    </div>
  );
}

export function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "На проверке", cls: "bg-amber-100 text-amber-700" },
  active: { label: "Активен", cls: "bg-emerald-100 text-emerald-700" },
  blocked: { label: "Заблокирован", cls: "bg-rose-100 text-rose-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-slate-200 text-slate-700" };
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

/** Маскируем номер паспорта: показываем только последние 3 символа. */
export function maskPassport(n: string) {
  return n.length <= 3 ? n : `${"•".repeat(n.length - 3)}${n.slice(-3)}`;
}
