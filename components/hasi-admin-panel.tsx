"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatTjs } from "@/lib/currency";
import { ACCOUNT_STATUS_LABELS, ORDER_STATUS_LABELS } from "@/lib/hasi-config";

type Identity = { fullName: string; passportNumber: string; birthDate: string; issuedBy: string; issueDate: string; registrationAddress: string; notes: string };
type IdentityView = Identity & { passportScanUrl: string; passportScanMime: string };
type Dealer = {
  id: string; name: string; email: string; phone: string; status: string; createdAt: string;
  limit: number; used: number; available: number; payoutBalance: number; openOrders: number; identity: IdentityView | null;
};
type Totals = { hasiEarned: number; hasiPending: number; dealersToPay: number };
type AdminOrder = {
  id: string; orderNumber: string; customerName: string; phone: string; addressComment: string; total: number; status: string;
  createdAt: string; dealerName: string | null; items: Array<{ name: string; quantity: number }>;
};
type Settlement = {
  id: string; orderNumber: string; dealerName: string; amount: number; status: string; reportedAt: string;
  customerPaymentMethod: string | null; paymentReference: string; dealerCommission: number; hasiCommission: number;
};
type StockRow = { productId: string; name: string; sku: string; price: number; qty: number; purchasePrice: number };
type Distributor = { id: string; name: string; email: string; phone: string; warehouses: number };
type Sub = "dealers" | "orders" | "settlements" | "stock" | "distributors";

const subs: Array<[Sub, string]> = [["dealers", "Дилеры"], ["orders", "Заявки"], ["settlements", "Расчёты"], ["stock", "Склад и прайс"], ["distributors", "Дистрибьюторы"]];
const input = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white";
const primary = "rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-600 disabled:opacity-60";
const ghost = "rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800";
const card = "rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900";
const emptyIdentity: Identity = { fullName: "", passportNumber: "", birthDate: "", issuedBy: "", issueDate: "", registrationAddress: "", notes: "" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window === "undefined" ? null : localStorage.getItem("hasi-token");
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
  return data;
}

