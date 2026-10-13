import { listAvailableProducts } from "@/lib/hasi";
import { requireDealer, respond } from "@/lib/hasi-api";

export const dynamic = "force-dynamic";

/** GET — товары, доступные дилеру для нового заказа: опубликованные, остаток центрального склада > 0 (и услуги). */
export async function GET(request: Request) {
  return respond(async () => {
    await requireDealer(request);
    return { products: await listAvailableProducts() };
  });
}
