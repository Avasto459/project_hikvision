import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { deleteCategoryById, StoreError, updateCategoryById, type Category } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await request.json() as Partial<Category>;
    if (body.slug !== undefined && (typeof body.slug !== "string" || !/^[a-z0-9-]+$/.test(body.slug))) {
      throw new StoreError("Некорректный slug категории.", 400);
    }
    if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120)) {
      throw new StoreError("Название категории обязательно и не должно превышать 120 символов.", 400);
    }
    if (body.status !== undefined && body.status !== "published" && body.status !== "draft") {
      throw new StoreError("Недопустимый статус категории.", 400);
    }
    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
      throw new StoreError("Некорректная родительская категория.", 400);
    }
    const category = await updateCategoryById(id, body);
    if (!category) throw new StoreError("Категория не найдена.", 404);
    return NextResponse.json({ category });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить категорию." }, {
      status: error instanceof StoreError ? error.status : 409,
    });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    await deleteCategoryById(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить категорию." }, {
      status: error instanceof StoreError ? error.status : 409,
    });
  }
}
