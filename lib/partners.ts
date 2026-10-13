import { db } from "@/lib/db/client";
import { initializeSchema } from "@/lib/db/schema";

export type AccountUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  isBlocked: boolean;
  createdAt: string;
};

export async function getAccountById(id: string): Promise<AccountUser | null> {
  await initializeSchema();
  const r = await db.execute({ sql: "SELECT * FROM users WHERE id=? LIMIT 1", args: [id] });
  const u = r.rows[0];
  if (!u) return null;
  return {
    id: String(u.id),
    name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
    email: String(u.email),
    phone: String(u.phone ?? ""),
    role: String(u.role),
    status: String(u.status ?? "active"),
    isBlocked: Boolean(Number(u.isBlocked ?? 0)),
    createdAt: String(u.createdAt),
  };
}
