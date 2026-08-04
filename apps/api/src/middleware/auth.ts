import type { Context, Next } from "hono";
import { validateToken } from "../services/auth.js";

export type AuthVars = {
  username: string;
};

/**
 * Every `/api/v1/*` route except the health check needs the API token.
 *
 * Bearer header only — no cookie fallback. A cookie is sent automatically by
 * the browser, which is exactly what makes CSRF possible; an explicit header
 * cannot be forged by another site.
 */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  const result = validateToken(token);
  if (!result.valid) {
    return c.json(
      {
        error: "Unauthorized",
        hint: "Send Authorization: Bearer <API_TOKEN> — the value of API_TOKEN in the Life OS .env",
      },
      401,
    );
  }
  c.set("username", result.username);
  await next();
}
