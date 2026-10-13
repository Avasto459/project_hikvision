import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import type { Row } from "@libsql/client";
import { db } from "@/lib/db/client";
import { initializeSchema } from "@/lib/db/schema";
import { StoreError, getSetting, setSetting } from "@/lib/db";
import {
  ACCOUNT_STATUSES, CENTRAL_WAREHOUSE_ID, DEALER_COMMISSION_RATE, DEFAULT_DEALER_LIMIT,
  DEFAULT_LIMIT_SETTING_KEY, DEFAULT_MARKUP, HASI_COMMISSION_RATE, round2, type AccountStatus,
} from "@/lib/hasi-config";

/* ───────────── общие помощники ───────────── */

const now = () => new Date().toISOString();
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => Number(v ?? 0);

export async function hasiReady() {
  await initializeSchema();
  // Каждому опубликованному товару — строка прайс-листа центрального склада (если ещё нет).
  await db.execute({
    sql: `INSERT OR IGNORE INTO offers_stock(id,warehouseId,productId,qty,purchasePrice,updatedAt)
          SELECT ? || ':' || id, ?, id, MAX(stock,0), ROUND(price / ?, 2), ? FROM products WHERE type='product'`,
    args: [CENTRAL_WAREHOUSE_ID, CENTRAL_WAREHOUSE_ID, DEFAULT_MARKUP, now()],
  });
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function assertActiveDealer(dealerId: string) {
  const r = await db.execute({ sql: "SELECT role,status,isBlocked FROM users WHERE id=? LIMIT 1", args: [dealerId] });
  const u = r.rows[0];
  if (!u || str(u.role) !== "DEALER") throw new StoreError("Раздел доступен только дилерам.", 403);
  if (num(u.isBlocked) || str(u.status) === "blocked") throw new StoreError("Аккаунт заблокирован. Свяжитесь с администрацией HASI.", 403);
  if (str(u.status) !== "active") throw new StoreError("Аккаунт ещё не активирован администратором.", 403);
}

/* ───────────── Покупатель: заказ без регистрации ───────────── */

export type GuestOrderInput = {
  name: string;
  phone: string;
  addressComment: string;
  /** Если заказ создаёт сам дилер — он сразу закрепляется за ним (минуя «Свободные заявки»). */
  dealerId?: string | null;
  items: Array<{ productId: string; quantity: number }>;
};

export async function createCustomerOrder(input: GuestOrderInput) {
  await hasiReady();
  const name = input.name.trim();
  const addressComment = input.addressComment.trim();
  if (name.length < 2 || name.length > 120) throw new StoreError("Укажите имя (2–120 символов).", 400);
  if (addressComment.length < 3 || addressComment.length > 1000) throw new StoreError("Укажите адрес или комментарий (3–1000 символов).", 400);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) {
    throw new StoreError("Корзина пуста или содержит слишком много товаров.", 400);
  }

  // схлопываем дубли и валидируем количества
  const wanted = new Map<string, number>();
  for (const it of input.items) {
    if (typeof it?.productId !== "string" || !Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 999) {
      throw new StoreError("Некорректная позиция в корзине.", 400);
    }
    wanted.set(it.productId, (wanted.get(it.productId) ?? 0) + it.quantity);
  }

  const lines: Array<{ id: string; sku: string; name: string; image: string; price: number; quantity: number; type: string }> = [];
  for (const [productId, quantity] of wanted) {
    const r = await db.execute({
      sql: `SELECT p.id,p.sku,p.name,p.image,p.price,p.type,COALESCE(o.qty,0) AS qty
            FROM products p LEFT JOIN offers_stock o ON o.productId=p.id AND o.warehouseId=?
            WHERE p.id=? AND p.isPublished=1`,
      args: [CENTRAL_WAREHOUSE_ID, productId],
    });
    const p = r.rows[0];
    if (!p) throw new StoreError("Один из товаров больше недоступен.", 404);
    const type = str(p.type) === "service" ? "service" : "product";
    // услуги не имеют остатка на складе — проверяем наличие только для товаров
    if (type === "product" && quantity > num(p.qty)) throw new StoreError(`Недостаточно товара «${str(p.name)}» на складе (доступно ${num(p.qty)}).`, 409);
    lines.push({ id: str(p.id), sku: str(p.sku), name: str(p.name), image: str(p.image), price: num(p.price), quantity, type });
  }

  const total = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));
  const id = randomUUID();
  const createdAt = now();

  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = `HM-${createdAt.slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    try {
      await db.batch([
        {
          sql: `INSERT INTO customer_orders(id,orderNumber,customerName,phone,addressComment,total,status,dealerId,acceptedAt,createdAt)
                VALUES(?,?,?,?,?,?,?,?,?,?)`,
          args: [id, orderNumber, name, input.phone, addressComment, total, input.dealerId ? "accepted" : "pending_dealer", input.dealerId ?? null, input.dealerId ? createdAt : null, createdAt],
        },
        ...lines.map((l) => ({
          sql: `INSERT INTO order_items(id,orderId,productId,sku,name,image,unitPrice,quantity,lineTotal,itemType) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          args: [randomUUID(), id, l.id, l.sku, l.name, l.image, l.price, l.quantity, round2(l.price * l.quantity), l.type],
        })),
      ], "write");
      return { id, orderNumber, total, status: (input.dealerId ? "accepted" : "pending_dealer") as "accepted" | "pending_dealer", items: lines };
    } catch (e) {
      if (e instanceof Error && /UNIQUE.*orderNumber/i.test(e.message)) continue; // коллизия номера — повтор
      throw e;
    }
  }
  throw new StoreError("Не удалось присвоить номер заказа. Повторите попытку.", 500);
}

/* ───────────── Дилер: каталог для нового заказа ───────────── */

export type AvailableProduct = {
  id: string; name: string; sku: string; brand: string; price: number;
  /** Остаток центрального склада; null — услуга (остатка нет). */
  stock: number | null; image: string; images: string[]; type: "product" | "service";
};