export function HasiAdminPanel() {
  const [sub, setSub] = useState<Sub>("dealers");
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => setToast({ ok, text });

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex flex-wrap gap-2">
        {subs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={sub === id} onClick={() => { setSub(id); setToast(null); }}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${sub === id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>
      {toast ? <p role={toast.ok ? "status" : "alert"} className={`rounded-xl p-3 text-sm ${toast.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{toast.text}</p> : null}
      {sub === "dealers" ? <DealersTab say={say} /> : null}
      {sub === "orders" ? <OrdersTab say={say} /> : null}
      {sub === "settlements" ? <SettlementsTab say={say} /> : null}
      {sub === "stock" ? <StockTab say={say} /> : null}
      {sub === "distributors" ? <DistributorsTab say={say} /> : null}
    </div>
  );
}

type SayProps = { say: (ok: boolean, text: string) => void };
const err = (e: unknown) => (e instanceof Error ? e.message : "Ошибка.");

/* ───── Дилеры ───── */
const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const SCAN_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

function checkScan(file: File | null): string | null {
  if (!file) return null;
  if (file.size > MAX_SCAN_BYTES) return "Скан паспорта больше 4 МБ — выберите файл поменьше.";
  if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/.test(file.type)) return "Допустимые форматы скана: PNG, JPG, WEBP, PDF.";
  return null;
}

function buildForm(data: unknown, file: File | null) {
  const fd = new FormData();
  fd.set("data", JSON.stringify(data));
  if (file) fd.set("passportScan", file);
  return fd;
}

/** Превью скана: картинка или плашка PDF; по клику открывается во весь экран. */
function ScanThumb({ identity, size = "h-12 w-12", onOpen }: { identity: IdentityView | null; size?: string; onOpen: (i: IdentityView) => void }) {
  if (!identity?.passportScanUrl) return <span className="text-xs text-slate-400">нет скана</span>;
  const isPdf = identity.passportScanMime === "application/pdf";
  return (
    <button type="button" onClick={() => onOpen(identity)} title="Открыть скан паспорта" aria-label="Открыть скан паспорта"
      className={`${size} overflow-hidden rounded-lg border border-slate-200 bg-slate-100 transition hover:ring-2 hover:ring-violet-400 dark:border-slate-700 dark:bg-slate-800`}>
      {isPdf
        ? <span className="flex h-full w-full items-center justify-center text-xs font-black text-rose-600">PDF</span>
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={identity.passportScanUrl} alt="Скан паспорта" className="h-full w-full object-cover" loading="lazy" />}
    </button>
  );
}

function Lightbox({ identity, onClose }: { identity: IdentityView; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const isPdf = identity.passportScanMime === "application/pdf";
  return (
    <div role="dialog" aria-modal="true" aria-label="Скан паспорта" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative flex max-h-full w-full max-w-4xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between text-white">
          <p className="text-sm font-semibold">{identity.fullName} · {identity.passportNumber}</p>
          <div className="flex gap-2">
            <a href={identity.passportScanUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">В новой вкладке</a>
            <button onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Закрыть</button>
          </div>
        </div>
        {isPdf
          ? <iframe src={identity.passportScanUrl} title="Скан паспорта (PDF)" className="h-[80vh] w-full rounded-xl bg-white" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={identity.passportScanUrl} alt="Скан паспорта" className="max-h-[80vh] w-full rounded-xl bg-white object-contain" />}
      </div>
    </div>
  );
}

function IdentityFields({ value, set }: { value: Identity; set: (i: Identity) => void }) {
  const f = (k: keyof Identity, placeholder: string, extra = "") => (
    <input className={`${input} ${extra}`} required={k === "fullName" || k === "passportNumber"} placeholder={placeholder} value={value[k]} onChange={(e) => set({ ...value, [k]: e.target.value })} />
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {f("fullName", "ФИО по паспорту")}
      {f("passportNumber", "Серия и номер паспорта")}
      {f("birthDate", "Дата рождения")}
      {f("issuedBy", "Кем выдан")}
      {f("issueDate", "Дата выдачи")}
      {f("registrationAddress", "Адрес регистрации")}
      {f("notes", "Заметки", "sm:col-span-2")}
    </div>
  );
}

function FileField({ label, file, onChange, hint }: { label: string; file: File | null; onChange: (f: File | null) => void; hint?: string }) {
  return (
    <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <span className="font-semibold">{label}</span>{" "}
      <span className="text-slate-500">{file ? `— ${file.name} (${(file.size / 1024).toFixed(0)} КБ)` : hint ?? "PNG, JPG, WEBP или PDF, до 4 МБ"}</span>
      <input type="file" accept={SCAN_ACCEPT} className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}

type EditState = { id: string; name: string; email: string; phone: string; status: string; limit: string; identity: Identity; current: IdentityView | null; scan: File | null };

export function DealersManager() {
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-5">
      {toast ? <p role={toast.ok ? "status" : "alert"} className={`rounded-xl p-3 text-sm ${toast.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{toast.text}</p> : null}
      <DealersTab say={(ok, text) => setToast({ ok, text })} />
    </div>
  );
}

function DealersTab({ say }: SayProps) {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(10000);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", status: "active", limit: "", identity: emptyIdentity });
  const [formScan, setFormScan] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [viewer, setViewer] = useState<IdentityView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ dealers: Dealer[]; defaultLimit: number; totals: Totals }>("/api/admin/dealers");
      setDealers(d.dealers); setDefaultLimit(d.defaultLimit); setTotals(d.totals);
    } catch (e) { say(false, err(e)); }
  }, [say]);
  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const bad = checkScan(formScan);
    if (bad) return say(false, bad);
    setBusy(true);
    try {
      await api("/api/admin/dealers", { method: "POST", body: buildForm({ ...form, limit: form.limit === "" ? null : Number(form.limit) }, formScan) });
      setForm({ name: "", email: "", phone: "", password: "", status: "active", limit: "", identity: emptyIdentity });
      setFormScan(null); setFileKey((k) => k + 1);
      say(true, "Дилер создан. Передайте ему email и пароль для входа."); await load();
    } catch (x) { say(false, err(x)); } finally { setBusy(false); }
  }

  function startEdit(d: Dealer) {
    const { passportScanUrl, passportScanMime, ...identity } = d.identity ?? { ...emptyIdentity, passportScanUrl: "", passportScanMime: "" };
    void passportScanUrl; void passportScanMime;
    setEditing({ id: d.id, name: d.name, email: d.email, phone: d.phone, status: d.status, limit: String(d.limit), identity, current: d.identity, scan: null });
  }

  async function save() {
    if (!editing) return;
    const bad = checkScan(editing.scan);
    if (bad) return say(false, bad);
    setBusy(true);
    try {
      await api(`/api/admin/dealers/${editing.id}`, {
        method: "PATCH",
        body: buildForm({ name: editing.name, email: editing.email, phone: editing.phone, status: editing.status, limit: Number(editing.limit), identity: editing.identity }, editing.scan),
      });
      setEditing(null); say(true, "Изменения сохранены."); await load();
    } catch (x) { say(false, err(x)); } finally { setBusy(false); }
  }

  async function remove(d: Dealer) {
    if (!confirm(`Вы уверены, что хотите удалить этого дилера?\n\n${d.name} (${d.email})`)) return;
    try {
      const r = await api<{ message: string }>(`/api/admin/dealers/${d.id}`, { method: "DELETE" });
      say(true, r.message); await load();
    } catch (x) { say(false, err(x)); }
  }

  async function payout(d: Dealer) {
    if (!confirm(`Выплатить ${formatTjs(d.payoutBalance)} дилеру ${d.name}?`)) return;
    try { const r = await api<{ paidOut: number }>(`/api/admin/dealers/${d.id}/payout`, { method: "POST" }); say(true, `Выплачено ${formatTjs(r.paidOut)}.`); await load(); }
    catch (x) { say(false, err(x)); }
  }

  async function saveDefault() {
    try { await api("/api/admin/hasi/settings", { method: "PUT", body: JSON.stringify({ defaultLimit }) }); say(true, "Базовый лимит обновлён (для новых дилеров)."); }
    catch (x) { say(false, err(x)); }
  }

  return (
    <div className="space-y-5">
      {totals ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={card}><p className="text-xs text-slate-500">HASI Market заработал (7%)</p><p className="mt-1 text-2xl font-black">{formatTjs(totals.hasiEarned)}</p><p className="text-xs text-slate-500">ожидает: {formatTjs(totals.hasiPending)}</p></div>
          <div className={card}><p className="text-xs text-slate-500">К выплате дилерам (3%)</p><p className="mt-1 text-2xl font-black text-violet-700">{formatTjs(totals.dealersToPay)}</p></div>
          <div className={card}>
            <p className="text-xs text-slate-500">Базовый лимит нового дилера, сомони</p>
            <div className="mt-1 flex gap-2"><input className={input} type="number" min={0} value={defaultLimit} onChange={(e) => setDefaultLimit(Number(e.target.value))} /><button className={primary} onClick={() => void saveDefault()}>Сохранить</button></div>
          </div>
        </div>
      ) : null}

      <form onSubmit={create} className={`${card} space-y-4`}>
        <h3 className="text-lg font-bold">Новый дилер</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={input} required placeholder="ФИО дилера" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={input} required type="email" placeholder="Email (логин)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={input} placeholder="Телефон" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={input} required minLength={8} type="text" placeholder="Пароль (от 8 символов)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(ACCOUNT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className={input} type="number" min={0} placeholder={`Лимит (по умолчанию ${defaultLimit})`} value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} />
        </div>
        <IdentityFields value={form.identity} set={(identity) => setForm({ ...form, identity })} />
        <FileField key={fileKey} label="Фото / скан паспорта" file={formScan} onChange={setFormScan} />
        <button disabled={busy} className={primary}>{busy ? "Создаём…" : "Создать дилера"}</button>
      </form>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Дилер</th><th>Паспорт</th><th>Статус</th><th>Лимит</th><th>Занято</th><th>Доступно</th><th>К выплате</th><th>Открытых</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {dealers.map((d) => (
              <tr key={d.id}>
                <td className="py-3"><p className="font-semibold">{d.name}</p><p className="text-xs text-slate-500">{d.email}{d.phone ? ` · ${d.phone}` : ""}</p></td>
                <td>
                  <div className="flex items-center gap-2">
                    <ScanThumb identity={d.identity} onOpen={setViewer} />
                    <span className="text-xs text-slate-500">{d.identity?.passportNumber}</span>
                  </div>
                </td>
                <td>{ACCOUNT_STATUS_LABELS[d.status] ?? d.status}</td>
                <td>{formatTjs(d.limit)}</td><td>{formatTjs(d.used)}</td><td>{formatTjs(d.available)}</td><td className="font-semibold text-violet-700">{formatTjs(d.payoutBalance)}</td><td>{d.openOrders}</td>
                <td className="space-x-2 whitespace-nowrap py-3 text-right">
                  <button className={ghost} onClick={() => startEdit(d)}>Изменить</button>
                  {d.payoutBalance > 0 ? <button className={ghost} onClick={() => void payout(d)}>Выплатить</button> : null}
                  <button className={`${ghost} border-rose-300 text-rose-700 hover:bg-rose-50`} onClick={() => void remove(d)} aria-label={`Удалить дилера ${d.name}`}>Удалить</button>
                </td>
              </tr>
            ))}
            {!dealers.length ? <tr><td colSpan={9} className="py-6 text-center text-slate-500">Дилеров пока нет.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <div role="dialog" aria-modal="true" aria-label="Редактирование дилера" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => !busy && setEditing(null)}>
          <div className={`${card} my-8 w-full max-w-3xl space-y-4`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Редактирование дилера</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-500">ФИО дилера<input className={`${input} mt-1`} required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="text-xs font-semibold text-slate-500">Email<input className={`${input} mt-1`} type="email" required value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
              <label className="text-xs font-semibold text-slate-500">Номер телефона<input className={`${input} mt-1`} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label>
              <label className="text-xs font-semibold text-slate-500">Лимит, сомони<input className={`${input} mt-1`} type="number" min={0} value={editing.limit} onChange={(e) => setEditing({ ...editing, limit: e.target.value })} /></label>
              <label className="text-xs font-semibold text-slate-500">Статус аккаунта
                <select className={`${input} mt-1`} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  {Object.entries(ACCOUNT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <IdentityFields value={editing.identity} set={(identity) => setEditing({ ...editing, identity })} />
            <div className="flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
              <ScanThumb identity={editing.current} size="h-24 w-24" onOpen={setViewer} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-semibold">{editing.current?.passportScanUrl ? "Текущий скан паспорта" : "Скан паспорта не загружен"}</p>
                <FileField label={editing.current?.passportScanUrl ? "Заменить фото" : "Загрузить фото"} file={editing.scan} onChange={(scan) => setEditing({ ...editing, scan })} hint="PNG, JPG, WEBP или PDF, до 4 МБ — заменится после «Сохранить»" />
              </div>
            </div>
            <div className="flex gap-3"><button disabled={busy} className={primary} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить"}</button><button disabled={busy} className={ghost} onClick={() => setEditing(null)}>Отмена</button></div>
          </div>
        </div>
      ) : null}

      {viewer ? <Lightbox identity={viewer} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

/* ───── Заявки ───── */
function OrdersTab({ say }: SayProps) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    try { setOrders((await api<{ orders: AdminOrder[] }>(`/api/admin/hasi/orders${status ? `?status=${status}` : ""}`)).orders); }
    catch (e) { say(false, err(e)); }
  }, [status, say]);
  useEffect(() => { void load(); }, [load]);

  async function cancel(o: AdminOrder) {
    if (!confirm(`Отменить заявку ${o.orderNumber}?`)) return;
    try { await api(`/api/admin/hasi/orders/${o.id}`, { method: "DELETE" }); say(true, "Заявка отменена."); await load(); } catch (e) { say(false, err(e)); }
  }

  return (
    <div className={`${card} space-y-4`}>
      <select className={`${input} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Все статусы</option>
        {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Заказ</th><th>Покупатель</th><th>Товары</th><th>Сумма</th><th>Статус</th><th>Дилер</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {orders.map((o) => (
              <tr key={o.id} className="align-top">
                <td className="py-3"><p className="font-semibold">{o.orderNumber}</p><p className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleString("ru-RU")}</p></td>
                <td><p>{o.customerName}</p><p className="text-xs text-slate-500">{o.phone}</p><p className="max-w-56 text-xs text-slate-500">{o.addressComment}</p></td>
                <td className="text-xs">{o.items.map((i) => `${i.name} × ${i.quantity}`).join("; ")}</td>
                <td className="whitespace-nowrap font-semibold">{formatTjs(o.total)}</td>
                <td>{ORDER_STATUS_LABELS[o.status] ?? o.status}</td>
                <td>{o.dealerName || "—"}</td>
                <td className="py-3 text-right">{o.status === "pending_dealer" || o.status === "accepted" ? <button className={ghost} onClick={() => void cancel(o)}>Отменить</button> : null}</td>
              </tr>
            ))}
            {!orders.length ? <tr><td colSpan={7} className="py-6 text-center text-slate-500">Заявок нет.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───── Расчёты ───── */
function SettlementsTab({ say }: SayProps) {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [status, setStatus] = useState("pending");
  const load = useCallback(async () => {
    try { setRows((await api<{ settlements: Settlement[] }>(`/api/admin/hasi/settlements${status ? `?status=${status}` : ""}`)).settlements); }
    catch (e) { say(false, err(e)); }
  }, [status, say]);
  useEffect(() => { void load(); }, [load]);

  async function act(s: Settlement, action: "confirm" | "reject") {
    const note = action === "reject" ? prompt("Причина отклонения (необязательно):") ?? "" : "";
    try {
      await api(`/api/admin/hasi/settlements/${s.id}`, { method: "POST", body: JSON.stringify({ action, note }) });
      say(true, action === "confirm" ? "Оплата подтверждена: лимит освобождён, 3% зачислены дилеру." : "Оплата отклонена."); await load();
    } catch (e) { say(false, err(e)); }
  }

  return (
    <div className={`${card} space-y-4`}>
      <select className={`${input} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending">Ждут подтверждения</option><option value="confirmed">Подтверждённые</option><option value="rejected">Отклонённые</option><option value="">Все</option>
      </select>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Заказ</th><th>Дилер</th><th>К оплате складу</th><th>Дилеру 3%</th><th>HASI 7%</th><th>Оплата покупателя</th><th>Статус</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="py-3"><p className="font-semibold">{s.orderNumber}</p><p className="text-xs text-slate-500">{new Date(s.reportedAt).toLocaleString("ru-RU")}</p></td>
                <td>{s.dealerName}</td>
                <td className="font-semibold">{formatTjs(s.amount)}</td><td>{formatTjs(s.dealerCommission)}</td><td>{formatTjs(s.hasiCommission)}</td>
                <td>{s.customerPaymentMethod === "cash" ? "Наличные" : s.customerPaymentMethod === "transfer" ? "Перевод" : "—"}{s.paymentReference ? <p className="text-xs text-slate-500">{s.paymentReference}</p> : null}</td>
                <td>{s.status === "pending" ? "Ждёт" : s.status === "confirmed" ? "Подтверждён" : "Отклонён"}</td>
                <td className="space-x-2 whitespace-nowrap py-3 text-right">
                  {s.status === "pending" ? <><button className={primary} onClick={() => void act(s, "confirm")}>Подтвердить</button><button className={ghost} onClick={() => void act(s, "reject")}>Отклонить</button></> : null}
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={8} className="py-6 text-center text-slate-500">Расчётов нет.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───── Склад и прайс ───── */
function StockTab({ say }: SayProps) {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { qty: string; purchasePrice: string }>>({});
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    try { setRows((await api<{ stock: StockRow[] }>("/api/admin/hasi/stock")).stock); setDraft({}); }
    catch (e) { say(false, err(e)); }
  }, [say]);
  useEffect(() => { void load(); }, [load]);

  async function save(r: StockRow) {
    const d = draft[r.productId]; if (!d) return;
    try {
      await api(`/api/admin/hasi/stock/${r.productId}`, { method: "PATCH", body: JSON.stringify({ qty: Number(d.qty), purchasePrice: Number(d.purchasePrice) }) });
      say(true, `«${r.name}» обновлён.`); await load();
    } catch (e) { say(false, err(e)); }
  }

  const shown = rows.filter((r) => !q || `${r.name} ${r.sku}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={`${card} space-y-4`}>
      <p className="text-sm text-slate-500">Остаток центрального склада HASI и закупочная цена по прайс-листу (по умолчанию розница ÷ 1,10). Остаток синхронно отображается на витрине.</p>
      <input className={`${input} max-w-xs`} placeholder="Поиск по названию / SKU" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Товар</th><th>Розница</th><th>Закупка</th><th>Остаток</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((r) => {
              const d = draft[r.productId] ?? { qty: String(r.qty), purchasePrice: String(r.purchasePrice) };
              const dirty = Boolean(draft[r.productId]);
              return (
                <tr key={r.productId}>
                  <td className="py-2"><p className="font-semibold">{r.name}</p><p className="text-xs text-slate-500">{r.sku}</p></td>
                  <td>{formatTjs(r.price)}</td>
                  <td><input className={`${input} w-28`} type="number" min={0} step="0.01" value={d.purchasePrice} onChange={(e) => setDraft({ ...draft, [r.productId]: { ...d, purchasePrice: e.target.value } })} /></td>
                  <td><input className={`${input} w-24`} type="number" min={0} step={1} value={d.qty} onChange={(e) => setDraft({ ...draft, [r.productId]: { ...d, qty: e.target.value } })} /></td>
                  <td className="text-right"><button className={primary} disabled={!dirty} onClick={() => void save(r)}>Сохранить</button></td>
                </tr>
              );
            })}
            {!shown.length ? <tr><td colSpan={5} className="py-6 text-center text-slate-500">Товаров нет.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───── Дистрибьюторы ───── */
function DistributorsTab({ say }: SayProps) {
  const [rows, setRows] = useState<Distributor[]>([]);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const load = useCallback(async () => {
    try { setRows((await api<{ distributors: Distributor[] }>("/api/admin/hasi/distributors")).distributors); } catch (e) { say(false, err(e)); }
  }, [say]);
  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/admin/hasi/distributors", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", phone: "", password: "" }); say(true, "Дистрибьютор и его склад созданы."); await load();
    } catch (x) { say(false, err(x)); }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={create} className={`${card} space-y-3`}>
        <h3 className="text-lg font-bold">Новый дистрибьютор</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <input className={input} required placeholder="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={input} required type="email" placeholder="Email (логин)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={input} placeholder="Телефон" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={input} required minLength={8} placeholder="Пароль (от 8 символов)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className={primary}>Создать</button>
      </form>
      <div className={card}>
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {rows.map((d) => <li key={d.id} className="flex flex-wrap justify-between gap-2 py-3"><span className="font-semibold">{d.name}</span><span className="text-slate-500">{d.email} · складов: {d.warehouses}</span></li>)}
          {!rows.length ? <li className="py-4 text-center text-slate-500">Дистрибьюторов пока нет.</li> : null}
        </ul>
      </div>
    </div>
  );
}
