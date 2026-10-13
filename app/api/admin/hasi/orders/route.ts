import { listAllOrdersAdmin } from "@/lib/hasi";
import { requireAdmin, respond } from "@/lib/hasi-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(async () => {
    await requireAdmin(request);
    const status = new URL(request.url).searchParams.get("status") || undefined;
    return { orders: await listAllOrdersAdmin(status) };
  });
}
