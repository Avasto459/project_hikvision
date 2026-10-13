import { deleteDealer, updateDealer } from "@/lib/hasi";
import { readDealerRequest, requireAdmin, respond } from "@/lib/hasi-api";

export const runtime = "nodejs";

type UpdateBody = {
  name?: string; email?: string; phone?: string; password?: string; status?: string; limit?: number | null;
  identity?: Parameters<typeof updateDealer>[2]["identity"];
};

async function update(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const admin = await requireAdmin(request);
    const { id } = await ctx.params;
    const { data: b, scan } = await readDealerRequest<UpdateBody>(request);
    await updateDealer(admin.id, id, {
      name: b.name, email: b.email, phone: b.phone, password: b.password, status: b.status,
      limit: b.limit === undefined || b.limit === null ? undefined : Number(b.limit),
      identity: b.identity, scan,
    });
    return { success: true };
  });
}

/** PATCH и PUT — изменить email, телефон, ФИО, паспортные данные, лимит, статус; заменить скан паспорта. */
export const PATCH = update;
export const PUT = update;

/** DELETE — удалить дилера (полностью или в архив, если есть история заявок). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireAdmin(request);
    const { id } = await ctx.params;
    const { mode } = await deleteDealer(id);
    return {
      success: true,
      mode,
      message: mode === "deleted" ? "Дилер удалён." : "У дилера есть история заявок: аккаунт переведён в статус «deleted», вход закрыт, скан паспорта стёрт.",
    };
  });
}
