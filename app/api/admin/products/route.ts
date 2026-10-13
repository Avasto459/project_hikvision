import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { createProduct, getAllProducts, StoreError } from "@/lib/db";
import { parseProductImages, parseProductSpecifications } from "@/lib/product-input";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ products: await getAllProducts() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка доступа." }, {
      status: error instanceof StoreError ? error.status : 500,
    });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);

    const body = (await request.json()) as {
      name?: string;
      slug?: string;
      sku?: string;
      brand?: string;
      shortDescription?: string;
      description?: string;
      price?: number;
      previousPrice?: number | null;
      image?: string;
      sourceUrl?: string;
      images?: unknown;
      specifications?: unknown;
      categoryId?: string;
      stock?: number;
      featured?: number;
      type?: string;
    };

    if (!body.name?.trim() || !/^[a-z0-9-]+$/.test(body.slug || "") || !body.categoryId) {
      throw new StoreError("Название, slug и категория обязательны. Slug использует латинские буквы, цифры и дефисы.", 400);
    }
    if (body.type !== undefined && body.type !== "product" && body.type !== "service") {
      throw new StoreError("Тип позиции: product (товар) или service (услуга).", 400);
    }
    const isService = body.type === "service";
    // у услуги нет остатка — поле остатка не требуется
    if (!Number.isSafeInteger(body.price) || (body.price as number) < 0 ||
        (!isService && (!Number.isInteger(body.stock) || (body.stock as number) < 0))) {
      throw new StoreError("Цена в сомони и остаток должны быть целыми неотрицательными числами.", 400);
    }
    if (body.previousPrice != null && (!Number.isSafeInteger(body.previousPrice) || body.previousPrice < 0)) {
      throw new StoreError("Старая цена должна быть целым неотрицательным числом.", 400);
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

    const images = parseProductImages(body.images, body.image || "");
    const product = await createProduct({
      name: body.name.trim(),
      slug: body.slug!,
      sku: body.sku?.trim() || "",
      brand: body.brand?.trim() || "",
      shortDescription: body.shortDescription || body.description || "",
      description: body.description || "",
      price: body.price!,
      previousPrice: body.previousPrice ?? null,
      images,
      specifications: parseProductSpecifications(body.specifications),
      image: images[0] || "",
      sourceUrl: body.sourceUrl?.trim() || "",
      categoryId: body.categoryId,
      stock: isService ? 0 : body.stock!,
      featured: body.featured ?? 0,
      type: isService ? "service" : "product",
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error && !(error instanceof StoreError)) console.error("Admin product creation failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать товар." }, {
      status: error instanceof StoreError ? error.status : 409,
    });
  }
}