/** Опубликованные товары с остатком > 0 (и услуги) для формы «Создать новый заказ». */
export async function listAvailableProducts(): Promise<AvailableProduct[]> {
  await hasiReady();
  const r = await db.execute({
    sql: `SELECT p.id,p.name,p.sku,p.brand,p.price,p.image,p.images,p.type,COALESCE(o.qty,0) AS qty
          FROM products p LEFT JOIN offers_stock o ON o.productId=p.id AND o.warehouseId=?
          WHERE p.isPublished=1 AND (p.type='service' OR COALESCE(o.qty,0) > 0)
          ORDER BY p.type, p.name LIMIT 500`,
    args: [CENTRAL_WAREHOUSE_ID],
  });
  return r.rows.map((x) => {
    let images: string[] = [];
    try { images = (JSON.parse(str(x.images)) as unknown[]).map(String).filter(Boolean); } catch { /* битый JSON — без галереи */ }
    const service = str(x.type) === "service";
    return {
      id: str(x.id), name: str(x.name), sku: str(x.sku), brand: str(x.brand), price: num(x.price),
      stock: service ? null : num(x.qty), image: str(x.image), images, type: service ? "service" : "product",
    };
  });
}

/** Заказ, созданный самим дилером (клиент пришёл к нему): сразу закреплён за ним, остаток и лимит проверяются при выдаче. */
export async function createDealerOrder(dealerId: string, input: Omit<GuestOrderInput, "dealerId">) {
  await assertActiveDealer(dealerId);
  return createCustomerOrder({ ...input, dealerId });
}

/* ───────────── представление заказов ───────────── */

export type OrderLineView = { name: string; sku: string; quantity: number; unitPrice: number; lineTotal: number };
export type SaleView = { status: string; retailTotal: number; purchaseTotal: number; dealerCommission: number; hasiCommission: number; customerPaymentMethod: string | null };
export type OrderView = {
  id: string; orderNumber: string; customerName: string; phone: string; addressComment: string;
  total: number; status: string; createdAt: string; acceptedAt: string | null; issuedAt: string | null;
  dealerId: string | null; dealerName: string | null; masked: boolean;
  items: OrderLineView[]; sale: SaleView | null;
};

const maskPhone = (p: string) => (p.length > 5 ? `${p.slice(0, 4)}${"•".repeat(Math.max(p.length - 6, 3))}${p.slice(-2)}` : "•••");
const firstWord = (s: string) => `${s.trim().split(/\s+/)[0] ?? ""}`;

async function hydrateOrders(rows: Row[], { mask }: { mask: (row: Row) => boolean }): Promise<OrderView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => str(r.id));
  const marks = ids.map(() => "?").join(",");
  const [items, sales, comms] = await Promise.all([
    db.execute({ sql: `SELECT orderId,name,sku,quantity,unitPrice,lineTotal FROM order_items WHERE orderId IN (${marks}) ORDER BY rowid`, args: ids }),
    db.execute({ sql: `SELECT id,orderId,status,retailTotal,purchaseTotal,customerPaymentMethod FROM sales WHERE orderId IN (${marks})`, args: ids }),
    db.execute({ sql: `SELECT s.orderId,c.beneficiary,c.amount FROM commissions c JOIN sales s ON s.id=c.saleId WHERE s.orderId IN (${marks})`, args: ids }),
  ]);
  return rows.map((r) => {
    const id = str(r.id);
    const masked = mask(r);
    const sale = sales.rows.find((s) => str(s.orderId) === id);
    const cm = comms.rows.filter((c) => str(c.orderId) === id);
    const commOf = (who: string) => num(cm.find((c) => str(c.beneficiary) === who)?.amount);
    return {
      id,
      orderNumber: str(r.orderNumber),
      customerName: masked ? `${firstWord(str(r.customerName))} …` : str(r.customerName),
      phone: masked ? maskPhone(str(r.phone)) : str(r.phone),
      // до принятия заявки показываем только начало адреса — ориентир по району
      addressComment: masked ? `${str(r.addressComment).slice(0, 60)}${str(r.addressComment).length > 60 ? "…" : ""}` : str(r.addressComment),
      total: num(r.total),
      status: str(r.status),
      createdAt: str(r.createdAt),
      acceptedAt: r.acceptedAt ? str(r.acceptedAt) : null,
      issuedAt: r.issuedAt ? str(r.issuedAt) : null,
      dealerId: r.dealerId ? str(r.dealerId) : null,
      dealerName: r.dealerName ? str(r.dealerName) : null,
      masked,
      items: items.rows.filter((i) => str(i.orderId) === id).map((i) => ({
        name: str(i.name), sku: str(i.sku), quantity: num(i.quantity), unitPrice: num(i.unitPrice), lineTotal: num(i.lineTotal),
      })),
      sale: sale ? {
        status: str(sale.status), retailTotal: num(sale.retailTotal), purchaseTotal: num(sale.purchaseTotal),
        dealerCommission: commOf("dealer"), hasiCommission: commOf("hasi"),
        customerPaymentMethod: sale.customerPaymentMethod ? str(sale.customerPaymentMethod) : null,
      } : null,
    };
  });
}

const ORDER_SELECT = `SELECT o.*, TRIM(u.firstName || ' ' || u.lastName) AS dealerName FROM customer_orders o LEFT JOIN users u ON u.id=o.dealerId`;

/* ───────────── Дилер: лимит, баланс, заявки ───────────── */

export async function getDefaultLimit(): Promise<number> {
  await hasiReady();
  const v = Number(await getSetting(DEFAULT_LIMIT_SETTING_KEY));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DEALER_LIMIT;
}

export async function setDefaultLimit(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100_000_000) throw new StoreError("Некорректный лимит.", 400);
  await setSetting(DEFAULT_LIMIT_SETTING_KEY, String(round2(value)));
}

export async function getDealerFinance(dealerId: string) {
  await hasiReady();
  const [lim, used, comm] = await Promise.all([
    db.execute({ sql: "SELECT limitAmount FROM dealer_limits WHERE dealerId=?", args: [dealerId] }),
    db.execute({ sql: "SELECT COALESCE(SUM(purchaseTotal),0) AS used FROM sales WHERE dealerId=? AND status IN ('issued','payment_reported')", args: [dealerId] }),
    db.execute({ sql: "SELECT status, COALESCE(SUM(amount),0) AS sum FROM commissions WHERE dealerId=? AND beneficiary='dealer' GROUP BY status", args: [dealerId] }),
  ]);
  const limit = lim.rows[0] ? num(lim.rows[0].limitAmount) : await getDefaultLimit();
  const usedAmount = round2(num(used.rows[0]?.used));
  const byStatus = (s: string) => round2(num(comm.rows.find((c) => str(c.status) === s)?.sum));
  return {
    limit,
    used: usedAmount,
    available: round2(Math.max(limit - usedAmount, 0)),
    payoutBalance: byStatus("available"),   // 3% после подтверждения оплаты админом
    pendingCommission: byStatus("pending"), // 3% по ещё не закрытым выдачам
    paidOut: byStatus("paid_out"),
  };
}

