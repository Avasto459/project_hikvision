import Link from "next/link";
import { ArrowRight, Camera, Cable, HardDrive, MonitorCog, ShieldCheck } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { SiteShell } from "@/components/site-shell";
import { getCategories, getProducts } from "@/lib/db";

export const dynamic = "force-dynamic";

const equipmentTypes = [
  { name: "Камеры", detail: "IP, Wi-Fi, уличные, PTZ", icon: Camera },
  { name: "Запись", detail: "Видеорегистраторы и комплекты", icon: MonitorCog },
  { name: "Комплектующие", detail: "Диски, кабели, питание", icon: HardDrive },
];

export default async function HomePage() {
  const categories = (await getCategories()).filter((category) => !category.parentId); // на главной — только главные категории
  const popularProducts = await getProducts({ featured: true, limit: 4 });
  const newProducts = await getProducts({ limit: 4 });

  return (
    <SiteShell>
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(124,58,237,.35),transparent_32%),linear-gradient(125deg,#07111f,#111827_55%,#1e1b4b)]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_.9fr] lg:px-8 lg:py-24">
          <div className="flex min-w-0 flex-col justify-center">
            <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full border border-violet-300/30 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-200">
              <ShieldCheck className="h-4 w-4" /> Безопасность начинается с контроля
            </div>
            <h1 className="mt-6 max-w-2xl text-4xl font-black tracking-tight sm:text-6xl">Видеонаблюдение для дома и бизнеса</h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
              Камеры, видеорегистраторы и оборудование для систем безопасности. Подберите оборудование в каталоге HASI.TJ.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/catalog" className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500">
                Открыть каталог <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/contact" className="rounded-full border border-white/20 px-6 py-3 font-semibold text-white hover:bg-white/10">Связаться с нами</Link>
            </div>
            <p className="mt-6 text-sm text-slate-400">IP-камеры · Wi-Fi · Уличные камеры · NVR/DVR · Комплектующие</p>
          </div>
          <div className="flex items-center justify-center">
            <div className="w-full max-w-lg rounded-[32px] border border-white/10 bg-white/[.06] p-7 shadow-2xl backdrop-blur">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex h-52 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-indigo-950">
                  <Camera className="h-24 w-24 text-violet-200" strokeWidth={1.2} />
                </div>
                {equipmentTypes.map(({ name, detail, icon: Icon }) => (
                  <div key={name} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <Icon className="h-6 w-6 text-violet-300" />
                    <div className="mt-3 font-semibold">{name}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-400">{detail}</div>
                  </div>
                ))}
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <Cable className="h-6 w-6 text-violet-300" />
                  <div className="mt-3 font-semibold">Монтаж</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">Подбор решений и оборудования</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-violet-700 dark:text-violet-300">Каталог HASI.TJ</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 dark:text-white">Категории оборудования</h2>
          </div>
          <Link href="/catalog" className="text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300">Все товары →</Link>
        </div>
        {categories.length ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <Link key={category.id} href={`/category/${category.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-violet-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-slate-900 dark:text-white">{category.name}</div>
                  <ArrowRight className="h-5 w-5 text-violet-600 transition group-hover:translate-x-1" />
                </div>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{category.subtitle || category.description}</p>
              </Link>
            ))}
          </div>
        ) : <p className="mt-6 text-slate-500">Категории скоро появятся.</p>}
      </section>

      <section className="bg-slate-900 py-14 text-white dark:bg-slate-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-violet-300">Выбор HASI.TJ</p>
              <h2 className="mt-2 text-3xl font-black">Популярные товары</h2>
            </div>
            <Link href="/catalog" className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold hover:border-violet-400">Перейти в каталог</Link>
          </div>
          {popularProducts.length ? <div className="mt-7 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{popularProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div> : (
            <div className="mt-7 rounded-2xl border border-slate-700 bg-slate-800/60 p-6 text-slate-300">
              Популярные товары появятся здесь после публикации фактического ассортимента в каталоге.
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-violet-700 dark:text-violet-300">Ассортимент магазина</p>
            <h2 className="mt-2 text-3xl font-black text-slate-900 dark:text-white">Новые товары</h2>
          </div>
          <Link href="/catalog" className="text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300">Весь каталог →</Link>
        </div>
        {newProducts.length ? <div className="mt-7 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{newProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div> : (
          <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Опубликованных товаров пока нет. Каталог не заполняется демонстрационными данными.
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-3">
          <div><ShieldCheck className="h-7 w-7 text-violet-600" /><h3 className="mt-4 font-bold">Оборудование для безопасности</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Подбор камер и комплектующих для наблюдения за объектом.</p></div>
          <div><Camera className="h-7 w-7 text-violet-600" /><h3 className="mt-4 font-bold">Каталог обновляется</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Цены, остатки и карточки товаров управляются в базе магазина.</p></div>
          <div><MonitorCog className="h-7 w-7 text-violet-600" /><h3 className="mt-4 font-bold">Заказ онлайн</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Соберите оборудование в корзине и отправьте заказ на подтверждение.</p></div>
        </div>
      </section>
    </SiteShell>
  );
}
