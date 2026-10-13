"use client";

import Link from "next/link";
import Image from "next/image";
import { ClipboardList, Heart, House, Inbox, LayoutDashboard, Menu, Package, Plus, ShoppingBag, ShoppingCart, User, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchBox } from "@/components/search-box";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCart } from "@/components/store-provider";
import { MyMessagesWidget } from "@/components/my-messages-widget";

const navLinks = [
  { label: "Главная", href: "/" },
  { label: "Каталог", href: "/catalog" },
  { label: "О компании", href: "/about" },
  { label: "Контакты", href: "/contact" },
];

const mobileNavigation = [
  { label: "Главная", href: "/", icon: House },
  { label: "Каталог", href: "/catalog", icon: Package },
  { label: "Корзина", href: "/cart", icon: ShoppingCart },
  { label: "Избранное", href: "/favorites", icon: Heart },
  { label: "Профиль", href: "/account", icon: User },
];

/** Меню дилера: вместо каталога/корзины/поиска — рабочие разделы кабинета. */
const partnerNavigation = [
  { kind: "dash", label: "Кабинет", icon: LayoutDashboard },
  { kind: "free", label: "Свободные заявки", icon: Inbox },
  { kind: "mine", label: "Мои заявки", icon: ClipboardList },
  { kind: "new", label: "Создать заказ", icon: Plus },
] as const;
type PartnerAction = (typeof partnerNavigation)[number]["kind"];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string; avatar?: string | null } | null>(null);
  const [contacts, setContacts] = useState({ phone: "(992) 93-333-51-11", address: "Таджикистан, Худжанд" });
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { count, favoriteCount } = useCart();

  useEffect(() => {
    const loadUser = async () => {
      const token = localStorage.getItem("hasi-token");
      if (!token) {
        setUser(null);
        return;
      }
      const response = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        localStorage.removeItem("hasi-token");
        setUser(null);
        window.dispatchEvent(new Event("hasi-auth-changed"));
        return;
      }
      const data = await response.json() as { user: { email: string; role: string; avatar?: string | null } };
      setUser(data.user);
    };
    void loadUser();
    window.addEventListener("hasi-auth-changed", loadUser);
    return () => window.removeEventListener("hasi-auth-changed", loadUser);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { phone?: string; address?: string } | null) => {
        if (data) setContacts((current) => ({ phone: data.phone || current.phone, address: data.address || current.address }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) {
        setMobileOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  const closeMenu = () => setMobileOpen(false);

  // The admin panel is intentionally absent from the storefront: it is reachable
  // only by typing /admin manually and is gated by the server-side role check.
  const visibleLinks = navLinks;

  // Дилеру магазинное меню не нужно: на всех страницах он видит своё меню, а логотип ведёт в кабинет.
  // На страницах /dealer меню дилера показывается сразу, без ожидания загрузки профиля.
  const partnerMode = user?.role === "DEALER" || pathname.startsWith("/dealer");
  const homeHref = partnerMode ? "/dealer/dashboard" : "/";

  function partnerAction(kind: PartnerAction) {
    closeMenu();
    if (pathname === "/dealer/dashboard") {
      // уже в кабинете — просто переключаем вкладку / открываем модалку без перезагрузки
      window.dispatchEvent(new CustomEvent("hasi-dealer-action", { detail: kind }));
      return;
    }
    const query = kind === "free" || kind === "mine" ? `?tab=${kind}` : kind === "new" ? "?new=1" : "";
    router.push(`/dealer/dashboard${query}`);
  }

  return (
    <div className="site-shell min-h-screen bg-slate-100 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href={homeHref} aria-label="HASI — High-tech Automation & Security International" className="flex shrink-0 items-center rounded-xl bg-white px-2 py-1 ring-1 ring-slate-200 dark:ring-slate-700" onClick={closeMenu}>
            <Image src="/hasi-logo.png" alt="HASI — High-tech Automation & Security International" width={600} height={370} priority className="h-8 w-auto sm:h-10" />
          </Link>

          {partnerMode ? (
            <nav aria-label="Меню дилера" className="hidden flex-1 items-center gap-2 text-sm font-semibold lg:flex">
              {partnerNavigation.map(({ kind, label, icon: Icon }) => (
                <button key={kind} type="button" onClick={() => partnerAction(kind)}
                  className={kind === "new"
                    ? "ml-auto inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-white transition hover:bg-emerald-500"
                    : "inline-flex items-center gap-2 rounded-full px-4 py-2 text-slate-600 transition hover:bg-violet-50 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </nav>
          ) : (
            <>
              <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex dark:text-slate-300">
                {visibleLinks.map((link) => <Link key={link.href} href={link.href} className="transition hover:text-violet-600 dark:hover:text-violet-300">{link.label}</Link>)}
              </nav>

              <div className="hidden flex-1 justify-center lg:flex">
                <SearchBox />
              </div>
            </>
          )}

          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {!partnerMode ? (
              <>
            <Link href="/favorites" aria-label={`Избранное, товаров: ${favoriteCount}`} className="relative hidden h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-rose-300 hover:text-rose-600 sm:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <Heart className="h-4 w-4" />
              {favoriteCount > 0 ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{favoriteCount}</span> : null}
            </Link>
            <Link href="/cart" aria-label={`Корзина, товаров: ${count}`} className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-violet-300 hover:text-violet-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <ShoppingBag className="h-4 w-4" />
              {count > 0 ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">{count}</span> : null}
            </Link>
              </>
            ) : null}
            <Link href={partnerMode ? "/dealer/dashboard" : user ? "/account" : "/login"} className="hidden items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-600 dark:bg-violet-600 dark:hover:bg-violet-500 sm:inline-flex">
              {user?.avatar ? <Image src={user.avatar} alt="" width={20} height={20} unoptimized className="h-5 w-5 rounded-full object-cover" /> : <User className="h-4 w-4" />}
              {partnerMode ? "Дилер" : user ? "Профиль" : "Войти"}
            </Link>
            <button type="button" onClick={() => setMobileOpen((current) => !current)} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 lg:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {!partnerMode ? (
          <div className="border-t border-slate-100 px-4 py-3 lg:hidden dark:border-slate-800">
            <div className="mx-auto max-w-7xl">
              <SearchBox onSearch={closeMenu} />
            </div>
          </div>
        ) : null}

        {mobileOpen ? (
          <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-4 lg:hidden dark:border-slate-800 dark:bg-slate-950">
            {partnerMode ? (
              <nav aria-label="Меню дилера" className="grid grid-cols-2 gap-2">
                {partnerNavigation.map(({ kind, label, icon: Icon }) => (
                  <button key={kind} type="button" onClick={() => partnerAction(kind)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </nav>
            ) : (
            <nav className="grid grid-cols-2 gap-2">
              {visibleLinks.map((link) => <Link key={link.href} href={link.href} onClick={closeMenu} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">{link.label}</Link>)}
              <Link href="/catalog#categories" onClick={closeMenu} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">Категории</Link>
              <Link href={user ? "/account" : "/login"} onClick={closeMenu} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">{user ? "Личный кабинет" : "Войти"}</Link>
              <Link href="/cart" onClick={closeMenu} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">Корзина ({count})</Link>
              <Link href="/favorites" onClick={closeMenu} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900">Избранное ({favoriteCount})</Link>
            </nav>
            )}
          </div>
        ) : null}
      </header>

      <main className="min-h-[70vh]">{children}</main>

      <footer className="border-t border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <div>
            <div className="mb-3 text-lg font-black text-slate-900 dark:text-white">HASI.TJ</div>
            <p className="text-sm text-slate-600 dark:text-slate-400">Камеры видеонаблюдения и оборудование для систем безопасности.</p>
          </div>
          <div>
            <div className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Каталог</div>
            <Link href="/catalog" className="text-sm text-slate-600 hover:text-violet-600 dark:text-slate-300">Камеры, регистраторы, комплектующие</Link>
          </div>
          <div>
            <div className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Компания</div>
            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <Link href="/about" className="block hover:text-violet-600">О компании</Link>
              <Link href="/contact" className="block hover:text-violet-600">Контакты</Link>
            </div>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <div className="mb-3 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Связаться</div>
            <p>Телефон: {contacts.phone}</p>
            <p className="mt-2">{contacts.address}</p>
          </div>
        </div>
      </footer>

      {partnerMode ? (
      <nav aria-label="Мобильная навигация" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:hidden dark:border-slate-800 dark:bg-slate-950/95">
        {partnerNavigation.map(({ kind, label, icon: Icon }) => (
          <button key={kind} type="button" onClick={() => partnerAction(kind)} className={`relative flex min-w-0 flex-col items-center gap-1 px-1 py-1 text-[10px] font-medium transition ${kind === "new" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 hover:text-violet-700 dark:text-slate-400 dark:hover:text-violet-300"}`}>
            <Icon className="h-5 w-5" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>
      ) : (
      <nav aria-label="Мобильная навигация" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-2 pt-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:hidden dark:border-slate-800 dark:bg-slate-950/95">
        {mobileNavigation.map(({ label, href, icon: Icon }) => {
          const target = label === "Профиль" ? (user ? "/account" : "/login") : href;
          const active = pathname === target
            || (target === "/catalog" && pathname.startsWith("/category/"))
            || (target === "/account" && user && pathname.startsWith("/account"));
          const badge = label === "Корзина" ? count : label === "Избранное" ? favoriteCount : 0;
          return (
            <Link
              key={label}
              href={target}
              aria-label={label === "Корзина" ? `Корзина, товаров: ${count}` : label === "Избранное" ? `Избранное, товаров: ${favoriteCount}` : label}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-w-0 flex-col items-center gap-1 px-1 py-1 text-[10px] font-medium transition ${active ? "text-violet-700 dark:text-violet-300" : "text-slate-500 dark:text-slate-400"}`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge > 0 ? <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[9px] font-bold text-white">{badge}</span> : null}
              </span>
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
      )}
      <MyMessagesWidget />
    </div>
  );
}
