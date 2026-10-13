import { createDistributor, listDistributors } from "@/lib/hasi";
import { readJson, requireAdmin, respond } from "@/lib/hasi-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(async () => {
    await requireAdmin(request);
    return { distributors: await listDistributors() };
  });
}

export async function POST(request: Request) {
  return respond(async () => {
    await requireAdmin(request);
    const b = await readJson<{ name?: string; email?: string; phone?: string; password?: string }>(request);
    const id = await createDistributor({ name: String(b.name ?? ""), email: String(b.email ?? ""), phone: b.phone, password: String(b.password ?? "") });
    return { success: true, id };
  }, 201);
}