export async function getDealerProfile(dealerId: string) {
  await hasiReady();
  const r = await db.execute({
    sql: `SELECT u.id,u.firstName,u.lastName,u.email,u.phone,u.status,u.createdAt,i.passportNumber
          FROM users u LEFT JOIN dealer_identity i ON i.userId=u.id WHERE u.id=? AND u.role='DEALER'`,
    args: [dealerId],
  });
  const u = r.rows[0];
  if (!u) return null;
  const pn = str(u.passportNumber);
  return {
    id: str(u.id),
    name: `${str(u.firstName)} ${str(u.lastName)}`.trim(),
    email: str(u.email),
    phone: str(u.phone),
    status: str(u.status),
    createdAt: str(u.createdAt),
    passportMasked: pn ? `${"•".repeat(Math.max(pn.length - 3, 0))}${pn.slice(-3)}` : "",
  };
}

export async function listDealerOrders(dealerId: string, scope: "free" | "mine"): Promise<OrderView[]> {
  await hasiReady();
  if (scope === "free") {
    const r = await db.execute({ sql: `${ORDER_SELECT} WHERE o.status='pending_dealer' ORDER BY o.createdAt DESC LIMIT 100`, args: [] });
    return hydrateOrders(r.rows, { mask: () => true });
  }
  const r = await db.execute({ sql: `${ORDER_SELECT} WHERE o.dealerId=? ORDER BY o.createdAt DESC LIMIT 200`, args: [dealerId] });
  return hydrateOrders(r.rows, { mask: () => false });
}

async function getOwnOrder(dealerId: string, orderId: string): Promise<OrderView> {
  const r = await db.execute({ sql: `${ORDER_SELECT} WHERE o.id=? AND o.dealerId=?`, args: [orderId, dealerId] });
  const [view] = await hydrateOrders(r.rows, { mask: () => false });
  if (!view) throw new StoreError("Заявка не найдена.", 404);
  return view;
}

/**
 * «Первый нажавший — забирает»: одна условная UPDATE-инструкция.
 * SQLite выполняет её атомарно, поэтому из двух одновременных кликов
 * rowsAffected = 1 получит ровно один дилер.
 */
export async function claimOrder(dealerId: string, orderId: string) {
  await hasiReady();
  await assertActiveDealer(dealerId);
  const r = await db.execute({
    sql: `UPDATE customer_orders SET dealerId=?, status='accepted', acceptedAt=?
          WHERE id=? AND status='pending_dealer' AND dealerId IS NULL`,
    args: [dealerId, now(), orderId],
  });
  if (r.rowsAffected === 0) {
    const exists = await db.execute({ sql: "SELECT 1 FROM customer_orders WHERE id=?", args: [orderId] });
    if (!exists.rows.length) throw new StoreError("Заявка не найдена.", 404);
    throw new StoreError("Эту заявку уже принял другой дилер.", 409);
  }
  return getOwnOrder(dealerId, orderId);
}

/** Дилер может вернуть заявку в свободные, пока товар не выдан. */
export async function releaseOrder(dealerId: string, orderId: string) {
  await hasiReady();
  const r = await db.execute({
    sql: `UPDATE customer_orders SET dealerId=NULL, status='pending_dealer', acceptedAt=NULL
          WHERE id=? AND dealerId=? AND status='accepted'`,
    args: [orderId, dealerId],
  });
  if (r.rowsAffected === 0) throw new StoreError("Заявку нельзя вернуть: товар уже выдан или заявка не ваша.", 409);
}

/**
 * Выдача товара под ID заказа. Всё в одной write-транзакции:
 * проверка лимита (доступный = установленный − незакрытые выдачи), проверка и списание остатка
 * центрального склада, запись движения, продажи и комиссий. Любая ошибка откатывает всё.
 */
