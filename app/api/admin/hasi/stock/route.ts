import { listCentralStock } from "@/lib/hasi";
import { requireAdmin, respond } from "@/lib/hasi-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(async () => {
    await requireAdmin(request);
    return { stock: await listCentralStock() };
  });
}
