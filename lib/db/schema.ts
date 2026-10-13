import { db } from "./client";
import { CENTRAL_WAREHOUSE_ID } from "../hasi-config";

let init: Promise<void> | null = null;

const tables = [
`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', sourceUrl TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'published')`,
`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, shortDescription TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]', specifications TEXT NOT NULL DEFAULT '{}', price REAL NOT NULL DEFAULT 0, previousPrice REAL, image TEXT NOT NULL DEFAULT '', sourceUrl TEXT NOT NULL DEFAULT '', categoryId TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, isPublished INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, FOREIGN KEY(categoryId) REFERENCES categories(id))`,
`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, firstName TEXT NOT NULL, lastName TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL DEFAULT '', passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'USER', avatar TEXT, emailVerified INTEGER NOT NULL DEFAULT 0, isBlocked INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS passwordResets (id TEXT PRIMARY KEY, userId TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expiresAt TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS activityLogs (id TEXT PRIMARY KEY, actorId TEXT, action TEXT NOT NULL, message TEXT NOT NULL, createdAt TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS contactMessages (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'NEW', reply TEXT NOT NULL DEFAULT '', replyText TEXT NOT NULL DEFAULT '', isReplied INTEGER NOT NULL DEFAULT 0, repliedAt TEXT, userId TEXT, visitorToken TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, orderNumber TEXT UNIQUE, userId TEXT, firstName TEXT NOT NULL, lastName TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new', createdAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id))`,
`CREATE TABLE IF NOT EXISTS orderItems (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, productId TEXT, sku TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', unitPrice REAL NOT NULL DEFAULT 0, quantity INTEGER NOT NULL, lineTotal REAL NOT NULL DEFAULT 0, FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS cartItems (userId TEXT NOT NULL, productId TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), updatedAt TEXT NOT NULL, PRIMARY KEY(userId, productId), FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(productId) REFERENCES products(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS pendingRegistrations (email TEXT PRIMARY KEY, firstName TEXT NOT NULL, lastName TEXT NOT NULL, phone TEXT NOT NULL, passwordHash TEXT NOT NULL, codeHash TEXT NOT NULL, expiresAt TEXT NOT NULL, nextResendAt TEXT NOT NULL, dailyCount INTEGER NOT NULL DEFAULT 1, dailyWindow TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS passwordResetCodes (email TEXT PRIMARY KEY, userId TEXT NOT NULL, codeHash TEXT NOT NULL, expiresAt TEXT NOT NULL, nextResendAt TEXT NOT NULL, dailyCount INTEGER NOT NULL DEFAULT 1, dailyWindow TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS phonePasswordResetCodes (phone TEXT PRIMARY KEY, userId TEXT NOT NULL, codeHash TEXT NOT NULL, expiresAt TEXT NOT NULL, nextResendAt TEXT NOT NULL, dailyCount INTEGER NOT NULL DEFAULT 1, dailyWindow TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS emailChangeCodes (userId TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, codeHash TEXT NOT NULL, expiresAt TEXT NOT NULL, nextResendAt TEXT NOT NULL, dailyCount INTEGER NOT NULL DEFAULT 1, dailyWindow TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS userFavorites (userId TEXT NOT NULL, productId TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY(userId, productId), FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(productId) REFERENCES products(id) ON DELETE CASCADE)`
];