export async function issueOrder(dealerId: string, orderId: string) {
  await hasiReady();
  await assertActiveDealer(dealerId);
  const tx = await db.transaction("write");
  try {
    const o = (await tx.execute({ sql: "SELECT id,status,dealerId,total FROM customer_orders WHERE id=?", args: [orderId] })).rows[0];
    if (!o || str(o.dealerId) !== dealerId) throw new StoreError("Заявка не найдена.", 404);
    if (str(o.status) !== "accepted") throw new StoreError("Товар по этой заявке уже выдан или заявка недоступна.", 409);

    const lim = (await tx.execute({ sql: "SELECT limitAmount FROM dealer_limits WHERE dealerId=?", args: [dealerId] })).rows[0];
    const limit = lim ? num(lim.limitAmount) : await getDefaultLimit();
    const used = num((await tx.execute({
      sql: "SELECT COALESCE(SUM(purchaseTotal),0) AS used FROM sales WHERE dealerId=? AND status IN ('issued','payment_reported')",
      args: [dealerId],
    })).rows[0]?.used);

    const allItems = (await tx.execute({ sql: "SELECT productId,name,quantity,itemType FROM order_items WHERE orderId=?", args: [orderId] })).rows;
    // услуги (монтаж, прокладка кабеля и т.п.) не выдаются со склада и не занимают лимит
    const items = allItems.filter((i) => str(i.itemType) !== "service");
    if (!allItems.length) throw new StoreError("В заявке нет позиций.", 409);

    let purchaseTotal = 0;
    const picks: Array<{ productId: string; quantity: number; price: number }> = [];
    for (const it of items) {
      const offer = (await tx.execute({
        sql: "SELECT qty,purchasePrice FROM offers_stock WHERE warehouseId=? AND productId=?",
        args: [CENTRAL_WAREHOUSE_ID, str(it.productId)],
      })).rows[0];
      const qty = num(it.quantity);
      if (!offer || num(offer.qty) < qty) {
        throw new StoreError(`На складе недостаточно товара «${str(it.name)}»: нужно ${qty}, доступно ${offer ? num(offer.qty) : 0}.`, 409);
      }
      const price = num(offer.purchasePrice);
      purchaseTotal += price * qty;
      picks.push({ productId: str(it.productId), quantity: qty, price });
    }
    purchaseTotal = round2(purchaseTotal);

    const available = round2(limit - used);
    if (purchaseTotal > available) {
      throw new StoreError(`Недостаточно лимита: нужно ${purchaseTotal} сомони, доступно ${Math.max(available, 0)} сомони.`, 409);
    }

    const ts = now();
    for (const p of picks) {
      const upd = await tx.execute({
        sql: "UPDATE offers_stock SET qty=qty-?, updatedAt=? WHERE warehouseId=? AND productId=? AND qty>=?",
        args: [p.quantity, ts, CENTRAL_WAREHOUSE_ID, p.productId, p.quantity],
      });
      if (upd.rowsAffected !== 1) throw new StoreError("Остаток на складе изменился. Повторите выдачу.", 409);
      await tx.execute({ sql: "UPDATE products SET stock=MAX(stock-?,0) WHERE id=?", args: [p.quantity, p.productId] });
      await tx.execute({
        sql: `INSERT INTO stock_movements(id,warehouseId,productId,orderId,dealerId,type,qty,unitPurchasePrice,note,createdAt)
              VALUES(?,?,?,?,?,'issue',?,?,?,?)`,
        args: [randomUUID(), CENTRAL_WAREHOUSE_ID, p.productId, orderId, dealerId, p.quantity, p.price, "Выдача дилеру под заказ", ts],
      });
    }

    const saleId = randomUUID();
    await tx.execute({
      sql: `INSERT INTO sales(id,orderId,dealerId,warehouseId,retailTotal,purchaseTotal,status,createdAt) VALUES(?,?,?,?,?,?,'issued',?)`,
      args: [saleId, orderId, dealerId, CENTRAL_WAREHOUSE_ID, num(o.total), purchaseTotal, ts],
    });
    for (const [who, rate] of [["dealer", DEALER_COMMISSION_RATE], ["hasi", HASI_COMMISSION_RATE]] as const) {
      await tx.execute({
        sql: `INSERT INTO commissions(id,saleId,dealerId,beneficiary,rate,amount,status,createdAt) VALUES(?,?,?,?,?,?,'pending',?)`,
        args: [randomUUID(), saleId, dealerId, who, rate, round2(purchaseTotal * rate), ts],
      });
    }
    await tx.execute({ sql: "UPDATE customer_orders SET status='issued', issuedAt=? WHERE id=?", args: [ts, orderId] });
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  } finally {
    tx.close();
  }
  return getOwnOrder(dealerId, orderId);
}

/** Дилер сообщает: покупатель заплатил мне, а я оплатил складу закупочную стоимость. */
export async function reportPayment(dealerId: string, orderId: string, method: string, reference: string) {
  await hasiReady();
  await assertActiveDealer(dealerId);
  if (method !== "cash" && method !== "transfer") throw new StoreError("Укажите способ оплаты покупателя: наличные или перевод.", 400);
  const ref = reference.trim().slice(0, 200);
  const tx = await db.transaction("write");
  try {
    const sale = (await tx.execute({ sql: "SELECT id,purchaseTotal FROM sales WHERE orderId=? AND dealerId=? AND status='issued'", args: [orderId, dealerId] })).rows[0];
    if (!sale) throw new StoreError("Сообщить об оплате можно только по выданной и ещё не оплаченной заявке.", 409);
    const ts = now();
    await tx.execute({ sql: "UPDATE sales SET status='payment_reported', customerPaymentMethod=?, paymentReference=? WHERE id=?", args: [method, ref, str(sale.id)] });
    await tx.execute({
      sql: "INSERT INTO settlements(id,saleId,dealerId,amount,status,reportedAt) VALUES(?,?,?,?, 'pending', ?)",
      args: [randomUUID(), str(sale.id), dealerId, num(sale.purchaseTotal), ts],
    });
    await tx.execute({ sql: "UPDATE customer_orders SET status='payment_reported' WHERE id=?", args: [orderId] });
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  } finally {
    tx.close();
  }
  return getOwnOrder(dealerId, orderId);
}

/* ───────────── Админ: дилеры ───────────── */

export type DealerIdentityInput = {
  fullName: string; passportNumber: string; birthDate?: string; issuedBy?: string;
  issueDate?: string; registrationAddress?: string; notes?: string;
};

function cleanIdentity(i: DealerIdentityInput) {
  const fullName = str(i.fullName).trim();
  const passportNumber = str(i.passportNumber).trim().replace(/\s+/g, " ");
  if (fullName.length < 3 || fullName.length > 160) throw new StoreError("Укажите ФИО по паспорту (3–160 символов).", 400);
  if (passportNumber.length < 5 || passportNumber.length > 30) throw new StoreError("Укажите серию и номер паспорта (5–30 символов).", 400);
  const cut = (v: unknown, max: number) => str(v).trim().slice(0, max);
  return {
    fullName, passportNumber,
    birthDate: cut(i.birthDate, 20), issuedBy: cut(i.issuedBy, 200), issueDate: cut(i.issueDate, 20),
    registrationAddress: cut(i.registrationAddress, 300), notes: cut(i.notes, 500),
  };
}

/* ── скан паспорта: хранится в БД (приватно), отдаётся только админу ── */

export const MAX_SCAN_BYTES = 4 * 1024 * 1024; // лимит тела запроса на Vercel ≈ 4.5 МБ
export type PassportScanFile = { bytes: Uint8Array; mime: string };

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** Тип определяется по содержимому (магическим байтам), а не по расширению/заявленному MIME. */
export function detectScanMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function validateScan(bytes: Uint8Array): PassportScanFile {
  if (!bytes.length) throw new StoreError("Файл скана пустой.", 400);
  if (bytes.length > MAX_SCAN_BYTES) throw new StoreError("Скан паспорта больше 4 МБ — выберите файл поменьше.", 413);
  const mime = detectScanMime(bytes);
  if (!mime) throw new StoreError("Допустимые форматы скана: PNG, JPG, WEBP, PDF.", 400);
  return { bytes, mime };
}

const scanUrl = (dealerId: string) => `/api/admin/dealers/${dealerId}/passport?v=${Date.now()}`;

export async function getPassportScan(dealerId: string): Promise<PassportScanFile | null> {
  await hasiReady();
  const r = await db.execute({ sql: "SELECT passportScanMime AS mime, passportScanData AS data FROM dealer_identity WHERE userId=?", args: [dealerId] });
  const row = r.rows[0];
  if (!row || !row.data) return null;
  return { bytes: new Uint8Array(row.data as ArrayBuffer), mime: str(row.mime) };
}

