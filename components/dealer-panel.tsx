"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DealerOrderModal } from "@/components/dealer-order-modal";
import { LogoutButton } from "@/components/logout-button";
import { formatTjs } from "@/lib/currency";
import { ACCOUNT_STATUS_LABELS, ORDER_STATUS_LABELS } from "@/lib/hasi-config";

type Finance = { limit: number; used: number; available: number; payoutBalance: number; pendingCommission: number; paidOut: number };
type Profile = { id: string; name: string; email: string; phone: string; status: string; createdAt: string; passportMasked: string } | null;
type Line = { name: string; sku: string; quantity: number; unitPrice: number; lineTotal: number };
type Sale = { status: string; retailTotal: number; purchaseTotal: number; dealerCommission: number; hasiCommission: number; customerPaymentMethod: string | null };
type Order = {
  id: string; orderNumber: string; customerName: string; phone: string; addressComment: string; total: number;
  status: string; createdAt: string; masked: boolean; items: Line[]; sale: Sale | null;
};
type Tab = "free" | "mine";

const POLL_MS = 15_000;
const STATUS_STYLE: Record<string, string> = {
  pending_dealer: "bg-sky-100 text-sky-700",
  accepted: "bg-violet-100 text-violet-700",
  issued: "bg-amber-100 text-amber-700",
  payment_reported: "bg-orange-100 text-orange-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-600",
};
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btn = "rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-60";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Не удалось выполнить действие.");
  return data;
}

