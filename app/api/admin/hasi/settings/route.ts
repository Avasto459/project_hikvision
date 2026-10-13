import { getDefaultLimit, setDefaultLimit } from "@/lib/hasi";
import { readJson, requireAdmin, respond } from "@/lib/hasi-api";

export async function GET(request: Request) {
  return respond(async () => {
    await requireAdmin(request);
    return { defaultLimit: await getDefaultLimit() };
  });
}

/** PUT { defaultLimit } — базовый лимит для новых дилеров (по умолчанию 10 000 сомони). */
export async function PUT(request: Request) {
  return respond(async () => {
    await requireAdmin(request);
    const b = await readJson<{ defaultLimit?: number }>(request);
    await setDefaultLimit(Number(b.defaultLimit));
    return { success: true, defaultLimit: await getDefaultLimit() };
  });
}
