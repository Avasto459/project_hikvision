import Link from "next/link";

export type Crumb = { label: string; href?: string };

/** Хлебные крошки: Главная → Каталог → Камеры → IP-камеры. Последний элемент — текущая страница. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Хлебные крошки" className="mb-8 text-sm text-slate-500 dark:text-slate-400">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-violet-600 dark:hover:text-violet-300">{item.label}</Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-slate-700 dark:text-slate-200" : undefined}>{item.label}</span>
              )}
              {!last ? <span aria-hidden="true">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
