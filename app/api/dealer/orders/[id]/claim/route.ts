import { claimOrder } from "@/lib/hasi";
import { requireDealer, respond } from "@/lib/hasi-api";

/** «Принять заявку»: первый нажавший дилер закрепляет заказ за собой (атомарно). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const { id } = await ctx.params;
    return { order: await claimOrder(dealer.id, id) };
  });
}
