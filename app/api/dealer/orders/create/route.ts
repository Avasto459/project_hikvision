import { createDealerOrder } from "@/lib/hasi";
import { readJson, requireDealer, respond } from "@/lib/hasi-api";
import { StoreError } from "@/lib/db";
import { normalizeTajikPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * POST — дилер создаёт заказ для покупателя.
 * { name, phone, addressComment, items: [{ productId, quantity }] }
 * Заказ получает уникальный номер и сразу закрепляется за этим дилером (статус «Принята дилером»).
 * Цены берутся из БД, а не из запроса; остаток проверяется на сервере.
 */
export async function POST(request: Request) {
  return respond(async () => {
    const dealer = await requireDealer(request);
    const b = await readJson<{ name?: unknown; phone?: unknown; addressComment?: unknown; items?: unknown }>(request);
    const name = typeof b.name === "string" ? b.name : "";
    const phone = normalizeTajikPhone(typeof b.phone === "string" ? b.phone : "");
    const addressComment = typeof b.addressComment === "string" ? b.addressComment : "";
    if (!name.trim()) throw new StoreError("Укажите имя покупателя.", 400);
    if (!phone) throw new StoreError("Укажите телефон в формате +992XXXXXXXXX.", 400);
    if (!Array.isArray(b.items) || !b.items.length) throw new StoreError("Добавьте в заказ хотя бы один товар.", 400);

    const order = await createDealerOrder(dealer.id, {
      name, phone, addressComment,
      items: b.items as Array<{ productId: string; quantity: number }>,
    });
    return { success: true, orderId: order.id, orderNumber: order.orderNumber, total: order.total, status: order.status };
  }, 201);
}
