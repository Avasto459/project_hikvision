import { payoutDealer } from "@/lib/hasi";
import { requireAdmin, respond } from "@/lib/hasi-api";

/** Выплатить дилеру весь доступный баланс (3%). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireAdmin(request);
    const { id } = await ctx.params;
    return { success: true, paidOut: await payoutDealer(id) };
  });
}
