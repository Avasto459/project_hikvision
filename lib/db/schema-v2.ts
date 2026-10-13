/**
 * ШАГ 1 ТЗ HASI.TJ — схема БД v2 (snake_case, как в ТЗ).
 *
 * Файл самодостаточен и пока НЕ подключён к initializeSchema() — подключение происходит на Шаге 2
 * вместе с переписыванием API, потому что текущий код (lib/hasi.ts, кабинеты) работает со старой схемой.
 *
 * Что делает ensureV2Schema():
 *  1. Старые таблицы прежней реализации с теми же именами (dealer_identity, dealer_limits, distributors,
 *     warehouses, stock_movements, customer_orders, sales, settlements, commissions) переименовываются
 *     в legacy_<имя> — данные не теряются.
 *  2. Создаются таблицы v2 по ТЗ (+ несколько служебных колонок, помеченных «ДОП.»).
 *  3. Данные переносятся из legacy_* (идентичность, лимиты, склады, офферы, заявки, продажи, комиссии, движения).
 *  4. Сидируются профиль HASI (distributors.is_hasi=1) и центральный склад.
 * Всё выполняется ОДНОЙ транзакцией и идемпотентно (повторный запуск ничего не меняет).
 */
import type { Client } from "@libsql/client";

export const HASI_DISTRIBUTOR_ID = "hasi";
export const HASI_WAREHOUSE_ID = "hasi-central";
export const DEFAULT_DEALER_LIMIT_V2 = 10_000;

/** Маркерная колонка, по которой отличаем СТАРУЮ (camelCase) таблицу от новой. */
const LEGACY_MARKERS: Record<string, string> = {
  dealer_identity: "userId",
  dealer_limits: "dealerId",
  distributors: "userId",
  warehouses: "isCentral",
  stock_movements: "warehouseId",
  customer_orders: "orderNumber",
  sales: "orderId",
  settlements: "saleId",
  commissions: "beneficiary",
};

