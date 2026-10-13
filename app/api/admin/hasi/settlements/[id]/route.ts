import { StoreError } from "@/lib/db";
import { confirmSettlement, rejectSettlement } from "@/lib/hasi";
import { readJson, requireAdmin, respond } from "@/lib/hasi-api";

/**
 * POST { action: "confirm" | "reject", note? }
 * confirm — оплата подтверждена: лимит дилера освобождается, 3% уходят в баланс выплаты.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const admin = await requireAdmin(request);
    const { id } = await ctx.params;
    const b = await readJson<{ action?: string; note?: string }>(request);
    if (b.action === "confirm") await confirmSettlement(admin.id, id);
    else if (b.action === "reject") await rejectSettlement(admin.id, id, String(b.note ?? ""));
    else throw new StoreError("Укажите действие: confirm или reject.", 400);
    return { success: true };
  });
}
