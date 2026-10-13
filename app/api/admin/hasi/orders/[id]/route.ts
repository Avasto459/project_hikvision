import { cancelOrderAdmin } from "@/lib/hasi";
import { requireAdmin, respond } from "@/lib/hasi-api";

/** DELETE — отменить заявку (пока товар не выдан). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireAdmin(request);
    const { id } = await ctx.params;
    await cancelOrderAdmin(id);
    return { success: true };
  });
}