// @@CREATE_V2_START
export const CREATE_V2: string[] = [
  `CREATE TABLE IF NOT EXISTS distributors (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    contact    TEXT,
    status     TEXT DEFAULT 'active' CHECK (status IN ('active','blocked')),
    is_hasi    INTEGER DEFAULT 0,
    tariff     TEXT DEFAULT 'free',
    created_at TEXT NOT NULL,
    user_id    TEXT                      -- ДОП.: связь с аккаунтом роли DISTRIBUTOR (кто видит «только свои предложения»)
  )`,
  // профиль HASI может быть только один
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_distributors_single_hasi ON distributors(is_hasi) WHERE is_hasi = 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_distributors_user ON distributors(user_id) WHERE user_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS warehouses (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    address             TEXT,
    responsible_user_id TEXT,
    status              TEXT DEFAULT 'active' CHECK (status IN ('active','blocked')),
    created_at          TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS offers (
    id             TEXT PRIMARY KEY,
    product_id     TEXT NOT NULL,
    distributor_id TEXT NOT NULL,
    warehouse_id   TEXT NOT NULL,
    purchase_price REAL NOT NULL CHECK (purchase_price >= 0),
    sale_price     REAL NOT NULL CHECK (sale_price >= 0),
    stock          INTEGER DEFAULT 0 CHECK (stock >= 0),
    status         TEXT DEFAULT 'active',
    created_at     TEXT NOT NULL,
    UNIQUE (product_id, distributor_id, warehouse_id),
    FOREIGN KEY (product_id)     REFERENCES products(id)     ON DELETE CASCADE,
    FOREIGN KEY (distributor_id) REFERENCES distributors(id),
    FOREIGN KEY (warehouse_id)   REFERENCES warehouses(id)
  )`,
  `CREATE INDEX IF NOT EXISTS v2_offers_product ON offers(product_id, status)`,
  `CREATE INDEX IF NOT EXISTS v2_offers_distributor ON offers(distributor_id)`,

  `CREATE TABLE IF NOT EXISTS dealer_identity (
    dealer_id           TEXT PRIMARY KEY,
    passport_data       TEXT,            -- JSON: {fullName, number, birthDate, issuedBy, issueDate, registrationAddress, notes}
    entered_by_admin_id TEXT,
    verified_at         TEXT,
    passport_scan_url   TEXT NOT NULL DEFAULT '',   -- ДОП.: защищённая ссылка на скан (виден только админу)
    passport_scan_mime  TEXT NOT NULL DEFAULT '',
    passport_scan_data  BLOB,
    FOREIGN KEY (dealer_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS dealer_limits (
    dealer_id    TEXT PRIMARY KEY,
    limit_amount REAL DEFAULT 10000 CHECK (limit_amount >= 0),
    used_amount  REAL DEFAULT 0     CHECK (used_amount >= 0),
    updated_at   TEXT NOT NULL,
    FOREIGN KEY (dealer_id) REFERENCES users(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS stock_movements (
    id             TEXT PRIMARY KEY,
    product_id     TEXT NOT NULL,
    warehouse_id   TEXT NOT NULL,
    dealer_id      TEXT,
    type           TEXT NOT NULL CHECK (type IN ('receipt','issued','return','adjust','payment')),
    quantity       INTEGER NOT NULL,
    purchase_price REAL NOT NULL,
    created_at     TEXT NOT NULL,
    created_by     TEXT,
    note           TEXT,
    order_id       TEXT                  -- ДОП.: «выдача под ID заказа»
  )`,
  `CREATE INDEX IF NOT EXISTS v2_movements_dealer ON stock_movements(dealer_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS v2_movements_product ON stock_movements(product_id, warehouse_id)`,

  `CREATE TABLE IF NOT EXISTS customer_orders (
    id               TEXT PRIMARY KEY,
    order_number     TEXT UNIQUE NOT NULL,           -- HASI-YYYYMMDD-NNN
    customer_name    TEXT NOT NULL,
    customer_phone   TEXT NOT NULL,
    items            TEXT NOT NULL,                  -- JSON: [{product_id, offer_id?, name, sku, quantity, unit_price, line_total, type}]
    status           TEXT DEFAULT 'free' CHECK (status IN ('free','accepted','picked_up','sold','cancelled')),
    dealer_id        TEXT,
    total            REAL DEFAULT 0,
    created_at       TEXT NOT NULL,
    accepted_at      TEXT,
    sold_at          TEXT,
    customer_address TEXT NOT NULL DEFAULT '',       -- ДОП.: форма checkout (адрес, город, комментарий)
    customer_city    TEXT NOT NULL DEFAULT '',
    comment          TEXT NOT NULL DEFAULT '',
    picked_up_at     TEXT,
    cancelled_at     TEXT,
    cancel_reason    TEXT,
    FOREIGN KEY (dealer_id) REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS v2_orders_status ON customer_orders(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS v2_orders_dealer ON customer_orders(dealer_id, status)`,

  `CREATE TABLE IF NOT EXISTS sales (
    id             TEXT PRIMARY KEY,
    order_id       TEXT NOT NULL UNIQUE,
    dealer_id      TEXT NOT NULL,
    total          REAL NOT NULL,
    payment_method TEXT,
    status         TEXT DEFAULT 'sold',
    sold_at        TEXT NOT NULL,
    purchase_total REAL NOT NULL DEFAULT 0,          -- ДОП.: закупочная стоимость (сколько освободить в used_amount)
    FOREIGN KEY (order_id) REFERENCES customer_orders(id)
  )`,
  `CREATE INDEX IF NOT EXISTS v2_sales_dealer ON sales(dealer_id, sold_at)`,

  `CREATE TABLE IF NOT EXISTS settlements (
    id             TEXT PRIMARY KEY,
    sale_id        TEXT NOT NULL,
    distributor_id TEXT NOT NULL,
    amount         REAL NOT NULL,
    status         TEXT DEFAULT 'pending',
    paid_at        TEXT,
    created_at     TEXT NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (distributor_id) REFERENCES distributors(id)
  )`,

  `CREATE TABLE IF NOT EXISTS commissions (
    id                TEXT PRIMARY KEY,
    sale_id           TEXT NOT NULL,
    dealer_share      REAL NOT NULL,                 -- purchase_price * 0.03
    hasi_fee          REAL NOT NULL,                 -- purchase_price * 0.07
    distributor_price REAL NOT NULL,                 -- purchase_price
    status            TEXT DEFAULT 'pending',
    paid_at           TEXT,
    created_at        TEXT NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_commissions_sale ON commissions(sale_id)`,

  // ДОП.: суточный счётчик для HASI-YYYYMMDD-NNN (инкремент атомарный, без дублей)
  `CREATE TABLE IF NOT EXISTS order_counters (
    day  TEXT PRIMARY KEY,
    last INTEGER NOT NULL DEFAULT 0
  )`,
];
// @@CREATE_V2_END

// @@SEED_START
/** Базовые строки: профиль HASI и центральный склад (нужны ДО переноса — на них ссылаются офферы). */
export const SEED_BASE: string[] = [
  `INSERT OR IGNORE INTO distributors(id,name,contact,status,is_hasi,tariff,created_at)
   VALUES('hasi','HASI Market','',  'active',1,'free',datetime('now'))`,
  `INSERT OR IGNORE INTO warehouses(id,name,address,status,created_at)
   VALUES('hasi-central','Центральный склад HASI','', 'active',datetime('now'))`,
];
/** После переноса: у каждого дилера обязана быть строка лимита (10 000 по умолчанию). */
export const SEED_LIMITS: string[] = [
  `INSERT OR IGNORE INTO dealer_limits(dealer_id,limit_amount,used_amount,updated_at)
   SELECT id,10000,0,datetime('now') FROM users WHERE role='DEALER'`,
];
// @@SEED_END

/** Перенос данных из legacy_* (выполняется только если соответствующие legacy-таблицы есть). */
type Step = { needs: string[]; sql: string };
// @@MIGRATE_START
export const MIGRATE_LEGACY: Step[] = [
  { needs: ["distributors"], sql: `INSERT OR IGNORE INTO distributors(id,name,contact,status,is_hasi,tariff,created_at,user_id)
    SELECT id,name,phone,CASE WHEN status='active' THEN 'active' ELSE 'blocked' END,0,'free',createdAt,userId FROM legacy_distributors` },
  { needs: ["warehouses"], sql: `INSERT OR IGNORE INTO warehouses(id,name,address,responsible_user_id,status,created_at)
    SELECT id,name,address,NULL,'active',createdAt FROM legacy_warehouses` },
  { needs: ["dealer_identity"], sql: `INSERT OR IGNORE INTO dealer_identity(dealer_id,passport_data,entered_by_admin_id,verified_at,passport_scan_url,passport_scan_mime,passport_scan_data)
    SELECT userId,
           json_object('fullName',fullName,'number',passportNumber,'birthDate',birthDate,'issuedBy',issuedBy,
                       'issueDate',issueDate,'registrationAddress',registrationAddress,'notes',notes),
           NULLIF(enteredBy,''), NULL, COALESCE(passportScanUrl,''), COALESCE(passportScanMime,''), passportScanData
    FROM legacy_dealer_identity` },
  // used_amount = закупка по незакрытым выдачам (то, что раньше считалось «на лету»)
  { needs: ["dealer_limits"], sql: `INSERT OR IGNORE INTO dealer_limits(dealer_id,limit_amount,used_amount,updated_at)
    SELECT l.dealerId, l.limitAmount,
           COALESCE((SELECT SUM(s.purchaseTotal) FROM legacy_sales s WHERE s.dealerId=l.dealerId AND s.status IN ('issued','payment_reported')),0),
           l.updatedAt
    FROM legacy_dealer_limits l` },
  // старые «остатки центрального склада» → офферы профиля HASI
  { needs: ["warehouses"], sql: `INSERT OR IGNORE INTO offers(id,product_id,distributor_id,warehouse_id,purchase_price,sale_price,stock,status,created_at)
    SELECT o.id,o.productId,COALESCE(w.distributorId,'hasi'),o.warehouseId,o.purchasePrice,p.price,o.qty,'active',o.updatedAt
    FROM offers_stock o JOIN products p ON p.id=o.productId LEFT JOIN legacy_warehouses w ON w.id=o.warehouseId` },
  { needs: ["customer_orders"], sql: `INSERT OR IGNORE INTO customer_orders(id,order_number,customer_name,customer_phone,items,status,dealer_id,total,
        created_at,accepted_at,sold_at,customer_address,picked_up_at)
    SELECT o.id,o.orderNumber,o.customerName,o.phone,
           COALESCE((SELECT json_group_array(json_object('product_id',i.productId,'name',i.name,'sku',i.sku,'quantity',i.quantity,
                       'unit_price',i.unitPrice,'line_total',i.lineTotal,'type',COALESCE(i.itemType,'product')))
                     FROM order_items i WHERE i.orderId=o.id),'[]'),
           CASE o.status WHEN 'pending_dealer' THEN 'free' WHEN 'accepted' THEN 'accepted'
                         WHEN 'issued' THEN 'picked_up' WHEN 'payment_reported' THEN 'picked_up'
                         WHEN 'completed' THEN 'sold' ELSE 'cancelled' END,
           o.dealerId,o.total,o.createdAt,o.acceptedAt,
           (SELECT s.settledAt FROM legacy_sales s WHERE s.orderId=o.id),
           o.addressComment,o.issuedAt
    FROM legacy_customer_orders o` },
  { needs: ["sales", "customer_orders"], sql: `INSERT OR IGNORE INTO sales(id,order_id,dealer_id,total,payment_method,status,sold_at,purchase_total)
    SELECT id,orderId,dealerId,retailTotal,customerPaymentMethod,CASE WHEN status='settled' THEN 'paid' ELSE 'sold' END,createdAt,purchaseTotal
    FROM legacy_sales` },
  { needs: ["sales"], sql: `INSERT OR IGNORE INTO commissions(id,sale_id,dealer_share,hasi_fee,distributor_price,status,paid_at,created_at)
    SELECT 'c-'||s.id, s.id,
           COALESCE((SELECT c.amount FROM legacy_commissions c WHERE c.saleId=s.id AND c.beneficiary='dealer'),0),
           COALESCE((SELECT c.amount FROM legacy_commissions c WHERE c.saleId=s.id AND c.beneficiary='hasi'),0),
           s.purchaseTotal,
           CASE WHEN EXISTS(SELECT 1 FROM legacy_commissions c WHERE c.saleId=s.id AND c.beneficiary='dealer' AND c.status='paid_out') THEN 'paid' ELSE 'pending' END,
           NULL, s.createdAt
    FROM legacy_sales s` },
  { needs: ["stock_movements"], sql: `INSERT OR IGNORE INTO stock_movements(id,product_id,warehouse_id,dealer_id,type,quantity,purchase_price,created_at,created_by,note,order_id)
    SELECT id,productId,warehouseId,dealerId,CASE type WHEN 'issue' THEN 'issued' ELSE type END,qty,unitPurchasePrice,createdAt,NULL,note,orderId
    FROM legacy_stock_movements` },
];
// @@MIGRATE_END

async function columns(db: Client, table: string): Promise<string[]> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((x) => String(x.name));
}

async function ensureColumn(db: Client, table: string, column: string, definition: string) {
  const cols = await columns(db, table);
  if (cols.length && !cols.includes(column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Какие из таблиц ТЗ ещё имеют СТАРУЮ форму. */
async function detectLegacy(db: Client): Promise<string[]> {
  const found: string[] = [];
  for (const [table, marker] of Object.entries(LEGACY_MARKERS)) {
    if ((await columns(db, table)).includes(marker)) found.push(table);
  }
  return found;
}

export async function ensureV2Schema(db: Client): Promise<void> {
  // колонки products из ТЗ (specifications и images уже есть)
  await ensureColumn(db, "products", "distributor_id", "TEXT");
  await ensureColumn(db, "products", "warehouse_id", "TEXT");

  const run = async () => {
    const legacy = await detectLegacy(db);
    // старые таблицы могли быть созданы до добавления этих колонок — выравниваем, чтобы перенос был статичным SQL
    if (legacy.includes("dealer_identity")) {
      await ensureColumn(db, "dealer_identity", "passportScanUrl", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db, "dealer_identity", "passportScanMime", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db, "dealer_identity", "passportScanData", "BLOB");
    }
    if (legacy.includes("customer_orders")) await ensureColumn(db, "order_items", "itemType", "TEXT NOT NULL DEFAULT 'product'");

    const stmts: string[] = [
      ...legacy.map((t) => `ALTER TABLE ${t} RENAME TO legacy_${t}`),
      ...CREATE_V2,
      ...SEED_BASE,
      ...MIGRATE_LEGACY.filter((s) => s.needs.every((t) => legacy.includes(t))).map((s) => s.sql),
      ...SEED_LIMITS,
    ];
    await db.batch(stmts, "write"); // одна транзакция: либо всё, либо ничего
  };

  try {
    await run();
  } catch (error) {
    // параллельный холодный старт мог успеть первым — тогда legacy-таблиц уже нет
    if ((await detectLegacy(db)).length) throw error;
  }
}
