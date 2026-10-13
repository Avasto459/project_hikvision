import { NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/api-auth";
import { StoreError } from "@/lib/db";
import { MAX_SCAN_BYTES, validateScan, type PassportScanFile } from "@/lib/hasi";

export { requireAdmin };

export async function requireDealer(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "DEALER") throw new StoreError("Раздел доступен только дилерам.", 403);
  return user;
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new StoreError("Некорректный запрос.", 400);
  }
}

/** Единый обработчик: StoreError → его статус, прочее → 500 без утечки деталей. */
export async function respond<T>(work: () => Promise<T>, status = 200) {
  try {
    return NextResponse.json(await work(), { status });
  } catch (error) {
    if (error instanceof StoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("HASI API error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка. Повторите попытку позже." }, { status: 500 });
  }
}

/**
 * Тело запроса дилера: либо JSON, либо multipart/form-data
 * (поле `data` — JSON-строка с полями, поле `passportScan` — файл PNG/JPG/WEBP/PDF).
 */
export async function readDealerRequest<T extends Record<string, unknown>>(request: Request): Promise<{ data: T; scan: PassportScanFile | null }> {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("multipart/form-data")) return { data: await readJson<T>(request), scan: null };

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new StoreError("Не удалось прочитать форму. Проверьте размер файла (до 4 МБ).", 400);
  }
  let data: T;
  try {
    data = JSON.parse(String(form.get("data") ?? "{}")) as T;
  } catch {
    throw new StoreError("Некорректные данные формы.", 400);
  }
  const file = form.get("passportScan");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_SCAN_BYTES) throw new StoreError("Скан паспорта больше 4 МБ — выберите файл поменьше.", 413);
    return { data, scan: validateScan(new Uint8Array(await file.arrayBuffer())) };
  }
  return { data, scan: null };
}
