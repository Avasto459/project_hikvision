import { releaseOrder } from "@/lib/hasi";
import { requireDealer, respond } from "@/lib/hasi-api";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const { id } = await ctx.params;
    await releaseOrder(dealer.id, id);
    return { ok: true };
  });
}
