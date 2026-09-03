import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "..", "..", "workers", "meetup-api", "migrations");

function normalizeBindings(args) {
  return args.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

class D1Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...args) {
    return new D1Statement(this.db, this.sql, normalizeBindings(args));
  }

  first() {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.bindings);
    return Promise.resolve(row === undefined ? null : row);
  }

  all() {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.bindings);
    return Promise.resolve({ results, success: true, meta: {} });
  }

  run() {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.bindings);
    return Promise.resolve({
      success: true,
      meta: {
        changes: Number(info.changes || 0),
        last_row_id: Number(info.lastInsertRowid || 0)
      }
    });
  }
}

export function createTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  const binding = {
    prepare(sql) {
      return new D1Statement(db, sql);
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const statement of statements) {
          out.push(await statement.run());
        }
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    raw: db
  };

  return binding;
}

export function createEnv(overrides = {}) {
  return {
    DB: overrides.DB || createTestDb(),
    ALLOWED_ORIGIN: "https://hackinbrasil.com.br",
    SITE_BASE_URL: "https://hackinbrasil.com.br",
    ADMIN_EMAILS: "admin@hackinbrasil.com.br",
    DOC_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    RESEND_API_KEY: "test-key",
    RESEND_FROM_EMAIL: "no-reply@hackinbrasil.com.br",
    POW_MIN_SOLVE_SECONDS: "0",
    ...overrides
  };
}

export function createCtx() {
  const pending = [];
  const failures = [];

  return {
    waitUntil(promise) {
      pending.push(
        Promise.resolve(promise).catch((error) => {
          failures.push(error);
        })
      );
    },
    async settle() {
      await Promise.all(pending);
    },
    async settleStrict() {
      await Promise.all(pending);
      if (failures.length > 0) {
        throw new Error(`background work failed: ${failures.map((e) => e && e.message).join("; ")}`);
      }
    },
    backgroundFailures() {
      return failures.slice();
    }
  };
}

export function jsonRequest(url, body, options = {}) {
  return new Request(url, {
    method: options.method || "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://hackinbrasil.com.br",
      ...(options.headers || {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export function getRequest(url, options = {}) {
  return new Request(url, {
    method: "GET",
    headers: {
      Origin: "https://hackinbrasil.com.br",
      ...(options.headers || {})
    }
  });
}

export function stubEmailSending() {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    let isResendHost;
    try {
      const { hostname } = new URL(url);
      isResendHost = hostname === "resend.com" || hostname.endsWith(".resend.com");
    } catch {
      isResendHost = false;
    }
    if (isResendHost) {
      sent.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ id: "test-email-id" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected outbound fetch in test: ${url}`);
  };
  return {
    sent,
    restore() {
      globalThis.fetch = original;
    }
  };
}

export function seedMeetup(env, overrides = {}) {
  const meetup = {
    slug: "meetup-teste",
    title: "Meetup de Teste",
    event_date: "2026-09-03T19:00:00",
    capacity: 100,
    registrations_count: 0,
    is_open: 1,
    ...overrides
  };
  env.DB.raw
    .prepare(
      "INSERT INTO meetups (slug, title, event_date, capacity, registrations_count, is_open) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      meetup.slug,
      meetup.title,
      meetup.event_date,
      meetup.capacity,
      meetup.registrations_count,
      meetup.is_open
    );
  return meetup;
}

export function seedRegistration(env, overrides = {}) {
  const registration = {
    meetup_slug: "meetup-teste",
    name: "Pessoa Teste",
    email: "pessoa@example.com",
    phone_encrypted: "enc",
    document_encrypted: "enc",
    document_last4: "0000",
    consent_lgpd: 1,
    checkin_code: null,
    checked_in_at: null,
    ...overrides
  };
  const info = env.DB.raw
    .prepare(
      "INSERT INTO registrations (meetup_slug, name, email, phone_encrypted, document_encrypted, document_last4, consent_lgpd, checkin_code, checked_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      registration.meetup_slug,
      registration.name,
      registration.email,
      registration.phone_encrypted,
      registration.document_encrypted,
      registration.document_last4,
      registration.consent_lgpd,
      registration.checkin_code,
      registration.checked_in_at
    );
  return { ...registration, id: Number(info.lastInsertRowid) };
}

export function makeOpaqueToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function seedSession(env, email, overrides = {}) {
  const token = overrides.token || makeOpaqueToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Buffer.from(new Uint8Array(digest)).toString("base64");
  const expiresAt = overrides.expiresAt || "datetime('now', '+30 minutes')";
  const revoked = overrides.revoked ? 1 : 0;

  env.DB.raw
    .prepare(
      `INSERT INTO auth_sessions (email, token_hash, expires_at, revoked) VALUES (?, ?, ${expiresAt}, ?)`
    )
    .run(email, tokenHash, revoked);

  return { token, tokenHash };
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}
