import { NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth";
import { StoreError, getUserOrders } from "@/lib/db";
import { db } from "@/lib/db/client";
import { createCustomerOrder } from "@/lib/hasi";
import { normalizeTajikPhone } from "@/lib/phone";
import { sendNewOrderNotice } from "@/lib/telegram";
import { requireUser } from "@/lib/api-auth";

/** История заказов для УЖЕ существующих аккаунтов магазина (старый раздел). */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ orders: await getUserOrders(user.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить заказы." }, {
      status: error instanceof StoreError ? error.status : 500,
    });
  }
}

/**
 * POST /api/orders — заказ покупателя БЕЗ регистрации и входа (ТЗ 0.1).
 * Принимает: name, phone, addressComment, items[{productId, quantity}].
 * Заказ получает уникальный номер и попадает в «Свободные заявки» (pending_dealer).
 */
export async function POST(request: Request) {
  try {
    let body: { name?: unknown; phone?: unknown; addressComment?: unknown; items?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      throw new StoreError("Некорректный запрос.", 400);
    }
    const name = typeof body.name === "string" ? body.name : "";
    const phoneRaw = typeof body.phone === "string" ? body.phone : "";
    const addressComment = typeof body.addressComment === "string" ? body.addressComment : "";
    const phone = normalizeTajikPhone(phoneRaw);
    if (!name.trim()) throw new StoreError("Укажите имя.", 400);
    if (!phone) throw new StoreError("Укажите телефон в формате +992XXXXXXXXX.", 400);
    if (!addressComment.trim()) throw new StoreError("Укажите адрес или комментарий.", 400);
    if (!Array.isArray(body.items)) throw new StoreError("Корзина пуста.", 400);

    const order = await createCustomerOrder({
      name,
      phone,
      addressComment,
      items: body.items as Array<{ productId: string; quantity: number }>,
    });

    // Если покупатель зашёл в старый аккаунт, очищаем его серверную корзину (best-effort).
    if (getBearerToken(request.headers.get("authorization"))) {
      try {
        const user = await requireUser(request);
        await db.execute({ sql: "DELETE FROM cartItems WHERE userId=?", args: [user.id] });
      } catch { /* заказ уже оформлен — сбой очистки корзины не критичен */ }
    }

    // Уведомление в Telegram — строго после сохранения; его сбой не ломает оформление.
    try {
      await sendNewOrderNotice({
        orderNumber: order.orderNumber,
        firstName: name.trim(),
        lastName: "",
        phone,
        email: "",
        city: "",
        address: addressComment.trim(),
        comment: "Свободная заявка (ожидает дилера)",
        total: order.total,
        items: order.items.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.price })),
      });
    } catch (error) {
      console.error("Telegram order notification failed:", error instanceof Error ? error.message : error);
    }

    return NextResponse.json({
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      message: "Заказ оформлен! Ближайший дилер свяжется с вами.",
    }, { status: 201 });
  } catch (error) {
    if (error && !(error instanceof StoreError)) console.error("Order creation failed:", error);
    return NextResponse.json(
      { error: error instanceof StoreError ? error.message : "Не удалось оформить заказ. Повторите попытку." },
      { status: error instanceof StoreError ? error.status : 500 },
    );
  }
}
