import { issueOrder } from "@/lib/hasi";
import { requireDealer, respond } from "@/lib/hasi-api";

/** Выдача товара с центрального склада под ID заказа (проверка лимита и остатка). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const { id } = await ctx.params;
    return { order: await issueOrder(dealer.id, id) };
  });
}
