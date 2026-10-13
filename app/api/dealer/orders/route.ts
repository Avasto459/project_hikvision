import { listDealerOrders } from "@/lib/hasi";
import { requireDealer, respond } from "@/lib/hasi-api";

export const dynamic = "force-dynamic";

/** GET /api/dealer/orders?scope=free|mine — свободные заявки или заявки этого дилера. */
export async function GET(request: Request) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const scope = new URL(request.url).searchParams.get("scope") === "mine" ? "mine" : "free";
    return { orders: await listDealerOrders(dealer.id, scope) };
  });
}