/* ── дилеры: чтение ── */

export type DealerIdentityView = ReturnType<typeof cleanIdentity> & { passportScanUrl: string; passportScanMime: string };

export type DealerAdminView = {
  id: string; name: string; email: string; phone: string; status: AccountStatus; createdAt: string;
  limit: number; used: number; available: number; payoutBalance: number; openOrders: number;
  identity: DealerIdentityView | null;
};

export async function listDealersAdmin(): Promise<DealerAdminView[]> {
  await hasiReady();
  const r = await db.execute(`SELECT u.id,u.firstName,u.lastName,u.email,u.phone,u.status,u.createdAt FROM users u WHERE u.role='DEALER' AND u.status<>'deleted' ORDER BY u.createdAt DESC`);
  const out: DealerAdminView[] = [];
  for (const u of r.rows) {
    const id = str(u.id);
    const [fin, ident, open] = await Promise.all([
      getDealerFinance(id),
      // blob скана здесь не читаем — только ссылка и тип
      db.execute({ sql: `SELECT fullName,passportNumber,birthDate,issuedBy,issueDate,registrationAddress,notes,passportScanUrl,passportScanMime FROM dealer_identity WHERE userId=?`, args: [id] }),
      db.execute({ sql: "SELECT COUNT(*) AS c FROM customer_orders WHERE dealerId=? AND status IN ('accepted','issued','payment_reported')", args: [id] }),
    ]);
    const i = ident.rows[0];
    out.push({
      id, name: `${str(u.firstName)} ${str(u.lastName)}`.trim(), email: str(u.email), phone: str(u.phone),
      status: (ACCOUNT_STATUSES as readonly string[]).includes(str(u.status)) ? (str(u.status) as AccountStatus) : "pending",
      createdAt: str(u.createdAt),
      limit: fin.limit, used: fin.used, available: fin.available, payoutBalance: fin.payoutBalance,
      openOrders: num(open.rows[0]?.c),
      identity: i ? {
        fullName: str(i.fullName), passportNumber: str(i.passportNumber), birthDate: str(i.birthDate), issuedBy: str(i.issuedBy),
        issueDate: str(i.issueDate), registrationAddress: str(i.registrationAddress), notes: str(i.notes),
        passportScanUrl: str(i.passportScanUrl), passportScanMime: str(i.passportScanMime),
      } : null,
    });
  }
  return out;
}

/* ── дилеры: создание / изменение / удаление ── */

