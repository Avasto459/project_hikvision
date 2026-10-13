"use client";

import { PasswordInput } from "@/components/auth-fields";
import { Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { formatTjs } from "@/lib/currency";
import { HasiAdminPanel } from "@/components/hasi-admin-panel";

type Category = { id: string; name: string; slug: string; subtitle: string; description: string; image: string; status: string; parentId: string | null };
type Product = { id: string; name: string; slug: string; sku: string; brand: string; price: number; previousPrice: number | null; shortDescription: string; description: string; image: string; sourceUrl: string; images: string[]; specifications: Record<string, string>; categoryId: string; stock: number; featured: number; isPublished: number; type: "product" | "service" };
type OrderLine = { id: string; name: string; sku: string; unitPrice: number; quantity: number; lineTotal: number };
type Order = { id: string; orderNumber: string | null; email: string; firstName: string; lastName: string; phone: string; address: string; city: string; comment: string; total: number; status: string; createdAt: string; items: OrderLine[] };
type ContactMessage = { id: string; name: string; email: string; phone: string; message: string; status: "NEW" | "READ" | "ANSWERED"; reply: string; replyText: string; isReplied: boolean; repliedAt: string | null; createdAt: string };
type LogEntry = { id: string; action: string; message: string; createdAt: string };
type Overview = { users: number; categories: number; products: number; orders: number; recent: LogEntry[] };
type AdminUser = { id: string; firstName: string; lastName: string; email: string; phone: string; role: "USER" | "ADMIN"; emailVerified: number; isBlocked: number; createdAt: string };
type IntegrationField = { key: string; secret: boolean; isSet: boolean; value: string };
type Integration = { configured: boolean; missing: string[]; problem?: string | null; fields: IntegrationField[] };
type Integrations = Record<string, Integration>;
type Tab = "overview" | "orders" | "dealers" | "catalog" | "users" | "messages" | "settings" | "profile";
type Toast = { type: "ok" | "error"; text: string } | null;

const inputClass = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white";
const primaryButton = "rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-violet-600 disabled:opacity-60";
const ghostButton = "rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800";
const dangerButton = "rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:hover:bg-rose-950/40";
const card = "rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900";
const emptyCategory = { name: "", slug: "", subtitle: "", description: "", image: "", parentId: "" };
const emptyProduct = { name: "", slug: "", sku: "", brand: "", shortDescription: "", description: "", price: "", previousPrice: "", image: "", sourceUrl: "", images: "", specifications: "", categoryId: "", stock: "", type: "product" };
const orderStatuses = ["new", "processing", "completed", "cancelled"];
const orderStatusLabels: Record<string, string> = { new: "Новый", processing: "В обработке", completed: "Выполнен", cancelled: "Отменён" };
const messageStatusLabels: Record<string, string> = { NEW: "Новое", READ: "Прочитано", ANSWERED: "Отвечено" };
const messageStatusStyles: Record<string, string> = { NEW: "bg-sky-100 text-sky-700", READ: "bg-slate-200 text-slate-600", ANSWERED: "bg-emerald-100 text-emerald-700" };
const integrationTitles: Record<string, string> = { auth: "Авторизация (JWT)", email: "Email / SMTP", sms: "SMS / Twilio", telegram: "Telegram-уведомления о заказах" };
const fieldLabels: Record<string, string> = {
  SMTP_HOST: "SMTP-сервер", SMTP_PORT: "Порт", SMTP_SECURE: "SSL/TLS (true / false)", SMTP_USER: "Логин", SMTP_PASSWORD: "Пароль", SMTP_FROM: "Адрес отправителя",
  SMS_PROVIDER: "Провайдер (twilio)", SMS_API_KEY: "Account SID", SMS_API_SECRET: "Auth Token", SMS_SENDER: "Номер отправителя",
  TELEGRAM_BOT_TOKEN: "Токен бота", TELEGRAM_CHAT_ID: "ID чата",
};
const tabs: Array<[Tab, string]> = [["overview", "Обзор"], ["orders", "Заказы"], ["dealers", "Дилеры и склад"], ["catalog", "Каталог"], ["users", "Пользователи"], ["messages", "Сообщения"], ["settings", "Настройки"], ["profile", "Мой профиль"]];

function parseSpecifications(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const entries = lines.map((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("Характеристики вводятся построчно в формате «Название: значение».");
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
  });
  return Object.fromEntries(entries);
}

function bearerHeaders(json = false) {
  const authToken = localStorage.getItem("hasi-token");
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Операция не выполнена.");
  return data;
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adminPassword, setAdminPassword] = useState("");
  const [integrations, setIntegrations] = useState<Integrations>({});
  const [integrationDrafts, setIntegrationDrafts] = useState<Record<string, Record<string, string>>>({});
  const [siteSettings, setSiteSettings] = useState({ site_name: "", phone: "", address: "", about: "" });
  const [profile, setProfile] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", password: "", confirmPassword: "" });
  const [categoryForm, setCategoryForm] = useState(emptyCategory);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((type: "ok" | "error", text: string) => {
    setToast({ type, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), type === "error" ? 8000 : 4500);
  }, []);

  /** Runs an action with a busy marker and reports success or failure in the toast. */
  async function run(key: string, success: string, action: () => Promise<unknown>, reload = true) {
    setBusy(key);
    try {
      await action();
      notify("ok", success);
      if (reload) await load(false);
    } catch (reason) {
      notify("error", errorText(reason, "Операция не выполнена."));
    } finally {
      setBusy("");
    }
  }

  const loadIntegrationDrafts = useCallback((data: Integrations) => {
    setIntegrationDrafts(Object.fromEntries(Object.entries(data).map(([group, integration]) => [
      group,
      Object.fromEntries((integration.fields || []).filter((field) => !field.secret).map((field) => [field.key, field.value])),
    ])));
  }, []);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const urls = ["/api/admin/overview", "/api/admin/categories", "/api/admin/products", "/api/admin/orders", "/api/admin/contact", "/api/admin/integrations", "/api/admin/users", "/api/admin/settings", "/api/profile"];
      const responses = await Promise.all(urls.map((url) => fetch(url, { headers: bearerHeaders() })));
      const results = await Promise.all(responses.map((response) => response.json().catch(() => ({}))));
      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) throw new Error(results[i].error || "Не удалось загрузить панель.");
      }
      const [summary, categoryData, productData, orderData, contactData, integrationData, userData, settingsData, profileData] = results;
      setOverview(summary);
      setCategories(categoryData.categories);
      setProducts(productData.products);
      setOrders(orderData.orders);
      setMessages(contactData.messages);
      setIntegrations(integrationData.integrations);
      setUsers(userData.users);
      setSiteSettings((current) => ({ ...current, ...settingsData.settings }));
      setProfile({ firstName: profileData.user.firstName, lastName: profileData.user.lastName, phone: profileData.user.phone, email: profileData.user.email });
      setProductForm((current) => current.categoryId ? current : { ...current, categoryId: categoryData.categories[0]?.id || "" });
      if (showSpinner) loadIntegrationDrafts(integrationData.integrations);
    } catch (reason) {
      notify("error", errorText(reason, "Не удалось загрузить данные панели."));
    } finally {
      setLoading(false);
    }
  }, [loadIntegrationDrafts, notify]);

  useEffect(() => {
    void Promise.resolve().then(() => load(true));
  }, [load]);

  // ---------- catalog ----------
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("category-create", "Категория создана.", async () => {
      await responseData(await fetch("/api/admin/categories", { method: "POST", headers: bearerHeaders(true), body: JSON.stringify(categoryForm) }));
      setCategoryForm(emptyCategory);
    });
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("product-create", "Товар создан и добавлен в каталог.", async () => {
      await responseData(await fetch("/api/admin/products", {
        method: "POST",
        headers: bearerHeaders(true),
        body: JSON.stringify({
          ...productForm,
          images: [...new Set([productForm.image, ...productForm.images.split(/\r?\n/)].map((image) => image.trim()).filter(Boolean))],
          specifications: parseSpecifications(productForm.specifications),
          price: Number(productForm.price),
          previousPrice: productForm.previousPrice ? Number(productForm.previousPrice) : null,
          stock: productForm.type === "service" ? 0 : Number(productForm.stock),
        }),
      }));
      setProductForm({ ...emptyProduct, categoryId: categories[0]?.id || "" });
    });
  }

  async function editCategory(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run(`category-${id}`, "Категория сохранена.", async () => {
      await responseData(await fetch(`/api/admin/categories/${id}`, { method: "PATCH", headers: bearerHeaders(true), body: JSON.stringify(values) }));
    });
  }

  async function editProduct(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run(`product-${id}`, "Товар сохранён.", async () => {
      const images = [...new Set([String(values.image || ""), ...String(values.images || "").split(/\r?\n/)].map((image) => image.trim()).filter(Boolean))];
      const data = {
        ...values,
        image: images[0] || "",
        images,
        specifications: parseSpecifications(String(values.specifications || "")),
        price: Number(values.price),
        stock: values.type === "service" ? 0 : Number(values.stock),
        previousPrice: values.previousPrice ? Number(values.previousPrice) : null,
        isPublished: Number(values.isPublished),
        featured: Number(values.featured),
      };
      await responseData(await fetch(`/api/admin/products/${id}`, { method: "PATCH", headers: bearerHeaders(true), body: JSON.stringify(data) }));
    });
  }

  async function uploadImages(input: HTMLInputElement) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const form = input.closest("form");
    const imagesField = form?.elements.namedItem("images") as HTMLTextAreaElement | null;
    try {
      const payload = new FormData();
      files.forEach((file) => payload.append("images", file));
      const result = await responseData<{ images: string[] }>(await fetch("/api/admin/uploads", { method: "POST", headers: bearerHeaders(), body: payload }));
      if (imagesField && form && form.dataset.kind !== "create") {
        imagesField.value = [...new Set([...imagesField.value.split(/\r?\n/), ...result.images].map((image) => image.trim()).filter(Boolean))].join("\n");
      } else {
        setProductForm((current) => ({ ...current, images: [...new Set([...current.images.split(/\r?\n/), ...result.images].map((image) => image.trim()).filter(Boolean))].join("\n") }));
      }
      notify("ok", `${result.images.length} фото загружено. Нажмите «Сохранить», чтобы применить.`);
    } catch (reason) {
      notify("error", errorText(reason, "Не удалось загрузить фотографии."));
    } finally {
      input.value = "";
    }
  }

  async function remove(url: string, confirmText: string, success = "Запись удалена.") {
    if (!window.confirm(confirmText)) return;
    await run(url, success, async () => {
      await responseData(await fetch(url, { method: "DELETE", headers: bearerHeaders() }));
    });
  }

  // ---------- orders ----------
  async function updateOrder(orderId: string, nextStatus: string) {
    await run(`order-${orderId}`, "Статус заказа обновлён.", async () => {
      await responseData(await fetch("/api/admin/orders", { method: "PATCH", headers: bearerHeaders(true), body: JSON.stringify({ orderId, status: nextStatus }) }));
    });
  }

  async function deleteOrder(order: Order) {
    const label = order.orderNumber || order.id.slice(0, 8);
    if (!window.confirm(`Удалить заказ ${label} безвозвратно? Заказ и его позиции будут удалены из базы.`)) return;
    // reload=false: список обновляем локально, без повторной загрузки всей админки.
    await run(`order-${order.id}`, `Заказ ${label} удалён.`, async () => {
      await responseData(await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}`, { method: "DELETE", headers: bearerHeaders() }));
      setOrders((current) => current.filter((item) => item.id !== order.id));
      setOverview((current) => (current ? { ...current, orders: Math.max(0, current.orders - 1) } : current));
    }, false);
  }

  // ---------- users ----------
  async function editUser(event: FormEvent<HTMLFormElement>, user: AdminUser) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await run(`user-${user.id}`, "Данные пользователя сохранены.", async () => {
      const phone = String(values.phone || "").trim();
      await responseData(await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: bearerHeaders(true),
        body: JSON.stringify({
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          ...(phone && phone !== user.phone ? { phone } : {}),
          role: values.role,
          isBlocked: values.isBlocked === "1" ? 1 : 0,
        }),
      }));
    });
  }

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    await run("create-admin", "Администратор создан.", async () => {
      await responseData(await fetch("/api/admin/users/create", {
        method: "POST",
        headers: bearerHeaders(true),
        body: JSON.stringify({ name: values.name, email: values.email, password: adminPassword }),
      }));
      form.reset();
      setAdminPassword("");
    });
  }

  async function toggleBlock(user: AdminUser) {
    const block = !user.isBlocked;
    if (block && !window.confirm(`Заблокировать пользователя ${user.email}? Он не сможет войти в аккаунт.`)) return;
    await run(`block-${user.id}`, block ? "Пользователь заблокирован." : "Пользователь разблокирован.", async () => {
      await responseData(await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: bearerHeaders(true), body: JSON.stringify({ isBlocked: block ? 1 : 0 }) }));
    });
  }

  // ---------- messages ----------
  async function setMessageStatus(id: string, status: string) {
    await run(`message-${id}`, "Статус сообщения обновлён.", async () => {
      await responseData(await fetch(`/api/admin/contact/${id}`, { method: "PATCH", headers: bearerHeaders(true), body: JSON.stringify({ status }) }));
    });
  }

  async function sendReply(message: ContactMessage) {
    setBusy(`reply-${message.id}`);
    try {
      const result = await responseData<{ success: boolean; message: string; reply?: ContactMessage; emailed: boolean; note: string }>(await fetch("/api/admin/messages/reply", {
        method: "POST", headers: bearerHeaders(true), body: JSON.stringify({ messageId: message.id, replyText }),
      }));
      // Мгновенно вставляем обновлённую запись в локальный список — ответ
      // отображается без перезагрузки страницы; load(false) досинхронизирует остальное.
      if (result.reply) {
        const updated = result.reply;
        setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      }
      // Очищаем textarea и закрываем форму ответа.
      setReplyOpen(null);
      setReplyText("");
      const suffix = result.emailed && message.email ? ` Копия отправлена на ${message.email}.` : result.note ? ` ${result.note}` : "";
      notify("ok", `${result.message || "Ответ успешно отправлен"}${suffix}`);
      await load(false);
    } catch (reason) {
      notify("error", errorText(reason, "Не удалось отправить ответ."));
    } finally {
      setBusy("");
    }
  }

  // ---------- settings / integrations / profile ----------
  async function saveSiteSettings(event: FormEvent) {
    event.preventDefault();
    await run("site-settings", "Настройки сайта сохранены.", async () => {
      const result = await responseData<{ settings: typeof siteSettings }>(await fetch("/api/admin/settings", { method: "PUT", headers: bearerHeaders(true), body: JSON.stringify(siteSettings) }));
      setSiteSettings(result.settings);
    }, false);
  }

  async function saveIntegration(group: string) {
    await run(`integration-${group}`, `Настройки «${integrationTitles[group] || group}» сохранены.`, async () => {
      const result = await responseData<{ integrations: Integrations }>(await fetch("/api/admin/integrations", {
        method: "PUT", headers: bearerHeaders(true), body: JSON.stringify({ group, values: integrationDrafts[group] || {} }),
      }));
      setIntegrations(result.integrations);
      loadIntegrationDrafts(result.integrations);
    }, false);
  }

  async function resetIntegration(group: string) {
    if (!window.confirm("Сбросить значения, сохранённые в панели? Будут использованы переменные из .env.")) return;
    await run(`integration-reset-${group}`, "Сохранённые значения сброшены.", async () => {
      const result = await responseData<{ integrations: Integrations }>(await fetch(`/api/admin/integrations?group=${group}`, { method: "DELETE", headers: bearerHeaders() }));
      setIntegrations(result.integrations);
      loadIntegrationDrafts(result.integrations);
    }, false);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    await run("profile", "Профиль сохранён.", async () => {
      await responseData(await fetch("/api/profile", {
        method: "PUT", headers: bearerHeaders(true),
        body: JSON.stringify({ firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone }),
      }));
    });
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    await run("password", "Пароль обновлён.", async () => {
      await responseData(await fetch("/api/profile/password", { method: "PUT", headers: bearerHeaders(true), body: JSON.stringify(passwordForm) }));
      setPasswordForm({ currentPassword: "", password: "", confirmPassword: "" });
    }, false);
  }

  // ---------- logs ----------
  async function clearLogs() {
    if (!window.confirm("Очистить всю историю действий? Это действие нельзя отменить.")) return;
    await run("logs-clear", "История действий очищена.", async () => {
      await responseData(await fetch("/api/admin/logs", { method: "DELETE", headers: bearerHeaders() }));
    });
  }

  // ---------- категории: два уровня ----------
  const mainCategories = categories.filter((category) => !category.parentId);
  const categoryOptions = (
    <>
      {mainCategories.map((main) => {
        const subs = categories.filter((category) => category.parentId === main.id);
        return subs.length ? (
          <optgroup key={main.id} label={main.name}>
            <option value={main.id}>{main.name} (без подкатегории)</option>
            {subs.map((sub) => <option key={sub.id} value={sub.id}>{main.name} → {sub.name}</option>)}
          </optgroup>
        ) : <option key={main.id} value={main.id}>{main.name}</option>;
      })}
    </>
  );

  function renderCategory(category: Category, isSub: boolean) {
    const subCount = categories.filter((item) => item.parentId === category.id).length;
    return (
      <details className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
        <summary className="cursor-pointer font-semibold">
          {isSub ? "↳ " : ""}{category.name} <span className="text-xs text-slate-500">/{category.slug}{!isSub && subCount ? ` · подкатегорий: ${subCount}` : ""}{category.status === "draft" ? " · черновик" : ""}</span>
        </summary>
        <div className="mt-4 flex flex-wrap gap-2">
          <form onSubmit={(event) => void editCategory(event, category.id)} className="grid flex-1 gap-2 sm:grid-cols-2">
            {(["name", "slug", "subtitle", "description", "image"] as const).map((field) => <input key={field} name={field} defaultValue={category[field]} required={field === "name" || field === "slug"} placeholder={field} className={inputClass} />)}
            <select name="status" defaultValue={category.status} className={inputClass}><option value="published">Опубликована</option><option value="draft">Черновик</option></select>
            <select name="parentId" defaultValue={category.parentId || ""} disabled={!isSub && subCount > 0} title={!isSub && subCount > 0 ? "У категории есть подкатегории — её нельзя вложить в другую" : undefined} className={inputClass}>
              <option value="">Главная категория</option>
              {mainCategories.filter((main) => main.id !== category.id).map((main) => <option key={main.id} value={main.id}>Подкатегория в «{main.name}»</option>)}
            </select>
            <button disabled={busy === `category-${category.id}`} className={primaryButton}>{busy === `category-${category.id}` ? "Сохранение…" : "Сохранить"}</button>
          </form>
          <button type="button" onClick={() => void remove(`/api/admin/categories/${category.id}`, isSub ? "Удалить подкатегорию?" : "Удалить категорию?", "Категория удалена.")} className={`${dangerButton} h-fit`}>Удалить</button>
        </div>
      </details>
    );
  }

  if (!overview && loading) return <p className="rounded-2xl bg-white p-6 dark:bg-slate-900">Загружаем данные из базы…</p>;

  const newMessages = messages.filter((message) => message.status === "NEW").length;
  const newOrders = orders.filter((order) => order.status === "new").length;

  return (
    <div className="space-y-6">
      {toast ? (
        <div role={toast.type === "error" ? "alert" : "status"} className={`fixed bottom-20 left-1/2 z-[60] w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl px-5 py-4 text-sm font-semibold shadow-2xl sm:bottom-6 ${toast.type === "error" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}>
          <div className="flex items-start justify-between gap-4">
            <span>{toast.text}</span>
            <button type="button" aria-label="Закрыть" onClick={() => setToast(null)} className="text-lg leading-none opacity-80 hover:opacity-100">×</button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Разделы админ-панели" className="flex flex-wrap gap-2">
          {tabs.map(([id, label]) => {
            const badge = id === "messages" ? newMessages : id === "orders" ? newOrders : 0;
            return (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === id ? "bg-violet-700 text-white" : "bg-white text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                {label}{badge > 0 ? <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] text-white">{badge}</span> : null}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading} className={ghostButton}>{loading ? "Обновление…" : "Обновить данные"}</button>
      </div>

      {overview ? (
        <>
          {tab === "overview" ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[["Пользователи", overview.users], ["Категории", overview.categories], ["Товары", overview.products], ["Заказы", overview.orders]].map(([label, value]) => (
                  <div key={label} className={card}><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-black">{value}</div></div>
                ))}
              </div>
              <section className={card}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">Последние действия</h2>
                  <button type="button" disabled={busy === "logs-clear" || !overview.recent.length} onClick={() => void clearLogs()} className={dangerButton}>{busy === "logs-clear" ? "Очистка…" : "Очистить историю"}</button>
                </div>
                {!overview.recent.length ? <p className="mt-4 text-sm text-slate-500">История действий пуста.</p> : (
                  <div className="mt-4 max-h-[420px] space-y-1 overflow-y-auto">
                    {overview.recent.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 text-sm dark:border-slate-800">
                        <div><strong>{item.action}</strong> · {item.message} <span className="block text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("ru-RU")}</span></div>
                        <button type="button" aria-label="Удалить запись" disabled={busy === `/api/admin/logs/${item.id}`} onClick={() => void remove(`/api/admin/logs/${item.id}`, "Удалить эту запись из истории?", "Запись удалена из истории.")} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Удалить</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {tab === "orders" ? (
            <section className={card}>
              <h2 className="text-xl font-bold">Заказы</h2>
              {!orders.length ? <p className="mt-4 text-sm text-slate-500">Заказов пока нет.</p> : (
                <div className="mt-4 space-y-4">
                  {orders.map((order) => (
                    <article key={order.id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <div className="flex flex-wrap justify-between gap-3">
                        <div><div className="font-bold">Заказ {order.orderNumber || order.id.slice(0, 8)} · {order.firstName} {order.lastName}</div><div className="mt-1 text-sm text-slate-500">{order.phone} · {order.email} · {order.city}, {order.address}</div></div>
                        <div className="font-bold">{formatTjs(order.total)}</div>
                      </div>
                      <div className="mt-3 text-sm">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(" · ")}</div>
                      {order.comment ? <p className="mt-2 text-sm text-slate-500">Комментарий: {order.comment}</p> : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500">{new Date(order.createdAt).toLocaleString("ru-RU")}</span>
                        <select aria-label="Статус заказа" value={order.status} disabled={busy === `order-${order.id}`} onChange={(event) => void updateOrder(order.id, event.target.value)} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                          {orderStatuses.map((value) => <option key={value} value={value}>{orderStatusLabels[value]}</option>)}
                        </select>
                        <button type="button" onClick={() => void deleteOrder(order)} disabled={busy === `order-${order.id}`} aria-label={`Удалить заказ ${order.orderNumber || order.id.slice(0, 8)}`} title="Удалить заказ" className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:bg-slate-900 dark:hover:bg-rose-950/40">
                          <Trash2 className="h-4 w-4" aria-hidden="true" /> Удалить
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === "dealers" ? <HasiAdminPanel /> : null}

          {tab === "catalog" ? (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <form onSubmit={createCategory} className={`space-y-4 ${card}`}>
                  <h2 className="text-xl font-bold">Добавить категорию</h2>
                  <input required maxLength={120} placeholder="Название" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} className={inputClass} />
                  <input required pattern="[a-z0-9-]+" placeholder="slug (латиница)" value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })} className={inputClass} />
                  <label className="block text-xs text-slate-500">Родительская категория
                    <select value={categoryForm.parentId} onChange={(e) => setCategoryForm({ ...categoryForm, parentId: e.target.value })} className={`${inputClass} mt-1`}>
                      <option value="">— Главная категория (верхний уровень) —</option>
                      {mainCategories.map((category) => <option key={category.id} value={category.id}>Подкатегория в «{category.name}»</option>)}
                    </select>
                  </label>
                  <input placeholder="Подзаголовок" value={categoryForm.subtitle} onChange={(e) => setCategoryForm({ ...categoryForm, subtitle: e.target.value })} className={inputClass} />
                  <textarea placeholder="Описание" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} className={inputClass} rows={3} />
                  <input placeholder="URL изображения (необязательно)" value={categoryForm.image} onChange={(e) => setCategoryForm({ ...categoryForm, image: e.target.value })} className={inputClass} />
                  <button disabled={busy === "category-create"} className={primaryButton}>{busy === "category-create" ? "Создание…" : "Создать категорию"}</button>
                </form>

                <form data-kind="create" onSubmit={createProduct} className={`space-y-4 ${card}`}>
                  <h2 className="text-xl font-bold">Добавить товар или услугу</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input required placeholder="Название" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className={inputClass} />
                    <input required pattern="[a-z0-9-]+" placeholder="slug" value={productForm.slug} onChange={(e) => setProductForm({ ...productForm, slug: e.target.value })} className={inputClass} />
                    <input placeholder="Артикул" value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} className={inputClass} />
                    <input placeholder="Бренд" value={productForm.brand} onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })} className={inputClass} />
                    <label className="text-xs text-slate-500">Цена (сомонӣ)<input required type="number" min="0" step="1" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className={`${inputClass} mt-1`} /></label>
                    <label className="text-xs text-slate-500">Цена до скидки (сомонӣ)<input type="number" min="0" step="1" value={productForm.previousPrice} onChange={(e) => setProductForm({ ...productForm, previousPrice: e.target.value })} className={`${inputClass} mt-1`} /></label>
                    <label className="text-xs text-slate-500">Тип позиции
                      <select value={productForm.type} onChange={(e) => setProductForm({ ...productForm, type: e.target.value })} className={`${inputClass} mt-1`}>
                        <option value="product">Товар / техника</option>
                        <option value="service">Услуга (монтаж, настройка, прокладка кабеля…)</option>
                      </select>
                    </label>
                    {productForm.type === "service" ? <p className="self-end rounded-xl bg-sky-50 p-3 text-xs text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">У услуги нет остатка на складе — она всегда доступна для заказа.</p> : <label className="text-xs text-slate-500">Остаток<input required type="number" min="0" step="1" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} className={`${inputClass} mt-1`} /></label>}
                    <select required value={productForm.categoryId} onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })} className={`${inputClass} sm:col-span-2`}>{categoryOptions}</select>
                  </div>
                  <input placeholder="URL или путь главного изображения" value={productForm.image} onChange={(e) => setProductForm({ ...productForm, image: e.target.value })} className={inputClass} />
                  <label className="text-xs text-slate-500">Загрузить фотографии (JPEG, PNG, WebP; до 6 файлов по 10 МБ)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void uploadImages(event.currentTarget)} className={`${inputClass} mt-1`} /></label>
                  <textarea name="images" placeholder="Пути или URL галереи, по одному на строку" value={productForm.images} onChange={(e) => setProductForm({ ...productForm, images: e.target.value })} className={inputClass} rows={3} />
                  <textarea placeholder="Характеристики, по одной на строку: Разрешение: 4 Мп" value={productForm.specifications} onChange={(e) => setProductForm({ ...productForm, specifications: e.target.value })} className={inputClass} rows={3} />
                  <input placeholder="Краткое описание" value={productForm.shortDescription} onChange={(e) => setProductForm({ ...productForm, shortDescription: e.target.value })} className={inputClass} />
                  <textarea placeholder="Полное описание" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} className={inputClass} rows={3} />
                  <button disabled={busy === "product-create"} className={primaryButton}>{busy === "product-create" ? "Создание…" : productForm.type === "service" ? "Создать услугу" : "Создать товар"}</button>
                </form>
              </div>

              <section className={card}>
                <h2 className="text-xl font-bold">Управление категориями</h2>
                <p className="mt-1 text-sm text-slate-500">Два уровня: главная категория → подкатегории. Создавайте главные категории и привязывайте к ним подкатегории в форме выше.</p>
                <div className="mt-4 space-y-3">
                  {mainCategories.map((main) => (
                    <div key={main.id} className="space-y-2">
                      {renderCategory(main, false)}
                      {categories.filter((c) => c.parentId === main.id).map((sub) => <div key={sub.id} className="ml-6 border-l-2 border-violet-200 pl-4 dark:border-violet-500/30">{renderCategory(sub, true)}</div>)}
                    </div>
                  ))}
                </div>
              </section>

              <section className={card}>
                <h2 className="text-xl font-bold">Товары и цены (сомонӣ)</h2>
                {!products.length ? <p className="mt-4 text-sm text-slate-500">В базе пока нет товаров. Добавьте ассортимент в форме выше.</p> : null}
                <div className="mt-4 space-y-3">
                  {products.map((product) => (
                    <details key={product.id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <summary className="cursor-pointer font-semibold">{product.type === "service" ? "🛠 " : ""}{product.name} · {formatTjs(product.price)} · {product.type === "service" ? "Услуга" : `Остаток: ${product.stock}`}{product.isPublished ? "" : " · скрыт"}</summary>
                      <form onSubmit={(event) => void editProduct(event, product.id)} className="mt-4 grid gap-2 sm:grid-cols-2">
                        {(["name", "slug", "sku", "brand", "shortDescription", "description", "image", "sourceUrl"] as const).map((field) => <input key={field} name={field} defaultValue={product[field]} required={field === "name" || field === "slug"} placeholder={field === "sourceUrl" ? "Источник HTTPS" : field} className={inputClass} />)}
                        <label className="text-xs text-slate-500 sm:col-span-2">Фотографии галереи, по одной на строку<textarea name="images" defaultValue={product.images.join("\n")} className={inputClass} rows={3} /></label>
                        <label className="text-xs text-slate-500 sm:col-span-2">Характеристики, формат «Название: значение»<textarea name="specifications" defaultValue={Object.entries(product.specifications || {}).map(([key, value]) => `${key}: ${value}`).join("\n")} className={inputClass} rows={3} /></label>
                        <label className="text-xs text-slate-500 sm:col-span-2">Загрузить фотографии<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void uploadImages(event.currentTarget)} className={`${inputClass} mt-1`} /></label>
                        <input name="price" type="number" min="0" step="1" defaultValue={product.price} required placeholder="Цена (сомонӣ)" className={inputClass} />
                        <input name="previousPrice" type="number" min="0" step="1" defaultValue={product.previousPrice ?? ""} placeholder="Старая цена" className={inputClass} />
                        <select name="type" defaultValue={product.type || "product"} className={inputClass}><option value="product">Товар / техника</option><option value="service">Услуга</option></select>
                        <input name="stock" type="number" min="0" step="1" defaultValue={product.type === "service" ? 0 : product.stock} placeholder="Остаток (для услуги не нужен)" className={inputClass} />
                        <select name="categoryId" defaultValue={product.categoryId} className={`${inputClass} sm:col-span-2`}>{categoryOptions}</select>
                        <select name="isPublished" defaultValue={product.isPublished} className={inputClass}><option value="1">Опубликован</option><option value="0">Скрыт</option></select>
                        <select name="featured" defaultValue={product.featured} className={inputClass}><option value="0">Обычный товар</option><option value="1">Популярный товар</option></select>
                        <button disabled={busy === `product-${product.id}`} className={primaryButton}>{busy === `product-${product.id}` ? "Сохранение…" : "Сохранить"}</button>
                        <button type="button" onClick={() => void remove(`/api/admin/products/${product.id}`, "Удалить товар?", "Товар удалён.")} className={dangerButton}>Удалить товар</button>
                      </form>
                    </details>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {tab === "users" ? (
            <section className={card}>
              <h2 className="text-xl font-bold">Пользователи</h2>
              <form onSubmit={(event) => void createAdmin(event)} autoComplete="off" className="mt-4 grid gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:grid-cols-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                <h3 className="text-base font-bold sm:col-span-3">Создать нового администратора</h3>
                <label className="text-xs text-slate-500">Имя<input name="name" required maxLength={100} className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-slate-500">Email<input name="email" type="email" required maxLength={254} autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <div className="text-xs text-slate-500">Пароль (от 10 символов)<div className="mt-1"><PasswordInput id="new-admin-password" value={adminPassword} onChange={setAdminPassword} minLength={10} placeholder="Минимум 10 символов" autoComplete="new-password" /></div></div>
                <button disabled={busy === "create-admin"} className={`${primaryButton} sm:col-span-3`}>{busy === "create-admin" ? "Создание…" : "Создать администратора"}</button>
              </form>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Имя</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Роль</th><th className="py-2 pr-3">Статус</th><th className="py-2 pr-3">Создан</th><th className="py-2">Действия</th></tr></thead>
                  <tbody>
                    {[...users].sort((a, b) => (a.role === b.role ? 0 : a.role === "ADMIN" ? -1 : 1)).map((user) => (
                      <tr key={user.id} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="py-2 pr-3">{user.firstName} {user.lastName}</td>
                        <td className="py-2 pr-3 break-all">{user.email}</td>
                        <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${user.role === "ADMIN" ? "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{user.role === "ADMIN" ? "Администратор" : "Пользователь"}</span></td>
                        <td className={`py-2 pr-3 ${user.isBlocked ? "text-rose-600" : "text-emerald-600"}`}>{user.isBlocked ? "Заблокирован" : "Активен"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{new Date(user.createdAt).toLocaleDateString("ru-RU")}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busy === `block-${user.id}`} onClick={() => void toggleBlock(user)} className={`${ghostButton} !px-3 !py-1.5 text-xs`}>{user.isBlocked ? "Разблокировать" : "Заблокировать"}</button>
                            <button type="button" disabled={busy === `/api/admin/users/${user.id}`} onClick={() => void remove(`/api/admin/users/${user.id}`, `Удалить ${user.role === "ADMIN" ? "администратора" : "пользователя"} ${user.email} из базы? Заказы останутся в истории.`, "Пользователь удалён.")} className={`${dangerButton} !px-3 !py-1.5 text-xs`}>Удалить</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="mt-6 text-base font-bold">Редактирование и блокировка</h3>
              {!users.length ? <p className="mt-4 text-sm text-slate-500">Зарегистрированных пользователей пока нет.</p> : (
                <div className="mt-4 space-y-4">
                  {users.map((user) => (
                    <details key={user.id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <summary className="cursor-pointer font-semibold">
                        {user.firstName} {user.lastName} · {user.email} · {user.role} · <span className={user.isBlocked ? "text-rose-600" : "text-emerald-600"}>{user.isBlocked ? "Заблокирован" : "Активен"}</span>
                      </summary>
                      <p className="mt-2 break-all text-xs text-slate-500">ID: {user.id} · {user.phone || "телефон не указан"} · Регистрация: {new Date(user.createdAt).toLocaleString("ru-RU")} · Email: {user.emailVerified ? "подтверждён" : "не подтверждён"}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" disabled={busy === `block-${user.id}`} onClick={() => void toggleBlock(user)} className={user.isBlocked ? primaryButton : ghostButton}>{busy === `block-${user.id}` ? "…" : user.isBlocked ? "Разблокировать" : "Заблокировать"}</button>
                        <button type="button" disabled={busy === `/api/admin/users/${user.id}`} onClick={() => void remove(`/api/admin/users/${user.id}`, `Удалить пользователя ${user.email} из базы? Заказы останутся в истории.`, "Пользователь удалён.")} className={dangerButton}>Удалить пользователя</button>
                      </div>
                      <form onSubmit={(event) => void editUser(event, user)} className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="text-xs text-slate-500">Имя<input name="firstName" required maxLength={100} defaultValue={user.firstName} className={`${inputClass} mt-1`} /></label>
                        <label className="text-xs text-slate-500">Фамилия<input name="lastName" required maxLength={100} defaultValue={user.lastName} className={`${inputClass} mt-1`} /></label>
                        <label className="text-xs text-slate-500">Email<input name="email" type="email" required maxLength={254} defaultValue={user.email} className={`${inputClass} mt-1`} /></label>
                        <label className="text-xs text-slate-500">Телефон (+992XXXXXXXXX)<input name="phone" defaultValue={user.phone} className={`${inputClass} mt-1`} /></label>
                        <label className="text-xs text-slate-500">Роль<select name="role" defaultValue={user.role} className={`${inputClass} mt-1`}><option value="USER">Пользователь</option><option value="ADMIN">Администратор</option></select></label>
                        <label className="text-xs text-slate-500">Статус<select name="isBlocked" defaultValue={user.isBlocked ? "1" : "0"} className={`${inputClass} mt-1`}><option value="0">Активен</option><option value="1">Заблокирован</option></select></label>
                        <button disabled={busy === `user-${user.id}`} className={`${primaryButton} sm:col-span-2`}>{busy === `user-${user.id}` ? "Сохранение…" : "Сохранить пользователя"}</button>
                      </form>
                    </details>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === "messages" ? (
            <section className={card}>
              <h2 className="text-xl font-bold">Сообщения покупателей</h2>
              {!messages.length ? <p className="mt-4 text-sm text-slate-500">Сообщений пока нет.</p> : (
                <div className="mt-4 space-y-3">
                  {messages.map((message) => (
                    <article key={message.id} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold">{message.name} · <a href={`tel:${message.phone}`} className="text-violet-700 dark:text-violet-300">{message.phone}</a>{message.email ? <> · <a href={`mailto:${message.email}`} className="text-violet-700 dark:text-violet-300">{message.email}</a></> : null}</div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${messageStatusStyles[message.status]}`}>{messageStatusLabels[message.status]}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{message.message}</p>
                      <p className="mt-2 text-xs text-slate-500">{new Date(message.createdAt).toLocaleString("ru-RU")}</p>
                      {message.replyText || message.reply ? (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                          <div className="text-xs font-bold uppercase">Ваш ответ{message.repliedAt ? ` · ${new Date(message.repliedAt).toLocaleString("ru-RU")}` : ""}</div>
                          <p className="mt-1 whitespace-pre-wrap">{message.replyText || message.reply}</p>
                        </div>
                      ) : null}
                      {replyOpen === message.id ? (
                        <div className="mt-3 space-y-2">
                          <textarea autoFocus rows={4} maxLength={5000} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder={message.email ? `Написать ответ — он появится на сайте, копия уйдёт на ${message.email}` : "Написать ответ — он появится на сайте у автора обращения"} className={inputClass} />
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busy === `reply-${message.id}` || !replyText.trim()} onClick={() => void sendReply(message)} className={primaryButton}>{busy === `reply-${message.id}` ? "Отправка…" : "Отправить на сайт"}</button>
                            <button type="button" onClick={() => { setReplyOpen(null); setReplyText(""); }} className={ghostButton}>Отмена</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => { setReplyOpen(message.id); setReplyText(message.replyText || message.reply || ""); if (message.status === "NEW") void setMessageStatus(message.id, "READ"); }} className={primaryButton}>{message.isReplied ? "Ответить ещё раз" : "Ответить"}</button>
                          {message.email ? <a href={`mailto:${message.email}?subject=${encodeURIComponent("Ответ на ваше сообщение — HASI.TJ")}`} className={`${ghostButton} inline-block`}>Ответить по Email</a> : null}
                          {message.status === "NEW" ? <button type="button" disabled={busy === `message-${message.id}`} onClick={() => void setMessageStatus(message.id, "READ")} className={ghostButton}>Отметить прочитанным</button> : null}
                          <button type="button" onClick={() => void remove(`/api/admin/contact/${message.id}`, "Удалить это сообщение?", "Сообщение удалено.")} className={dangerButton}>Удалить</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === "settings" ? (
            <div className="space-y-6">
              <form onSubmit={saveSiteSettings} className={`space-y-4 ${card}`}>
                <h2 className="text-xl font-bold">Настройки сайта</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">Название сайта<input required maxLength={120} value={siteSettings.site_name} onChange={(e) => setSiteSettings({ ...siteSettings, site_name: e.target.value })} className={`${inputClass} mt-1`} /></label>
                  <label className="text-xs text-slate-500">Телефон<input required maxLength={60} value={siteSettings.phone} onChange={(e) => setSiteSettings({ ...siteSettings, phone: e.target.value })} className={`${inputClass} mt-1`} /></label>
                  <label className="text-xs text-slate-500 sm:col-span-2">Адрес<input maxLength={300} value={siteSettings.address} onChange={(e) => setSiteSettings({ ...siteSettings, address: e.target.value })} className={`${inputClass} mt-1`} /></label>
                  <label className="text-xs text-slate-500 sm:col-span-2">О магазине<textarea rows={3} maxLength={1000} value={siteSettings.about} onChange={(e) => setSiteSettings({ ...siteSettings, about: e.target.value })} className={`${inputClass} mt-1`} /></label>
                </div>
                <button disabled={busy === "site-settings"} className={primaryButton}>{busy === "site-settings" ? "Сохранение…" : "Сохранить настройки"}</button>
              </form>

              <section className={card}>
                <h2 className="text-xl font-bold">Интеграции</h2>
                <p className="mt-2 text-sm text-slate-500">Значения сохраняются в базе (пароли и токены — в зашифрованном виде) и имеют приоритет над .env. Поле секрета можно оставить пустым — тогда сохранённое значение не изменится.</p>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {Object.entries(integrations).map(([group, integration]) => (
                    <div key={group} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold">{integrationTitles[group] || group}</div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${integration.configured ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{integration.configured ? "Настроено" : "Не настроено"}</span>
                      </div>
                      {!integration.configured && integration.missing.length ? <p className="mt-2 text-xs text-rose-600">Не заполнено: {integration.missing.join(", ")}</p> : null}
                      {group === "email" && !integration.configured ? <p className="mt-1 text-xs text-slate-500">Пока SMTP не настроен, коды подтверждения показываются на экране регистрации и в консоли сервера.</p> : null}
                      {integration.fields.length ? (
                        <form onSubmit={(event) => { event.preventDefault(); void saveIntegration(group); }} className="mt-4 space-y-3">
                          {integration.fields.map((field) => (
                            <label key={field.key} className="block text-xs text-slate-500">{fieldLabels[field.key] || field.key}
                              <input
                                type={field.secret ? "password" : "text"}
                                autoComplete="off"
                                value={integrationDrafts[group]?.[field.key] ?? ""}
                                placeholder={field.secret ? (field.isSet ? "•••••••• сохранено — оставьте пустым, чтобы не менять" : "не задано") : ""}
                                onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [group]: { ...current[group], [field.key]: event.target.value } }))}
                                className={`${inputClass} mt-1`}
                              />
                            </label>
                          ))}
                          <div className="flex flex-wrap gap-2">
                            <button disabled={busy === `integration-${group}`} className={primaryButton}>{busy === `integration-${group}` ? "Сохранение…" : "Сохранить"}</button>
                            <button type="button" disabled={busy === `integration-reset-${group}`} onClick={() => void resetIntegration(group)} className={ghostButton}>Сбросить</button>
                          </div>
                        </form>
                      ) : <p className="mt-3 text-xs text-slate-500">Задаётся только переменной JWT_SECRET (не короче 32 символов) в .env.local.</p>}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {tab === "profile" ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <form onSubmit={saveProfile} className={`space-y-4 ${card}`}>
                <h2 className="text-xl font-bold">Профиль администратора</h2>
                <p className="text-sm text-slate-500">Email: {profile.email}</p>
                <label className="block text-xs text-slate-500">Имя<input required maxLength={100} value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} className={`${inputClass} mt-1`} /></label>
                <label className="block text-xs text-slate-500">Фамилия<input required maxLength={100} value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} className={`${inputClass} mt-1`} /></label>
                <label className="block text-xs text-slate-500">Телефон (+992XXXXXXXXX)<input required value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} className={`${inputClass} mt-1`} /></label>
                <button disabled={busy === "profile"} className={primaryButton}>{busy === "profile" ? "Сохранение…" : "Сохранить профиль"}</button>
              </form>
              <form onSubmit={changePassword} className={`space-y-4 ${card}`}>
                <h2 className="text-xl font-bold">Смена пароля</h2>
                <PasswordInput id="profile-currentPassword" value={passwordForm.currentPassword} onChange={(value) => setPasswordForm({ ...passwordForm, currentPassword: value })} placeholder="Текущий пароль" autoComplete="current-password" minLength={1} />
                <PasswordInput id="profile-password" value={passwordForm.password} onChange={(value) => setPasswordForm({ ...passwordForm, password: value })} placeholder="Новый пароль (от 8 символов)" autoComplete="new-password" minLength={8} />
                <PasswordInput id="profile-confirmPassword" value={passwordForm.confirmPassword} onChange={(value) => setPasswordForm({ ...passwordForm, confirmPassword: value })} placeholder="Повторите новый пароль" autoComplete="new-password" minLength={8} />
                <button disabled={busy === "password"} className={primaryButton}>{busy === "password" ? "Сохранение…" : "Сохранить пароль"}</button>
                <p className="text-xs text-slate-500">Если HASI_ADMIN_PASSWORD задан в .env.local, при каждом запуске сервера пароль администратора будет сброшен на него.</p>
              </form>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
