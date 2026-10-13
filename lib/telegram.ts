import { formatTjs } from "@/lib/currency";
import { getIntegrationValue } from "@/lib/integrations";

/**
 * Чат магазина (@HASI_TJ_Bot → владелец). Используется, если TELEGRAM_CHAT_ID
 * не задан ни в админ-панели, ни в .env.local. Токен бота по умолчанию
 * не хранится — задайте TELEGRAM_BOT_TOKEN в админ-панели или .env.local.
 */
export const DEFAULT_TELEGRAM_CHAT_ID = "8985130828";

type NewOrderNotice = {
  orderNumber: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  comment?: string;
  total: number;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
};

/** Escapes the characters that Telegram legacy Markdown treats as entities. */
function escapeMarkdown(value: string) {
  return value.replace(/([_*`\[])/g, "\\$1");
}

/**
 * Builds the order notification text. Kept separate from the delivery so the
 * message layout can be verified without touching Telegram.
 *
 * `markdown: true` escapes dynamic values, so product names containing `_`,
 * `*`, `` ` `` or `[` cannot break Telegram's Markdown parser.
 */
export function formatNewOrderNotice(order: NewOrderNotice, options: { markdown?: boolean } = {}) {
  const esc = options.markdown ? escapeMarkdown : (value: string) => value;
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const lines = order.items.map((item, index) =>
    `${index + 1}. ${esc(item.name)} — ${item.quantity} × ${formatTjs(item.unitPrice)} = ${formatTjs(item.unitPrice * item.quantity)}`);
  return [
    "🛍️ *Новый заказ!*",
    "",
    `🔖 Номер заказа: ${esc(order.orderNumber)}`,
    `👤 Покупатель: ${esc(`${order.firstName} ${order.lastName}`.trim())}`,
    `📞 Телефон: ${esc(order.phone)}`,
    `📧 Email: ${esc(order.email || "—")}`,
    `🏙️ Адрес: ${esc([order.city, order.address].filter(Boolean).join(", "))}`,
    ...(order.comment ? [`💬 Комментарий: ${esc(order.comment)}`] : []),
    "",
    "📦 Товары:",
    ...lines,
    "",
    `Всего позиций: ${quantity} шт.`,
    `💰 *Итого: ${formatTjs(order.total)}*`,
  ].join("\n");
}

export async function sendNewOrderNotice(order: NewOrderNotice) {
  // Приоритет как у остальных интеграций проекта: значение из админ-панели,
  // затем переменная окружения (см. lib/integrations.ts).
  const token = getIntegrationValue("TELEGRAM_BOT_TOKEN");
  const chatId = getIntegrationValue("TELEGRAM_CHAT_ID") || getIntegrationValue("TELEGRAM_ADMIN_CHAT_ID") || DEFAULT_TELEGRAM_CHAT_ID;
  if (!token) {
    console.error("Telegram order notification skipped: TELEGRAM_BOT_TOKEN is not set (admin panel → Настройки → Telegram, or .env.local).");
    return;
  }

  try {
    const markdownText = formatNewOrderNotice(order, { markdown: true });
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: markdownText, parse_mode: "Markdown", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || result.ok !== true) {
      // Описывает и «бот заблокирован», и «чат не найден», и ошибки парсинга.
      const reason = result.description || "Telegram API returned ok=false (бот заблокирован или чат не найден).";
      console.error("Telegram rejected the new order notification. HTTP:", response.status, "| reason:", reason);
      // Нераспарсенные сущности в названиях не должны лишать магазин
      // уведомления: повторяем отправку обычным текстом.
      if (/parse|entit/i.test(reason)) {
        await sendPlainTextNotice(token, chatId, order);
      }
      return;
    }
    console.log(`Telegram notified about order ${order.orderNumber}.`);
  } catch (error) {
    // The order itself is already stored; a delivery problem must never fail checkout.
    console.error("Failed to send the Telegram order notification:", error instanceof Error ? error.message : error);
  }
}

/** Plain-text retry used when Telegram cannot parse the Markdown message. */
async function sendPlainTextNotice(token: string, chatId: string, order: NewOrderNotice) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: formatNewOrderNotice(order), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || result.ok !== true) {
      console.error("Telegram plain-text retry also failed. HTTP:", response.status, "| reason:", result.description || "ok=false");
      return;
    }
    console.log(`Telegram notified about order ${order.orderNumber} (plain-text retry).`);
  } catch (error) {
    console.error("Telegram plain-text retry failed:", error instanceof Error ? error.message : error);
  }
}

type ContactNotice = { name: string; email: string; phone: string; message: string };

/** Текст уведомления о сообщении из формы «Контакты». */
export function formatContactNotice(contact: ContactNotice, options: { markdown?: boolean } = {}) {
  const esc = options.markdown ? escapeMarkdown : (value: string) => value;
  return [
    "✉️ *Новое сообщение с сайта*",
    "",
    `👤 Имя: ${esc(contact.name)}`,
    `📧 Email: ${esc(contact.email || "—")}`,
    `📞 Телефон: ${esc(contact.phone)}`,
    "",
    "💬 Сообщение:",
    esc(contact.message),
  ].join("\n");
}

/**
 * Уведомляет владельца магазина в Telegram о новом обращении. Никогда не бросает
 * исключений: сообщение уже сохранено в БД, а сбой Telegram не должен ломать форму.
 * Возвращает true, если Telegram принял сообщение.
 */
export async function sendContactNotice(contact: ContactNotice): Promise<boolean> {
  try {
    const token = getIntegrationValue("TELEGRAM_BOT_TOKEN");
    const chatId = getIntegrationValue("TELEGRAM_CHAT_ID") || getIntegrationValue("TELEGRAM_ADMIN_CHAT_ID") || DEFAULT_TELEGRAM_CHAT_ID;
    if (!token) {
      console.error("Telegram contact notification skipped: TELEGRAM_BOT_TOKEN is not set.");
      return false;
    }
    const attempts = [
      { text: formatContactNotice(contact, { markdown: true }), parse_mode: "Markdown" as const },
      { text: formatContactNotice(contact) }, // повтор обычным текстом, если Markdown не разобрался
    ];
    for (const attempt of attempts) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, disable_web_page_preview: true, ...attempt }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json() as { ok?: boolean; description?: string };
      if (response.ok && result.ok === true) return true;
      const reason = result.description || "ok=false";
      console.error("Telegram rejected the contact notification. HTTP:", response.status, "| reason:", reason);
      if (!/parse|entit/i.test(reason)) return false;
    }
    return false;
  } catch (error) {
    console.error("Failed to send the Telegram contact notification:", error instanceof Error ? error.message : error);
    return false;
  }
}
