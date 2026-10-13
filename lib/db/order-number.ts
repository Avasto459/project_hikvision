import type { Client, Transaction } from "@libsql/client";

/** Сегодняшняя дата YYYYMMDD по Душанбе (UTC+5): номер не «перескакивает» в 19:00 UTC. */
export function orderDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dushanbe", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date)
    .replace(/-/g, "");
}

/**
 * Следующий уникальный номер заявки: HASI-YYYYMMDD-NNN (HASI-20261012-001, …-002).
 * Вызывать ВНУТРИ той же транзакции, что и INSERT заявки: тогда при откате номер не теряется,
 * а UPSERT … RETURNING гарантирует, что два одновременных заказа не получат один номер.
 * UNIQUE(order_number) в customer_orders — вторая линия защиты.
 */
export async function nextOrderNumber(tx: Pick<Client | Transaction, "execute">, date = new Date()): Promise<string> {
  const day = orderDay(date);
  const r = await tx.execute({
    sql: `INSERT INTO order_counters(day,last) VALUES(?,1)
          ON CONFLICT(day) DO UPDATE SET last = last + 1
          RETURNING last`,
    args: [day],
  });
  const n = Number(r.rows[0]?.last);
  if (!Number.isInteger(n) || n < 1) throw new Error("Не удалось сгенерировать номер заявки.");
  return `HASI-${day}-${String(n).padStart(n > 999 ? 4 : 3, "0")}`;
}
