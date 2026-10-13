import { getDealerFinance, getDealerProfile } from "@/lib/hasi";
import { requireDealer, respond } from "@/lib/hasi-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const [profile, finance] = await Promise.all([getDealerProfile(dealer.id), getDealerFinance(dealer.id)]);
    return { profile, finance };
  });
}
