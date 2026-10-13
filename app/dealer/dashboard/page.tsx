import { SiteShell } from "@/components/site-shell";
import { DealerPanel } from "@/components/dealer-panel";
import { requireRole } from "@/lib/server-session";
import { getDealerFinance, getDealerProfile } from "@/lib/hasi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Кабинет дилера" };

export default async function DealerDashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; new?: string }> }) {
  const query = await searchParams;
  const account = await requireRole("DEALER");
  const [profile, finance] = await Promise.all([getDealerProfile(account.id), getDealerFinance(account.id)]);

  return (
    <SiteShell>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
        <DealerPanel profile={profile} initialFinance={finance} initialTab={query.tab === "mine" ? "mine" : "free"} initialCreate={query.new === "1"} />
      </main>
    </SiteShell>
  );
}
