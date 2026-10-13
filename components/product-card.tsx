"use client";

import Link from "next/link";
import { ArrowRight, Check, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/components/store-provider";
import { formatTjs } from "@/lib/currency";
import type { Product } from "@/lib/db";
import { FavoriteButton } from "@/components/favorite-button";
import { ProductImage } from "@/components/product-image";
import { productImageSrc } from "@/lib/product-images";

type ProductCardProduct = Product & { categorySlug?: string; categoryName?: string };

const LOW_STOCK_LIMIT = 5;

function stockBadge(stock: number) {
  if (stock < 1) return { text: "Нет в наличии", className: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30" };
  if (stock <= LOW_STOCK_LIMIT) return { text: `Осталось ${stock}`, className: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" };
  return { text: "В наличии", className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" };
}

export function ProductCard({ product }: { product: ProductCardProduct }) {
  const { addItem } = useCart();
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const sources = [...new Set([product.image, ...(product.images || [])].filter(Boolean).map(productImageSrc).filter(Boolean))];
  const badge = product.type === "service"
    ? { text: "Услуга", className: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30" }
    : stockBadge(product.stock);
  const discount = product.previousPrice && product.previousPrice > product.price
    ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
    : 0;
  const outOfStock = product.stock < 1;

  async function addToCart() {
    setError("");
    setAdded(false);
    setAdding(true);
    try {
      await addItem({ ...product, quantity: 1 });
      setAdded(true);
      window.setTimeout(() => setAdded(false), 2000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось добавить товар.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_2px_12px_-4px_rgba(15,23,42,0.12)] transition duration-300 hover:-translate-y-1.5 hover:border-violet-300 hover:shadow-[0_18px_40px_-12px_rgba(109,40,217,0.28)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none dark:hover:border-violet-500/50">
      <Link href={`/product/${product.slug}`} className="relative block border-b border-slate-100 dark:border-slate-800" aria-label={product.name}>
        <ProductImage sources={sources} alt={product.name} className="aspect-square" fit="contain" />
        {discount ? (
          <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm">-{discount}%</span>
        ) : null}
        <div className="absolute right-3 top-3" onClick={(event) => event.preventDefault()}><FavoriteButton product={product} /></div>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{product.categoryName || "Оборудование"}</span>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${badge.className}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {badge.text}
          </span>
        </div>

        <Link href={`/product/${product.slug}`} className="line-clamp-2 min-h-[3.25rem] text-base font-bold leading-snug text-slate-900 transition hover:text-violet-600 dark:text-white dark:hover:text-violet-300">
          {product.name}
        </Link>
        {(product.brand || product.sku) ? <p className="truncate text-xs text-slate-500 dark:text-slate-400">{[product.brand, product.sku && `Арт. ${product.sku}`].filter(Boolean).join(" · ")}</p> : null}
        <p className="line-clamp-2 min-h-10 text-sm text-slate-600 dark:text-slate-300">{product.shortDescription}</p>

        <div className="mt-auto space-y-3 pt-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-slate-900 dark:text-white">{formatTjs(product.price)}</span>
            {discount ? <span className="text-sm text-slate-400 line-through">{formatTjs(product.previousPrice as number)}</span> : null}
          </div>
          <button
            type="button"
            onClick={addToCart}
            disabled={outOfStock || adding}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${added ? "bg-emerald-600 hover:bg-emerald-500" : "bg-violet-600 hover:bg-violet-500 hover:shadow-md"} disabled:bg-slate-400 dark:disabled:bg-slate-700`}
          >
            {added ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            {outOfStock ? "Нет в наличии" : added ? "Добавлено" : adding ? "Добавляем…" : "В корзину"}
          </button>
          {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
          <Link href={`/product/${product.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 transition hover:gap-2.5 hover:text-violet-500 dark:text-violet-300">
            Подробнее <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}
