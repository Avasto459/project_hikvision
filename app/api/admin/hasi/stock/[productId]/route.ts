import { updateCentralStock } from "@/lib/hasi";
import { readJson, requireAdmin, respond } from "@/lib/hasi-api";

/** PATCH { qty?, purchasePrice? } — остаток и закупочная цена по прайс-листу. */
export async function PATCH(request: Request, ctx: { params: Promise<{ productId: string }> }) {
  return respond(async () => {
    const admin = await requireAdmin(request);
    const { productId } = await ctx.params;
    const b = await readJson<{ qty?: number; purchasePrice?: number }>(request);
    await updateCentralStock(admin.id, productId, {
      qty: b.qty === undefined || b.qty === null ? undefined : Number(b.qty),
      purchasePrice: b.purchasePrice === undefined || b.purchasePrice === null ? undefined : Number(b.purchasePrice),
    });
    return { success: true };
  });
}
