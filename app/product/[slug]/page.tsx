import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck, Truck } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { ProductPurchase } from "@/components/product-purchase";
import { ProductGallery } from "@/components/product-gallery";
import { FavoriteButton } from "@/components/favorite-button";
import { SiteShell } from "@/components/site-shell";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { getCategoryPath, getProductBySlug, getProducts, type Product } from "@/lib/db";
import { formatTjs } from "@/lib/currency";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const path = await getCategoryPath(product.categorySlug ?? "");
  const crumbs: Crumb[] = [
    { label: "Главная", href: "/" },
    { label: "Каталог", href: "/catalog" },
    ...path.map((item) => ({ label: item.name, href: `/catalog?category=${encodeURIComponent(item.slug)}` })),
    { label: product.name },
  ];
  const relatedProducts = (await getProducts({ categorySlug: product.categorySlug, limit: 5 })).filter((item: Product) => item.id !== product.id).slice(0, 4);

  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Breadcrumbs items={crumbs} />

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <ProductGallery images={product.images} name={product.name} />

          <div className="space-y-6">
            <div className="flex justify-end"><FavoriteButton product={product} /></div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{product.brand || product.categoryName}{product.sku ? ` · Артикул: ${product.sku}` : ""}</div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white">{product.name}</h1>
            <p className="text-slate-600 dark:text-slate-300">{product.shortDescription}</p>

            <div className="flex items-end gap-4">
              <div className="text-4xl font-black text-slate-900 dark:text-white">{formatTjs(product.price)}</div>
              {product.previousPrice && product.previousPrice > product.price ? (
                <div className="text-lg text-slate-400 line-through dark:text-slate-500">{formatTjs(product.previousPrice)}</div>
              ) : null}
            </div>

            {product.type === "service" ? (
              <p className="text-sm font-medium text-sky-600">Услуга — оформляется по заявке, дилер свяжется с вами.</p>
            ) : (
              <p className={product.stock > 0 ? "text-sm font-medium text-emerald-600" : "text-sm font-medium text-rose-600"}>
                {product.stock > 0 ? `В наличии: ${product.stock} шт.` : "Нет в наличии"}
              </p>
            )}
            <ProductPurchase product={product} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <Truck className="h-5 w-5 text-violet-600 dark:text-violet-300" />
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Доставка в Таджикистане</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-violet-600 dark:text-violet-300" />
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Гарантия качества</div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900/70">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Описание</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{product.description}</p>
            </div>
            {Object.keys(product.specifications).length ? (
              <section className="rounded-[28px] border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Характеристики</h2>
                <dl className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                  {Object.entries(product.specifications).map(([key, value]) => <div key={key} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-slate-500">{key}</dt><dd className="text-right font-medium text-slate-900 dark:text-white">{value}</dd></div>)}
                </dl>
              </section>
            ) : null}
          </div>
        </div>

        <div className="mt-16">
          <h2 className="text-3xl font-black text-slate-900 dark:text-white">Похожие товары</h2>
          {relatedProducts.length ? <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {relatedProducts.map((related: Product) => <ProductCard key={related.id} product={related} />)}
          </div> : <p className="mt-5 text-slate-500">Похожие товары появятся в каталоге позже.</p>}
        </div>
      </section>
    </SiteShell>
  );
}