/** Таблицы ТЗ 0.1. Деньги — в сомони (REAL, округление до 2 знаков в коде). */
const hasiTables = [
  `CREATE TABLE IF NOT EXISTS dealer_identity (userId TEXT PRIMARY KEY, fullName TEXT NOT NULL, passportNumber TEXT NOT NULL, birthDate TEXT NOT NULL DEFAULT '', issuedBy TEXT NOT NULL DEFAULT '', issueDate TEXT NOT NULL DEFAULT '', registrationAddress TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', enteredBy TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS distributors (id TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', createdAt TEXT NOT NULL, FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS warehouses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, distributorId TEXT, isCentral INTEGER NOT NULL DEFAULT 0, address TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, FOREIGN KEY(distributorId) REFERENCES distributors(id))`,
  `CREATE TABLE IF NOT EXISTS offers_stock (id TEXT PRIMARY KEY, warehouseId TEXT NOT NULL, productId TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0 CHECK(qty >= 0), purchasePrice REAL NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL, UNIQUE(warehouseId, productId), FOREIGN KEY(warehouseId) REFERENCES warehouses(id), FOREIGN KEY(productId) REFERENCES products(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS dealer_limits (dealerId TEXT PRIMARY KEY, limitAmount REAL NOT NULL DEFAULT 10000, updatedBy TEXT NOT NULL DEFAULT '', updatedAt TEXT NOT NULL, FOREIGN KEY(dealerId) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS customer_orders (id TEXT PRIMARY KEY, orderNumber TEXT UNIQUE NOT NULL, customerName TEXT NOT NULL, phone TEXT NOT NULL, addressComment TEXT NOT NULL, total REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending_dealer', dealerId TEXT, acceptedAt TEXT, issuedAt TEXT, createdAt TEXT NOT NULL, FOREIGN KEY(dealerId) REFERENCES users(id))`,
  `CREATE INDEX IF NOT EXISTS customer_orders_status_idx ON customer_orders(status, createdAt)`,
  `CREATE INDEX IF NOT EXISTS customer_orders_dealer_idx ON customer_orders(dealerId)`,
  `CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, productId TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', unitPrice REAL NOT NULL DEFAULT 0, quantity INTEGER NOT NULL CHECK(quantity > 0), lineTotal REAL NOT NULL DEFAULT 0, FOREIGN KEY(orderId) REFERENCES customer_orders(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(orderId)`,
  `CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY, warehouseId TEXT NOT NULL, productId TEXT NOT NULL, orderId TEXT, dealerId TEXT, type TEXT NOT NULL, qty INTEGER NOT NULL, unitPurchasePrice REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, FOREIGN KEY(warehouseId) REFERENCES warehouses(id))`,
  `CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, orderId TEXT UNIQUE NOT NULL, dealerId TEXT NOT NULL, warehouseId TEXT NOT NULL, retailTotal REAL NOT NULL, purchaseTotal REAL NOT NULL, status TEXT NOT NULL DEFAULT 'issued', customerPaymentMethod TEXT, paymentReference TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, settledAt TEXT, FOREIGN KEY(orderId) REFERENCES customer_orders(id), FOREIGN KEY(dealerId) REFERENCES users(id))`,
  `CREATE INDEX IF NOT EXISTS sales_dealer_status_idx ON sales(dealerId, status)`,
  `CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, saleId TEXT NOT NULL, dealerId TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reportedAt TEXT NOT NULL, confirmedBy TEXT, confirmedAt TEXT, note TEXT NOT NULL DEFAULT '', FOREIGN KEY(saleId) REFERENCES sales(id))`,
  `CREATE TABLE IF NOT EXISTS commissions (id TEXT PRIMARY KEY, saleId TEXT NOT NULL, dealerId TEXT NOT NULL, beneficiary TEXT NOT NULL, rate REAL NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL, availableAt TEXT, UNIQUE(saleId, beneficiary), FOREIGN KEY(saleId) REFERENCES sales(id))`,
  `CREATE INDEX IF NOT EXISTS commissions_dealer_idx ON commissions(dealerId, beneficiary, status)`,
];

async function ensureColumn(table: string, column: string, definition: string) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  if (!r.rows.some(x => String(x.name) === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export async function initializeSchema(): Promise<void> {
  if (init) return init;
  init = (async () => {
    for (const sql of tables) await db.execute(sql);
    // ТЗ 0.1: роли Admin / Distributor / Dealer, статус аккаунта, склад, заявки, расчёты
    await ensureColumn("users", "status", "TEXT NOT NULL DEFAULT 'active'");
    for (const sql of hasiTables) await db.execute(sql);
    await ensureColumn("categories", "parentId", "TEXT");
    await db.execute(`CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parentId)`);
    await ensureColumn("products", "type", "TEXT NOT NULL DEFAULT 'product'");
    await ensureColumn("order_items", "itemType", "TEXT NOT NULL DEFAULT 'product'");
    await ensureColumn("dealer_identity", "passportScanUrl", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("dealer_identity", "passportScanMime", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("dealer_identity", "passportScanData", "BLOB");
    await db.execute(`INSERT OR IGNORE INTO warehouses(id,name,code,distributorId,isCentral,address,createdAt) VALUES('${CENTRAL_WAREHOUSE_ID}','Центральный склад HASI','HASI',NULL,1,'',datetime('now'))`);
    await ensureColumn("contactMessages", "email", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("contactMessages", "status", "TEXT NOT NULL DEFAULT 'NEW'");
    await ensureColumn("contactMessages", "replyText", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("contactMessages", "isReplied", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("contactMessages", "userId", "TEXT");
    await ensureColumn("contactMessages", "visitorToken", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("orders", "orderNumber", "TEXT");
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_idx ON orders(orderNumber)`);
    await db.execute(`UPDATE contactMessages SET replyText = reply WHERE replyText = '' AND reply <> ''`);
    await db.execute(`UPDATE contactMessages SET isReplied = 1 WHERE isReplied = 0 AND replyText <> ''`);
  })();
  try { await init; } catch (e) { init = null; throw e; }
}
