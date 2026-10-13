import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { deleteProductById, StoreError, updateProductById, type Product } from "@/lib/db";
import { parseProductImages, parseProductSpecifications } from "@/lib/product-input";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await request.json() as Partial<Product> & { images?: unknown; specifications?: unknown };
    if (body.slug !== undefined && (typeof body.slug !== "string" || !/^[a-z0-9-]+$/.test(body.slug))) {
      throw new StoreError("Некорректный slug товара.", 400);
    }
    if (body.price !== undefined && (!Number.isSafeInteger(body.price) || (body.price as number) < 0)) {
      throw new StoreError("Цена должна быть целым неотрицательным числом в сомони.", 400);
    }
    if (body.previousPrice !== undefined && body.previousPrice !== null &&
        (!Number.isSafeInteger(body.previousPrice) || body.previousPrice < 0)) {
      throw new StoreError("Старая цена должна быть целым неотрицательным числом.", 400);
    }
    if (body.type !== "service" && body.stock !== undefined && (!Number.isInteger(body.stock) || (body.stock as number) < 0)) {
      throw new StoreError("Количество на складе должно быть целым неотрицательным числом.", 400);
    }
    if (body.type !== undefined && body.type !== "product" && body.type !== "service") {
      throw new StoreError("Тип позиции: product (товар) или service (услуга).", 400);
    }
    if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200)) {
      throw new StoreError("Название товара обязательно и не должно превышать 200 символов.", 400);
    }
    if (body.isPublished !== undefined && body.isPublished !== 0 && body.isPublished !== 1) {
      throw new StoreError("Недопустимое значение публикации товара.", 400);
    }
    if (body.featured !== undefined && body.featured !== 0 && body.featured !== 1) {
      throw new StoreError("Недопустимое значение популярности товара.", 400);
    }
    if (body.image !== undefined && (typeof body.image !== "string" || body.image.length > 2048)) {
      throw new StoreError("Слишком длинный адрес изображения.", 400);
    }
    if (body.sourceUrl !== undefined && (typeof body.sourceUrl !== "string" ||
        body.sourceUrl.length > 2048 || body.sourceUrl && !/^https:\/\/\S+$/i.test(body.sourceUrl))) {
      throw new StoreError("Укажите корректный HTTPS-адрес исходного товара.", 400);
    }
    const images = body.images !== undefined ? parseProductImages(body.images) : undefined;
    const specifications = body.specifications !== undefined ? parseProductSpecifications(body.specifications) : undefined;
    const product = await updateProductById(id, {
      ...body,
      ...(images !== undefined ? { images, image: images[0] || "" } : {}),
      ...(specifications !== undefined ? { specifications } : {}),
    });
    if (!product) throw new StoreError("Товар не найден.", 404);
    return NextResponse.json({ product });
  } catch (error) {
    if (error && !(error instanceof StoreError)) console.error("Admin product update failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить товар." }, {
      status: error instanceof StoreError ? error.status : 409,
    });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    await deleteProductById(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error && !(error instanceof StoreError)) console.error("Admin product deletion failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить товар." }, {
      status: error instanceof StoreError ? error.status : 500,
    });
  }
}
