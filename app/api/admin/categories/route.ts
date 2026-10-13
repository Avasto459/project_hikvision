import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { createCategory, getAdminCategories, StoreError } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ categories: await getAdminCategories() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка доступа." }, {
      status: error instanceof StoreError ? error.status : 500,
    });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as { name?: string; slug?: string; subtitle?: string; description?: string; image?: string; parentId?: string | null; sort?: number };
    if (!body.name?.trim() || !/^[a-z0-9-]+$/.test(body.slug || "")) {
      throw new StoreError("Укажите название и slug из латинских букв, цифр и дефисов.", 400);
    }

    const category = await createCategory({
      name: body.name.trim(),
      slug: body.slug!,
      subtitle: body.subtitle || "",
      description: body.description || "",
      image: body.image || "",
      parentId: body.parentId || null, // привязка подкатегории к главной категории
      sort: Number.isFinite(Number(body.sort)) ? Number(body.sort) : 0,
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать категорию." }, {
      status: error instanceof StoreError ? error.status : 409,
    });
  }
}
