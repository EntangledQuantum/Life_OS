import type { Context, Next } from "hono";
import { getDb } from "@life-os/db";
import { validateToken } from "../services/auth.js";

export type AuthVars = {
  username: string;
};

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  const bearer = header?.startsWith("Bearer ")
    ? header.slice(7)
    : null;
  const cookie = parseCookie(c.req.header("cookie") ?? "", "lifeos_token");
  const token = bearer || cookie;

  const result = validateToken(getDb(), token);
  if (!result.valid) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("username", result.username);
  await next();
}

function parseCookie(cookie: string, name: string): string | null {
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
