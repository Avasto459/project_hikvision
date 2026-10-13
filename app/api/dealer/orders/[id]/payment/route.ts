import { reportPayment } from "@/lib/hasi";
import { readJson, requireDealer, respond } from "@/lib/hasi-api";

/** Дилер сообщает об оплате: { method: "cash" | "transfer", reference?: string }. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const { id } = await ctx.params;
    const body = await readJson<{ method?: unknown; reference?: unknown }>(request);
    return {
      order: await reportPayment(
        dealer.id, id,
        typeof body.method === "string" ? body.method : "",
        typeof body.reference === "string" ? body.reference : "",
      ),
    };
  });
}
