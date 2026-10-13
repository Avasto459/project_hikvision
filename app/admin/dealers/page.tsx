import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DealersManager } from "@/components/hasi-admin-panel";
import { isPrimaryAdminEmail } from "@/lib/jwt-secret";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Дилеры — админка" };

export default async function AdminDealersPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session || (session.role !== "ADMIN" && !isPrimaryAdminEmail(session.email))) redirect("/login?next=/admin/dealers");

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black sm:text-3xl">Дилеры</h1>
        <Link href="/admin" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100">← В админку</Link>
      </div>
      <DealersManager />
    </main>
  );
}