export function DealerPanel({ profile, initialFinance, initialTab = "free", initialCreate = false }: { profile: Profile; initialFinance: Finance; initialTab?: Tab; initialCreate?: boolean }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [finance, setFinance] = useState(initialFinance);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [creating, setCreating] = useState(initialCreate && profile?.status === "active");
  const [payment, setPayment] = useState<{ orderId: string; method: "cash" | "transfer"; reference: string } | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const active = profile?.status === "active";

  const load = useCallback(async (which: Tab, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [o, s] = await Promise.all([
        api<{ orders: Order[] }>(`/api/dealer/orders?scope=${which}`),
        api<{ finance: Finance }>("/api/dealer/summary"),
      ]);
      if (tabRef.current === which) setOrders(o.orders);
      setFinance(s.finance);
    } catch (e) {
      if (!silent) setToast({ ok: false, text: e instanceof Error ? e.message : "Не удалось загрузить данные." });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
    const timer = setInterval(() => { if (!document.hidden) void load(tabRef.current, true); }, POLL_MS);
    return () => clearInterval(timer);
  }, [tab, load]);

  async function run(orderId: string, label: string, action: () => Promise<unknown>, after?: Tab) {
    setBusy(orderId);
    setToast(null);
    try {
      await action();
      setToast({ ok: true, text: label });
      if (after && after !== tab) setTab(after); else await load(tab, true);
    } catch (e) {
      setToast({ ok: false, text: e instanceof Error ? e.message : "Ошибка." });
      await load(tab, true); // например, заявку уже забрал другой дилер — обновляем список
    } finally {
      setBusy(null);
    }
  }

  const claim = (o: Order) => run(o.id, `Заявка ${o.orderNumber} закреплена за вами.`, () => api(`/api/dealer/orders/${o.id}/claim`, { method: "POST" }), "mine");
  const release = (o: Order) => run(o.id, "Заявка возвращена в свободные.", () => api(`/api/dealer/orders/${o.id}/release`, { method: "POST" }));
  const issue = (o: Order) => run(o.id, `Товар по заявке ${o.orderNumber} выдан со склада.`, () => api(`/api/dealer/orders/${o.id}/issue`, { method: "POST" }));
  const report = (o: Order) => {
    if (!payment) return;
    return run(o.id, "Оплата передана администратору на подтверждение.", async () => {
      await api(`/api/dealer/orders/${o.id}/payment`, { method: "POST", body: JSON.stringify({ method: payment.method, reference: payment.reference }) });
      setPayment(null);
    });
  };

  // команды из меню дилера в шапке сайта (SiteShell): переключить вкладку / открыть «Создать заказ»
  useEffect(() => {
    const onAction = (event: Event) => {
      const kind = (event as CustomEvent<string>).detail;
      if (kind === "free" || kind === "mine") setTab(kind);
      else if (kind === "new" && profile?.status === "active") setCreating(true);
      else if (kind === "dash") window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("hasi-dealer-action", onAction);
    return () => window.removeEventListener("hasi-dealer-action", onAction);
  }, [profile?.status]);

  const usedPct = finance.limit ? Math.min(100, Math.round((finance.used / finance.limit) * 100)) : 0;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">Дилер</span>
          <h1 className="mt-2 text-2xl font-black text-slate-900 dark:text-white sm:text-3xl">{profile?.name || "Кабинет дилера"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {profile?.email}
            {profile ? <> · <span className={active ? "text-emerald-600" : "text-amber-600"}>{ACCOUNT_STATUS_LABELS[profile.status] ?? profile.status}</span></> : null}
            {profile?.passportMasked ? <> · паспорт {profile.passportMasked}</> : null}
          </p>
        </div>
        <LogoutButton />
      </div>

      {!active ? (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Аккаунт ещё не активирован администратором — принимать заявки и получать товар можно только после активации.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Лимит</p>
          <p className="mt-2 text-2xl font-black">{formatTjs(finance.limit)}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-600" style={{ width: `${usedPct}%` }} /></div>
        </div>
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Доступно</p>
          <p className="mt-2 text-2xl font-black text-emerald-600">{formatTjs(finance.available)}</p>
          <p className="mt-1 text-xs text-slate-500">лимит − незакрытые выдачи</p>
        </div>
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Занято выдачами</p>
          <p className="mt-2 text-2xl font-black">{formatTjs(finance.used)}</p>
          <p className="mt-1 text-xs text-slate-500">освободится после подтверждения оплаты</p>
        </div>
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Баланс к выплате (3%)</p>
          <p className="mt-2 text-2xl font-black text-violet-700">{formatTjs(finance.payoutBalance)}</p>
          <p className="mt-1 text-xs text-slate-500">ожидает: {formatTjs(finance.pendingCommission)} · выплачено: {formatTjs(finance.paidOut)}</p>
        </div>
      </div>

      <div role="tablist" className="flex gap-2">
        {([["free", "Свободные заявки"], ["mine", "Мои заявки"]] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`${btn} ${tab === id ? "bg-violet-700 text-white" : "bg-white text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300"}`}>
            {label}
          </button>
        ))}
        <button onClick={() => setCreating(true)} disabled={!active} className={`${btn} ml-auto bg-emerald-600 text-white hover:bg-emerald-500`}>+ Создать заказ</button>
        <button onClick={() => void load(tab)} className={`${btn} border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200`}>Обновить</button>
      </div>

      {toast ? (
        <p role={toast.ok ? "status" : "alert"} className={`rounded-xl p-3 text-sm ${toast.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{toast.text}</p>
      ) : null}

      {loading ? <p className="text-slate-500">Загружаем заявки…</p> : null}
      {!loading && orders.length === 0 ? (
        <div className={`${card} text-center text-sm text-slate-500`}>
          {tab === "free" ? "Свободных заявок сейчас нет. Список обновляется автоматически." : "У вас пока нет принятых заявок."}
        </div>
      ) : null}

      {creating ? (
        <DealerOrderModal
          onClose={() => setCreating(false)}
          onCreated={(orderNumber) => {
            setCreating(false);
            setToast({ ok: true, text: `Заказ ${orderNumber} создан и закреплён за вами. Следующий шаг — «Забрать товар со склада».` });
            if (tab !== "mine") setTab("mine"); else void load("mine", true);
          }}
        />
      ) : null}

      <div className="space-y-4">
        {orders.map((o) => (
          <article key={o.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black">{o.orderNumber}</p>
                <p className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleString("ru-RU")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[o.status] ?? "bg-slate-200 text-slate-700"}`}>{ORDER_STATUS_LABELS[o.status] ?? o.status}</span>
                <span className="text-lg font-black">{formatTjs(o.total)}</span>
              </div>
            </div>

            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <div><p className="text-xs uppercase tracking-wide text-slate-500">Покупатель</p><p className="mt-1 font-medium">{o.customerName}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-slate-500">Телефон</p><p className="mt-1 font-medium">{o.masked ? o.phone : <a className="text-violet-700 underline" href={`tel:${o.phone}`}>{o.phone}</a>}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-slate-500">Адрес / комментарий</p><p className="mt-1 whitespace-pre-line break-words font-medium">{o.addressComment}</p></div>
            </div>
            {o.masked ? <p className="mt-2 text-xs text-slate-500">Полные контакты покупателя откроются после принятия заявки.</p> : null}

            <ul className="mt-4 divide-y divide-slate-100 rounded-xl bg-slate-50 px-4 text-sm dark:divide-slate-800 dark:bg-slate-800/50">
              {o.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3 py-2"><span>{i.name} × {i.quantity}</span><span className="shrink-0 font-semibold">{formatTjs(i.lineTotal)}</span></li>
              ))}
            </ul>

            {o.sale ? (
              <div className="mt-4 grid gap-3 rounded-xl bg-violet-50 p-4 text-sm dark:bg-violet-950/30 sm:grid-cols-4">
                <div><p className="text-xs text-slate-500">Оплатить складу</p><p className="font-bold">{formatTjs(o.sale.purchaseTotal)}</p></div>
                <div><p className="text-xs text-slate-500">Получить с покупателя</p><p className="font-bold">{formatTjs(o.sale.retailTotal)}</p></div>
                <div><p className="text-xs text-slate-500">Ваши 3%</p><p className="font-bold text-violet-700">{formatTjs(o.sale.dealerCommission)}</p></div>
                <div><p className="text-xs text-slate-500">Оплата покупателем</p><p className="font-bold">{o.sale.customerPaymentMethod === "cash" ? "Наличные" : o.sale.customerPaymentMethod === "transfer" ? "Перевод" : "—"}</p></div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {o.status === "pending_dealer" ? (
                <button disabled={busy === o.id || !active} onClick={() => void claim(o)} className={`${btn} bg-violet-700 text-white hover:bg-violet-600`}>
                  {busy === o.id ? "Принимаем…" : "Принять заявку"}
                </button>
              ) : null}
              {o.status === "accepted" ? (
                <>
                  <button disabled={busy === o.id || !active} onClick={() => void issue(o)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                    {busy === o.id ? "Выдаём…" : "Забрать товар со склада"}
                  </button>
                  <button disabled={busy === o.id} onClick={() => void release(o)} className={`${btn} border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200`}>Вернуть в свободные</button>
                </>
              ) : null}
              {o.status === "issued" ? (
                payment?.orderId === o.id ? (
                  <div className="flex w-full flex-wrap items-end gap-3">
                    <label className="text-xs font-semibold text-slate-500">Покупатель заплатил
                      <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value as "cash" | "transfer" })} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                        <option value="cash">Наличными</option><option value="transfer">Переводом</option>
                      </select>
                    </label>
                    <label className="min-w-48 flex-1 text-xs font-semibold text-slate-500">Номер перевода / заметка
                      <input maxLength={200} value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
                    </label>
                    <button disabled={busy === o.id} onClick={() => void report(o)} className={`${btn} bg-amber-600 text-white hover:bg-amber-500`}>Отправить на подтверждение</button>
                    <button onClick={() => setPayment(null)} className={`${btn} text-slate-500`}>Отмена</button>
                  </div>
                ) : (
                  <button onClick={() => setPayment({ orderId: o.id, method: "cash", reference: "" })} className={`${btn} bg-amber-600 text-white hover:bg-amber-500`}>Сообщить об оплате</button>
                )
              ) : null}
              {o.status === "payment_reported" ? <span className="text-sm text-slate-500">Ждём подтверждения оплаты администратором.</span> : null}
              {o.status === "completed" ? <span className="text-sm text-emerald-600">Расчёт закрыт, лимит освобождён.</span> : null}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
