import { NextResponse } from "next/server";
import { StoreError } from "@/lib/db";
import { getPassportScan } from "@/lib/hasi";
import { requireAdmin } from "@/lib/hasi-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Скан паспорта отдаётся ТОЛЬКО администратору (сессионная cookie или Bearer).
 * Файл не лежит в public/, поэтому прямой публичной ссылки на паспорт не существует.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await ctx.params;
    const scan = await getPassportScan(id);
    if (!scan) return NextResponse.json({ error: "Скан паспорта не загружен." }, { status: 404 });
    return new NextResponse(scan.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": scan.mime,
        "Content-Length": String(scan.bytes.byteLength),
        "Content-Disposition": "inline; filename=\"passport\"",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка." }, { status: error instanceof StoreError ? error.status : 500 });
  }
}