export async function createDealer(
  actorId: string,
  p: { name: string; email: string; phone?: string; password: string; status?: string; limit?: number; identity: DealerIdentityInput; scan?: PassportScanFile | null },
) {
  await hasiReady();
  const name = p.name.trim();
  const email = p.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw new StoreError("Укажите имя дилера.", 400);
  if (!validEmail(email)) throw new StoreError("Укажите корректный email.", 400);
  if (p.password.length < 8 || p.password.length > 128) throw new StoreError("Пароль дилера — от 8 до 128 символов.", 400);
  const status = (ACCOUNT_STATUSES as readonly string[]).includes(p.status ?? "") ? (p.status as AccountStatus) : "active";
  const identity = cleanIdentity(p.identity);
  const limit = p.limit === undefined ? await getDefaultLimit() : p.limit;
  if (!Number.isFinite(limit) || limit < 0 || limit > 100_000_000) throw new StoreError("Некорректный лимит.", 400);

  const dup = await db.execute({ sql: "SELECT 1 FROM users WHERE lower(email)=? LIMIT 1", args: [email] });
  if (dup.rows.length) throw new StoreError("Пользователь с таким email уже существует.", 409);

  const id = randomUUID();
  const ts = now();
  const [firstName, ...rest] = name.split(/\s+/);
  const stmts: Array<{ sql: string; args: Array<string | number | Uint8Array> }> = [
    {
      sql: `INSERT INTO users(id,firstName,lastName,email,phone,passwordHash,role,emailVerified,isBlocked,status,createdAt)
            VALUES(?,?,?,?,?,?, 'DEALER', 1, ?, ?, ?)`,
      args: [id, firstName, rest.join(" "), email, str(p.phone).trim().slice(0, 30), await bcrypt.hash(p.password, 10), status === "blocked" ? 1 : 0, status, ts],
    },
    {
      sql: `INSERT INTO dealer_identity(userId,fullName,passportNumber,birthDate,issuedBy,issueDate,registrationAddress,notes,enteredBy,createdAt,updatedAt)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, identity.fullName, identity.passportNumber, identity.birthDate, identity.issuedBy, identity.issueDate, identity.registrationAddress, identity.notes, actorId, ts, ts],
    },
    { sql: "INSERT INTO dealer_limits(dealerId,limitAmount,updatedBy,updatedAt) VALUES(?,?,?,?)", args: [id, round2(limit), actorId, ts] },
  ];
  if (p.scan) {
    stmts.push({
      sql: "UPDATE dealer_identity SET passportScanUrl=?, passportScanMime=?, passportScanData=?, updatedAt=? WHERE userId=?",
      args: [scanUrl(id), p.scan.mime, p.scan.bytes, ts, id],
    });
  }
  await db.batch(stmts, "write");
  return id;
}

export async function updateDealer(
  actorId: string,
  dealerId: string,
  p: {
    name?: string; email?: string; status?: string; limit?: number; phone?: string; password?: string;
    identity?: DealerIdentityInput; scan?: PassportScanFile | null;
  },
) {
  await hasiReady();
  const exists = await db.execute({ sql: "SELECT 1 FROM users WHERE id=? AND role='DEALER' AND status<>'deleted'", args: [dealerId] });
  if (!exists.rows.length) throw new StoreError("Дилер не найден.", 404);
  const ts = now();
  const stmts: Array<{ sql: string; args: Array<string | number | Uint8Array> }> = [];

  if (p.name !== undefined) {
    const name = p.name.trim();
    if (name.length < 2 || name.length > 120) throw new StoreError("Укажите ФИО дилера (2–120 символов).", 400);
    const [firstName, ...rest] = name.split(/\s+/);
    stmts.push({ sql: "UPDATE users SET firstName=?, lastName=? WHERE id=?", args: [firstName, rest.join(" "), dealerId] });
  }
  if (p.email !== undefined) {
    const email = p.email.trim().toLowerCase();
    if (!validEmail(email)) throw new StoreError("Укажите корректный email.", 400);
    const dup = await db.execute({ sql: "SELECT 1 FROM users WHERE lower(email)=? AND id<>? LIMIT 1", args: [email, dealerId] });
    if (dup.rows.length) throw new StoreError("Этот email уже используется другим пользователем.", 409);
    stmts.push({ sql: "UPDATE users SET email=? WHERE id=?", args: [email, dealerId] });
  }
  if (p.status !== undefined) {
    if (!(ACCOUNT_STATUSES as readonly string[]).includes(p.status)) throw new StoreError("Недопустимый статус аккаунта.", 400);
    stmts.push({ sql: "UPDATE users SET status=?, isBlocked=? WHERE id=?", args: [p.status, p.status === "blocked" ? 1 : 0, dealerId] });
  }
  if (p.limit !== undefined) {
    if (!Number.isFinite(p.limit) || p.limit < 0 || p.limit > 100_000_000) throw new StoreError("Некорректный лимит.", 400);
    stmts.push({
      sql: `INSERT INTO dealer_limits(dealerId,limitAmount,updatedBy,updatedAt) VALUES(?,?,?,?)
            ON CONFLICT(dealerId) DO UPDATE SET limitAmount=excluded.limitAmount, updatedBy=excluded.updatedBy, updatedAt=excluded.updatedAt`,
      args: [dealerId, round2(p.limit), actorId, ts],
    });
  }
  if (p.phone !== undefined) stmts.push({ sql: "UPDATE users SET phone=? WHERE id=?", args: [str(p.phone).trim().slice(0, 30), dealerId] });
  if (p.password) {
    if (p.password.length < 8 || p.password.length > 128) throw new StoreError("Пароль — от 8 до 128 символов.", 400);
    stmts.push({ sql: "UPDATE users SET passwordHash=? WHERE id=?", args: [await bcrypt.hash(p.password, 10), dealerId] });
  }
  if (p.identity) {
    const i = cleanIdentity(p.identity);
    stmts.push({
      sql: `INSERT INTO dealer_identity(userId,fullName,passportNumber,birthDate,issuedBy,issueDate,registrationAddress,notes,enteredBy,createdAt,updatedAt)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(userId) DO UPDATE SET fullName=excluded.fullName, passportNumber=excluded.passportNumber, birthDate=excluded.birthDate,
              issuedBy=excluded.issuedBy, issueDate=excluded.issueDate, registrationAddress=excluded.registrationAddress,
              notes=excluded.notes, enteredBy=excluded.enteredBy, updatedAt=excluded.updatedAt`,
      args: [dealerId, i.fullName, i.passportNumber, i.birthDate, i.issuedBy, i.issueDate, i.registrationAddress, i.notes, actorId, ts, ts],
    });
  }
  if (p.scan) {
    stmts.push({
      sql: "UPDATE dealer_identity SET passportScanUrl=?, passportScanMime=?, passportScanData=?, updatedAt=? WHERE userId=?",
      args: [scanUrl(dealerId), p.scan.mime, p.scan.bytes, ts, dealerId],
    });
  }
  if (stmts.length) await db.batch(stmts, "write");
}

/**
 * Удаление дилера.
 *  • нет истории заявок/продаж  → полное удаление из БД («deleted»);
 *  • история есть               → статус «deleted» (архив): вход закрыт, email освобождён, скан паспорта стёрт,
 *                                 сами заявки и расчёты сохраняются для отчётности.
 * Нельзя удалить дилера с незакрытыми заявками или невыплаченным балансом.
 */
export async function deleteDealer(dealerId: string): Promise<{ mode: "deleted" | "archived" }> {
  await hasiReady();
  const u = (await db.execute({ sql: "SELECT id FROM users WHERE id=? AND role='DEALER' AND status<>'deleted'", args: [dealerId] })).rows[0];
  if (!u) throw new StoreError("Дилер не найден.", 404);

  const open = num((await db.execute({
    sql: "SELECT COUNT(*) AS c FROM customer_orders WHERE dealerId=? AND status IN ('accepted','issued','payment_reported')", args: [dealerId],
  })).rows[0]?.c);
  if (open > 0) throw new StoreError(`Нельзя удалить: у дилера есть незакрытые заявки (${open}). Завершите или отмените их.`, 409);

  const balance = num((await db.execute({
    sql: "SELECT COALESCE(SUM(amount),0) AS s FROM commissions WHERE dealerId=? AND beneficiary='dealer' AND status='available'", args: [dealerId],
  })).rows[0]?.s);
  if (balance > 0) throw new StoreError(`Нельзя удалить: сначала выплатите дилеру баланс ${round2(balance)} сомони.`, 409);

  const history = num((await db.execute({
    sql: "SELECT (SELECT COUNT(*) FROM customer_orders WHERE dealerId=?) + (SELECT COUNT(*) FROM sales WHERE dealerId=?) AS c",
    args: [dealerId, dealerId],
  })).rows[0]?.c);

  if (history === 0) {
    await db.execute({ sql: "DELETE FROM users WHERE id=? AND role='DEALER'", args: [dealerId] }); // identity и limits удаляются каскадом
    return { mode: "deleted" };
  }

  await db.batch([
    {
      sql: "UPDATE users SET status='deleted', isBlocked=1, email=?, phone='', passwordHash=? WHERE id=?",
      args: [`deleted-${dealerId}@deleted.invalid`, await bcrypt.hash(randomBytes(24).toString("hex"), 8), dealerId],
    },
    { sql: "UPDATE dealer_identity SET passportScanUrl='', passportScanMime='', passportScanData=NULL, updatedAt=? WHERE userId=?", args: [now(), dealerId] },
  ], "write");
  return { mode: "archived" };
}

/* ───────────── Админ: заявки, расчёты, выплаты ───────────── */

export async function listAllOrdersAdmin(status?: string): Promise<OrderView[]> {
  await hasiReady();
  const r = status
    ? await db.execute({ sql: `${ORDER_SELECT} WHERE o.status=? ORDER BY o.createdAt DESC LIMIT 300`, args: [status] })
    : await db.execute(`${ORDER_SELECT} ORDER BY o.createdAt DESC LIMIT 300`);
  return hydrateOrders(r.rows, { mask: () => false });
}

export async function cancelOrderAdmin(orderId: string) {
  await hasiReady();
  const r = await db.execute({
    sql: "UPDATE customer_orders SET status='cancelled' WHERE id=? AND status IN ('pending_dealer','accepted')",
    args: [orderId],
  });
  if (r.rowsAffected === 0) throw new StoreError("Отменить можно только заявку, по которой товар ещё не выдан.", 409);
}

export type SettlementView = {
  id: string; saleId: string; orderId: string; orderNumber: string; dealerId: string; dealerName: string;
  amount: number; status: string; reportedAt: string; confirmedAt: string | null;
  customerPaymentMethod: string | null; paymentReference: string; dealerCommission: number; hasiCommission: number;
};

export async function listSettlementsAdmin(status?: string): Promise<SettlementView[]> {
  await hasiReady();
  const base = `SELECT st.id,st.saleId,st.dealerId,st.amount,st.status,st.reportedAt,st.confirmedAt,
      s.orderId,s.customerPaymentMethod,s.paymentReference,o.orderNumber,
      TRIM(u.firstName || ' ' || u.lastName) AS dealerName,
      COALESCE((SELECT amount FROM commissions c WHERE c.saleId=s.id AND c.beneficiary='dealer'),0) AS dealerCommission,
      COALESCE((SELECT amount FROM commissions c WHERE c.saleId=s.id AND c.beneficiary='hasi'),0) AS hasiCommission
    FROM settlements st JOIN sales s ON s.id=st.saleId JOIN customer_orders o ON o.id=s.orderId JOIN users u ON u.id=st.dealerId`;
  const r = status
    ? await db.execute({ sql: `${base} WHERE st.status=? ORDER BY st.reportedAt DESC LIMIT 300`, args: [status] })
    : await db.execute(`${base} ORDER BY st.reportedAt DESC LIMIT 300`);
  return r.rows.map((x) => ({
    id: str(x.id), saleId: str(x.saleId), orderId: str(x.orderId), orderNumber: str(x.orderNumber),
    dealerId: str(x.dealerId), dealerName: str(x.dealerName), amount: num(x.amount), status: str(x.status),
    reportedAt: str(x.reportedAt), confirmedAt: x.confirmedAt ? str(x.confirmedAt) : null,
    customerPaymentMethod: x.customerPaymentMethod ? str(x.customerPaymentMethod) : null,
    paymentReference: str(x.paymentReference), dealerCommission: num(x.dealerCommission), hasiCommission: num(x.hasiCommission),
  }));
}

/** Подтверждение оплаты: лимит освобождается (продажа закрывается), 3% дилера → доступный баланс выплаты. */
export async function confirmSettlement(actorId: string, settlementId: string) {
  await hasiReady();
  const tx = await db.transaction("write");
  try {
    const st = (await tx.execute({ sql: "SELECT id,saleId,status FROM settlements WHERE id=?", args: [settlementId] })).rows[0];
    if (!st) throw new StoreError("Расчёт не найден.", 404);
    if (str(st.status) !== "pending") throw new StoreError("Этот расчёт уже обработан.", 409);
    const ts = now();
    const saleId = str(st.saleId);
    await tx.execute({ sql: "UPDATE settlements SET status='confirmed', confirmedBy=?, confirmedAt=? WHERE id=?", args: [actorId, ts, settlementId] });
    await tx.execute({ sql: "UPDATE sales SET status='settled', settledAt=? WHERE id=?", args: [ts, saleId] });
    await tx.execute({ sql: "UPDATE customer_orders SET status='completed' WHERE id=(SELECT orderId FROM sales WHERE id=?)", args: [saleId] });
    await tx.execute({ sql: "UPDATE commissions SET status='available', availableAt=? WHERE saleId=? AND beneficiary='dealer'", args: [ts, saleId] });
    await tx.execute({ sql: "UPDATE commissions SET status='available', availableAt=? WHERE saleId=? AND beneficiary='hasi'", args: [ts, saleId] });
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  } finally {
    tx.close();
  }
}

/** Отклонение: оплата не подтверждена, лимит остаётся занятым, дилер может сообщить снова. */
export async function rejectSettlement(actorId: string, settlementId: string, note: string) {
  await hasiReady();
  const tx = await db.transaction("write");
  try {
    const st = (await tx.execute({ sql: "SELECT saleId,status FROM settlements WHERE id=?", args: [settlementId] })).rows[0];
    if (!st) throw new StoreError("Расчёт не найден.", 404);
    if (str(st.status) !== "pending") throw new StoreError("Этот расчёт уже обработан.", 409);
    const saleId = str(st.saleId);
    await tx.execute({ sql: "UPDATE settlements SET status='rejected', confirmedBy=?, confirmedAt=?, note=? WHERE id=?", args: [actorId, now(), note.trim().slice(0, 300), settlementId] });
    await tx.execute({ sql: "UPDATE sales SET status='issued' WHERE id=?", args: [saleId] });
    await tx.execute({ sql: "UPDATE customer_orders SET status='issued' WHERE id=(SELECT orderId FROM sales WHERE id=?)", args: [saleId] });
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  } finally {
    tx.close();
  }
}

/** Выплата дилеру всего доступного баланса (3%). */
export async function payoutDealer(dealerId: string) {
  await hasiReady();
  const tx = await db.transaction("write");
  try {
    const sum = num((await tx.execute({
      sql: "SELECT COALESCE(SUM(amount),0) AS s FROM commissions WHERE dealerId=? AND beneficiary='dealer' AND status='available'",
      args: [dealerId],
    })).rows[0]?.s);
    if (sum <= 0) throw new StoreError("Нет доступного баланса для выплаты.", 409);
    await tx.execute({ sql: "UPDATE commissions SET status='paid_out' WHERE dealerId=? AND beneficiary='dealer' AND status='available'", args: [dealerId] });
    await tx.commit();
    return round2(sum);
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  } finally {
    tx.close();
  }
}

export async function getHasiTotals() {
  await hasiReady();
  const r = await db.execute(`SELECT beneficiary,status,COALESCE(SUM(amount),0) AS sum FROM commissions GROUP BY beneficiary,status`);
  const pick = (b: string, s: string) => round2(num(r.rows.find((x) => str(x.beneficiary) === b && str(x.status) === s)?.sum));
  return { hasiEarned: pick("hasi", "available"), hasiPending: pick("hasi", "pending"), dealersToPay: pick("dealer", "available") };
}

/* ───────────── Админ: склад и прайс-лист ───────────── */

export type StockRow = { productId: string; name: string; sku: string; price: number; qty: number; purchasePrice: number };

export async function listCentralStock(): Promise<StockRow[]> {
  await hasiReady();
  const r = await db.execute({
    sql: `SELECT p.id AS productId,p.name,p.sku,p.price,o.qty,o.purchasePrice
          FROM offers_stock o JOIN products p ON p.id=o.productId WHERE o.warehouseId=? ORDER BY p.name`,
    args: [CENTRAL_WAREHOUSE_ID],
  });
  return r.rows.map((x) => ({
    productId: str(x.productId), name: str(x.name), sku: str(x.sku), price: num(x.price), qty: num(x.qty), purchasePrice: num(x.purchasePrice),
  }));
}

export async function updateCentralStock(actorId: string, productId: string, p: { qty?: number; purchasePrice?: number }) {
  await hasiReady();
  const cur = (await db.execute({ sql: "SELECT qty FROM offers_stock WHERE warehouseId=? AND productId=?", args: [CENTRAL_WAREHOUSE_ID, productId] })).rows[0];
  if (!cur) throw new StoreError("Товар не найден на складе.", 404);
  const ts = now();
  const stmts: Array<{ sql: string; args: Array<string | number> }> = [];
  if (p.purchasePrice !== undefined) {
    if (!Number.isFinite(p.purchasePrice) || p.purchasePrice < 0 || p.purchasePrice > 100_000_000) throw new StoreError("Некорректная закупочная цена.", 400);
    stmts.push({ sql: "UPDATE offers_stock SET purchasePrice=?, updatedAt=? WHERE warehouseId=? AND productId=?", args: [round2(p.purchasePrice), ts, CENTRAL_WAREHOUSE_ID, productId] });
  }
  if (p.qty !== undefined) {
    if (!Number.isInteger(p.qty) || p.qty < 0 || p.qty > 10_000_000) throw new StoreError("Остаток — целое число от 0.", 400);
    const delta = p.qty - num(cur.qty);
    stmts.push({ sql: "UPDATE offers_stock SET qty=?, updatedAt=? WHERE warehouseId=? AND productId=?", args: [p.qty, ts, CENTRAL_WAREHOUSE_ID, productId] });
    stmts.push({ sql: "UPDATE products SET stock=? WHERE id=?", args: [p.qty, productId] }); // витрина показывает тот же остаток
    if (delta !== 0) {
      stmts.push({
        sql: `INSERT INTO stock_movements(id,warehouseId,productId,orderId,dealerId,type,qty,unitPurchasePrice,note,createdAt)
              VALUES(?,?,?,NULL,NULL,?,?,0,?,?)`,
        args: [randomUUID(), CENTRAL_WAREHOUSE_ID, productId, delta > 0 ? "receipt" : "adjust", Math.abs(delta), `Корректировка администратором (${actorId})`, ts],
      });
    }
  }
  if (stmts.length) await db.batch(stmts, "write");
}

/* ───────────── Дистрибьюторы (роль + склады) ───────────── */

export async function createDistributor(p: { name: string; email: string; phone?: string; password: string }) {
  await hasiReady();
  const name = p.name.trim();
  const email = p.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw new StoreError("Укажите название дистрибьютора.", 400);
  if (!validEmail(email)) throw new StoreError("Укажите корректный email.", 400);
  if (p.password.length < 8 || p.password.length > 128) throw new StoreError("Пароль — от 8 до 128 символов.", 400);
  const dup = await db.execute({ sql: "SELECT 1 FROM users WHERE lower(email)=? LIMIT 1", args: [email] });
  if (dup.rows.length) throw new StoreError("Пользователь с таким email уже существует.", 409);

  const userId = randomUUID();
  const distId = randomUUID();
  const ts = now();
  const [firstName, ...rest] = name.split(/\s+/);
  await db.batch([
    {
      sql: `INSERT INTO users(id,firstName,lastName,email,phone,passwordHash,role,emailVerified,isBlocked,status,createdAt)
            VALUES(?,?,?,?,?,?, 'DISTRIBUTOR', 1, 0, 'active', ?)`,
      args: [userId, firstName, rest.join(" "), email, str(p.phone).trim().slice(0, 30), await bcrypt.hash(p.password, 10), ts],
    },
    { sql: "INSERT INTO distributors(id,userId,name,phone,status,createdAt) VALUES(?,?,?,?, 'active', ?)", args: [distId, userId, name, str(p.phone).trim().slice(0, 30), ts] },
    {
      sql: "INSERT INTO warehouses(id,name,code,distributorId,isCentral,address,createdAt) VALUES(?,?,?,?,0,'',?)",
      args: [randomUUID(), `Склад: ${name}`, `WH-${randomBytes(3).toString("hex").toUpperCase()}`, distId, ts],
    },
  ], "write");
  return distId;
}

export async function listDistributors() {
  await hasiReady();
  const r = await db.execute(`SELECT d.id,d.name,d.phone,d.status,d.createdAt,u.email,
      (SELECT COUNT(*) FROM warehouses w WHERE w.distributorId=d.id) AS warehouses
    FROM distributors d JOIN users u ON u.id=d.userId ORDER BY d.createdAt DESC`);
  return r.rows.map((x) => ({ id: str(x.id), name: str(x.name), phone: str(x.phone), status: str(x.status), email: str(x.email), warehouses: num(x.warehouses), createdAt: str(x.createdAt) }));
}

export async function getDistributorView(userId: string) {
  await hasiReady();
  const d = (await db.execute({ sql: "SELECT id,name,phone FROM distributors WHERE userId=?", args: [userId] })).rows[0];
  if (!d) return null;
  const w = await db.execute({
    sql: `SELECT w.id,w.name,w.code,COALESCE(SUM(o.qty),0) AS units,COUNT(o.id) AS positions
          FROM warehouses w LEFT JOIN offers_stock o ON o.warehouseId=w.id WHERE w.distributorId=? GROUP BY w.id ORDER BY w.name`,
    args: [str(d.id)],
  });
  return {
    id: str(d.id), name: str(d.name), phone: str(d.phone),
    warehouses: w.rows.map((x) => ({ id: str(x.id), name: str(x.name), code: str(x.code), units: num(x.units), positions: num(x.positions) })),
  };
}
