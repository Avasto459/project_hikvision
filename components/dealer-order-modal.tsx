"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductImage } from "@/components/product-image";
import { formatTjs } from "@/lib/currency";
import { productImageSrc } from "@/lib/product-images";

type Product = {
  id: string; name: string; sku: string; brand: string; price: number;
  stock: number | null; image: string; images: string[]; type: "product" | "service";
};

const inputClass = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white";

const sourcesOf = (p: Product) => [...new Set([p.image, ...p.images].filter(Boolean).map(productImageSrc).filter(Boolean))];

/**
 * Модальное окно «Создать новый заказ»: сетка товаров (как в каталоге) с поиском,
 * корзина заказа с количеством и кнопкой «×», автоматический итог.
 */
export function DealerOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (orderNumber: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ name: "", phone: "", addressComment: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // закрытие по Esc + блокировка прокрутки страницы под модалкой
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, submitting]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dealer/products/available", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { products?: Product[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Не удалось загрузить товары.");
        if (alive) setProducts(data.products ?? []);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "Не удалось загрузить товары.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.sku} ${p.brand}`.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const lines: Array<{ p: Product; quantity: number }> = (Object.entries(cart) as Array<[string, number]>).flatMap(([id, quantity]) => { const p = byId.get(id); return p ? [{ p, quantity }] : []; });
  const total = lines.reduce((sum, l) => sum + l.p.price * l.quantity, 0);
  const maxFor = (p: Product) => (p.stock === null ? 999 : p.stock);

  const add = (p: Product) => setCart((c) => ({ ...c, [p.id]: Math.min((c[p.id] ?? 0) + 1, maxFor(p)) }));
  const setQty = (p: Product, quantity: number) =>
    setCart((c) => (quantity <= 0 ? Object.fromEntries(Object.entries(c).filter(([id]) => id !== p.id)) : { ...c, [p.id]: Math.min(quantity, maxFor(p)) }));
  const remove = (p: Product) => setQty(p, 0);

  async function submit() {
    setError("");
    if (!lines.length) return setError("Добавьте в заказ хотя бы один товар.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/dealer/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, items: lines.map((l) => ({ productId: l.p.id, quantity: l.quantity })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { orderNumber?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Не удалось создать заказ.");
      onCreated(data.orderNumber ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать заказ.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Создать новый заказ" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => !submitting && onClose()}>
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-xl font-black text-slate-900 dark:text-white">Создать новый заказ</h2>
          <button onClick={onClose} disabled={submitting} aria-label="Закрыть" className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">×</button>
        </div>

        <div className="grid flex-1 gap-0 overflow-y-auto lg:grid-cols-[1.5fr_1fr] lg:overflow-hidden">
          {/* ───── сетка товаров ───── */}
          <section className="flex flex-col border-b border-slate-200 p-5 dark:border-slate-800 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Выберите товары</h3>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, бренду, SKU" className={`${inputClass} mt-3`} />
            {loading ? <p className="mt-6 text-sm text-slate-500">Загружаем товары…</p> : null}
            {loadError ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{loadError}</p> : null}
            {!loading && !loadError && shown.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">{products.length ? "Ничего не найдено." : "Нет товаров в наличии на складе."}</p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shown.map((p) => {
                const inCart = cart[p.id] ?? 0;
                const full = inCart >= maxFor(p);
                return (
                  <article key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                    <ProductImage sources={sourcesOf(p)} alt={p.name} className="aspect-square" fit="contain" hoverZoom={false} />
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <p className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-white">{p.name}</p>
                      <p className="text-sm font-black text-violet-700 dark:text-violet-300">{formatTjs(p.price)}</p>
                      <p className="text-xs text-slate-500">{p.stock === null ? "Услуга" : `Осталось: ${p.stock}`}</p>
                      <button type="button" onClick={() => add(p)} disabled={full}
                        className="mt-auto rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50">
                        {full ? "Весь остаток в заказе" : inCart ? `+ Ещё (в заказе: ${inCart})` : "+ Добавить"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* ───── корзина заказа и данные покупателя ───── */}
          <section className="flex flex-col gap-4 p-5 lg:min-h-0 lg:overflow-y-auto">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">В корзине заказа</h3>
              {lines.length === 0 ? <p className="mt-3 text-sm text-slate-500">Пока пусто — нажмите «+ Добавить» у товара.</p> : (
                <ul className="mt-3 space-y-2">
                  {lines.map(({ p, quantity }) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-2 dark:bg-slate-800">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg"><ProductImage sources={sourcesOf(p)} alt={p.name} className="aspect-square" fit="contain" hoverZoom={false} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{p.name}</p>
                        <p className="text-xs text-slate-500">{formatTjs(p.price)} × {quantity} = <span className="font-bold text-slate-700 dark:text-slate-200">{formatTjs(p.price * quantity)}</span></p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setQty(p, quantity - 1)} aria-label="Меньше" className="h-7 w-7 rounded-lg border border-slate-300 text-sm dark:border-slate-600 dark:text-white">−</button>
                        <span className="w-6 text-center text-sm font-semibold text-slate-900 dark:text-white">{quantity}</span>
                        <button type="button" onClick={() => setQty(p, quantity + 1)} disabled={quantity >= maxFor(p)} aria-label="Больше" className="h-7 w-7 rounded-lg border border-slate-300 text-sm disabled:opacity-40 dark:border-slate-600 dark:text-white">+</button>
                      </div>
                      <button type="button" onClick={() => remove(p)} aria-label={`Убрать ${p.name}`} className="h-7 w-7 rounded-lg text-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">×</button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
                <span className="text-sm font-bold uppercase tracking-wide text-slate-500">Итого</span>
                <span className="text-2xl font-black text-slate-900 dark:text-white">{formatTjs(total)}</span>
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Покупатель</h3>
              <input className={inputClass} placeholder="Имя" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inputClass} type="tel" placeholder="Телефон +992XXXXXXXXX" autoComplete="off" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <textarea className={inputClass} rows={3} placeholder="Адрес / комментарий" value={form.addressComment} onChange={(e) => setForm({ ...form, addressComment: e.target.value })} />
            </div>

            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p> : null}
            <div className="mt-auto flex gap-3">
              <button type="button" onClick={() => void submit()} disabled={submitting || lines.length === 0}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50">
                {submitting ? "Создаём…" : "Создать заказ"}
              </button>
              <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">Отмена</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
