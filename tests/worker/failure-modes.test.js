import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  getRequest,
  jsonRequest,
  seedMeetup,
  seedRegistration,
  seedSession,
  authHeaders
} from "../helpers/worker-env.js";

const ALICE = "alice@example.com";
const ADMIN = "admin@hackinbrasil.com.br";
const SLUG = "meetup-teste";

function breakDatabase(env, message = "D1_ERROR: database is unavailable") {
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    if (/^\s*SELECT/i.test(sql)) {
      return {
        bind() {
          return this;
        },
        first() {
          return Promise.reject(new Error(message));
        },
        all() {
          return Promise.reject(new Error(message));
        },
        run() {
          return Promise.reject(new Error(message));
        }
      };
    }
    return realPrepare(sql);
  };
}

describe("internal failures stay internal", () => {
  let env;
  let ctx;
  let errorSpy;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns a generic 500 when the database fails, leaking no sql or stack", async () => {
    breakDatabase(env, "D1_ERROR: no such column: secret_column");

    const response = await worker.fetch(
      getRequest(`https://api.test/api/meetups/${SLUG}/status`),
      env,
      ctx
    );
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toContain("secret_column");
    expect(raw).not.toContain("D1_ERROR");
    expect(raw).not.toContain("SELECT");
    expect(raw).toContain("Erro interno");
  });

  it("keeps the ranking failure generic too", async () => {
    breakDatabase(env);

    const response = await worker.fetch(getRequest("https://api.test/api/ranking"), env, ctx);
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toContain("database is unavailable");
  });

  it("does not expose the reason a session lookup failed", async () => {
    const { token } = await seedSession(env, ALICE);
    breakDatabase(env, "D1_ERROR: auth_sessions is corrupt");

    const response = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toContain("auth_sessions");
  });

  it("fails closed on admin routes when the database is down", async () => {
    const { token } = await seedSession(env, ADMIN);
    breakDatabase(env);

    const response = await worker.fetch(
      getRequest("https://api.test/api/admin/meetups", { headers: authHeaders(token) }),
      env,
      ctx
    );

    expect([401, 500]).toContain(response.status);
    expect(response.status).not.toBe(200);
  });

  it("returns a generic error when the encryption secret is missing", async () => {
    const brokenEnv = createEnv({ DB: env.DB, DOC_ENCRYPTION_KEY_BASE64: "" });

    const response = await worker.fetch(
      jsonRequest("https://api.test/api/auth/magic-link", {
        email: ALICE,
        captchaId: "qualquer",
        captcha: 1
      }),
      brokenEnv,
      ctx
    );
    const raw = await response.text();

    expect([400, 500]).toContain(response.status);
    expect(raw).not.toContain("DOC_ENCRYPTION_KEY_BASE64");
  });

  it("still answers with CORS headers on an internal error", async () => {
    breakDatabase(env);

    const response = await worker.fetch(
      getRequest(`https://api.test/api/meetups/${SLUG}/status`),
      env,
      ctx
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://hackinbrasil.com.br");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("degraded but not broken", () => {
  let env;
  let ctx;
  let errorSpy;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("keeps a check-in working even if the email provider is unreachable", async () => {
    seedRegistration(env, { email: ALICE, name: "Alice", checkin_code: "chk_ok" });
    const { token } = await seedSession(env, ADMIN);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network unreachable");
    };

    try {
      const response = await worker.fetch(
        jsonRequest("https://api.test/api/admin/checkin", { code: "chk_ok" }, {
          headers: authHeaders(token)
        }),
        env,
        ctx
      );

      expect(response.status).toBe(200);
      const row = env.DB.raw.prepare("SELECT checked_in_at FROM registrations").get();
      expect(row.checked_in_at).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("survives a cron tick with nothing to do", async () => {
    const cronCtx = createCtx();
    await worker.scheduled({}, env, cronCtx);
    await expect(cronCtx.settle()).resolves.not.toThrow();
  });
});
