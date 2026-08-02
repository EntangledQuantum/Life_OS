import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { env } from "../env.js";
import { nowIso } from "./helpers.js";

const SESSION_DAYS = 7;

export function login(
  db: LifeOsDb,
  username: string,
  password: string,
): { ok: true; token: string; username: string } | { ok: false; error: string } {
  if (username !== env.adminUser || password !== env.adminPass) {
    return { ok: false, error: "Invalid username or password" };
  }
  const token = nanoid(48);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.insert(schema.authSessions)
    .values({
      id: nanoid(),
      token,
      username,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    })
    .run();
  return { ok: true, token, username };
}

export function logout(db: LifeOsDb, token: string) {
  db.delete(schema.authSessions).where(eq(schema.authSessions.token, token)).run();
  return { ok: true };
}

export function validateToken(
  db: LifeOsDb,
  token: string | undefined | null,
): { valid: true; username: string } | { valid: false } {
  if (!token) return { valid: false };

  // Agent API token
  if (token === env.apiToken) {
    return { valid: true, username: "agent" };
  }

  const session = db
    .select()
    .from(schema.authSessions)
    .where(eq(schema.authSessions.token, token))
    .get();

  if (!session) return { valid: false };
  if (new Date(session.expiresAt) < new Date()) {
    db.delete(schema.authSessions)
      .where(eq(schema.authSessions.token, token))
      .run();
    return { valid: false };
  }
  return { valid: true, username: session.username };
}

export function me(username: string) {
  return {
    username,
    role: username === "agent" ? "agent" : "admin",
    mockAuth: true,
  };
}
