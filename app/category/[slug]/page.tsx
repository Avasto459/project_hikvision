import { notFound, redirect } from "next/navigation";
import { getCategoryBySlug } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Старые ссылки /category/<slug> ведут в каталог: главная категория покажет плитки подкатегорий,
 * подкатегория — свои товары, с хлебными крошками.
 */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  redirect(`/catalog?category=${encodeURIComponent(category.slug)}`);
}
