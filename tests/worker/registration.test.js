import { describe, it, expect, beforeEach, afterEach } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  jsonRequest,
  getRequest,
  seedMeetup,
  stubEmailSending
} from "../helpers/worker-env.js";

const SLUG = "meetup-teste";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((byte >> bit) & 1) return count;
      count += 1;
    }
  }
  return count;
}

async function solveCaptcha(env, ctx) {
  const issued = await worker.fetch(getRequest("https://api.test/api/captcha"), env, ctx);
  const challenge = await issued.json();
  const encoder = new TextEncoder();

  for (let nonce = 0; ; nonce += 1) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${challenge.seed}:${nonce}`));
    if (leadingZeroBits(new Uint8Array(digest)) >= challenge.difficulty) {
      await sleep(1100);
      return { id: challenge.id, nonce };
    }
  }
}

const VALID = {
  name: "Fulano de Tal",
  email: "fulano@example.com",
  phone: "21999998888",
  document: "39053344705",
  consentLgpd: true
};

async function register(env, ctx, overrides = {}, slug = SLUG) {
  const captcha = await solveCaptcha(env, ctx);
  return worker.fetch(
    jsonRequest(`https://api.test/api/meetups/${slug}/register`, {
      ...VALID,
      ...overrides,
      captchaId: captcha.id,
      captcha: captcha.nonce
    }),
    env,
    ctx
  );
}

describe("registration validation", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    seedMeetup(env);
  });

  afterEach(() => {
    mail.restore();
  });

  it("accepts a valid registration and encrypts the personal fields", async () => {
    const response = await register(env, ctx);
    expect(response.status).toBe(201);

    const row = env.DB.raw
      .prepare("SELECT name, email, document_encrypted, document_last4, phone_encrypted FROM registrations")
      .get();

    expect(row.name).toBe(VALID.name);
    expect(row.document_encrypted).not.toContain("39053344705");
    expect(row.phone_encrypted).not.toContain("999998888");
    expect(row.document_last4).toBe("4705");
  });

  it("counts the seat exactly once", async () => {
    await register(env, ctx);
    const meetup = env.DB.raw.prepare("SELECT registrations_count FROM meetups WHERE slug = ?").get(SLUG);
    expect(Number(meetup.registrations_count)).toBe(1);
  });

  it("rejects a CPF that fails its check digits", async () => {
    const response = await register(env, ctx, { document: "12345678900" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("CPF");
  });

  it("rejects a CPF made of repeated digits", async () => {
    const response = await register(env, ctx, { document: "11111111111" });
    expect(response.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const response = await register(env, ctx, { email: "fulano@@example" });
    expect(response.status).toBe(400);
  });

  it("rejects a phone that is not a Brazilian mobile", async () => {
    const response = await register(env, ctx, { phone: "2133334444" });
    expect(response.status).toBe(400);
  });

  it("rejects a name that is too short", async () => {
    const response = await register(env, ctx, { name: "Ab" });
    expect(response.status).toBe(400);
  });

  it("refuses to register without LGPD consent", async () => {
    const response = await register(env, ctx, { consentLgpd: false });
    expect(response.status).toBe(400);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(count.total)).toBe(0);
  });

  it("refuses a registration with no captcha", async () => {
    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/meetups/${SLUG}/register`, VALID),
      env,
      ctx
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 for a meetup that does not exist", async () => {
    const response = await register(env, ctx, {}, "meetup-inexistente");
    expect(response.status).toBe(404);
  });

  it("answers a duplicate registration exactly like a fresh one, so the endpoint cannot be used to probe who is registered", async () => {
    const first = await register(env, ctx);
    const second = await register(env, ctx);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.text()).toContain("sucesso");
  });

  it("stores a duplicate registration only once and never burns a second seat", async () => {
    await register(env, ctx);
    await register(env, ctx);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    const meetup = env.DB.raw.prepare("SELECT registrations_count FROM meetups WHERE slug = ?").get(SLUG);

    expect(Number(count.total)).toBe(1);
    expect(Number(meetup.registrations_count)).toBe(1);
  });

  it("refuses a second registration that reuses the same CPF under another email", async () => {
    await register(env, ctx);
    const response = await register(env, ctx, { email: "outro@example.com" });

    expect(response.status).toBe(201);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(count.total)).toBe(1);
  });

  it("enforces capacity on the server even when the counter is already at the limit", async () => {
    env.DB.raw.prepare("UPDATE meetups SET capacity = 1, registrations_count = 1 WHERE slug = ?").run(SLUG);

    const response = await register(env, ctx);
    expect(response.status).toBe(409);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(count.total)).toBe(0);
  });

  it("refuses registrations on a closed meetup", async () => {
    env.DB.raw.prepare("UPDATE meetups SET is_open = 0 WHERE slug = ?").run(SLUG);

    const response = await register(env, ctx);
    expect(response.status).toBe(409);
  });

  it("never echoes the CPF back in the response", async () => {
    const response = await register(env, ctx);
    const raw = await response.text();
    expect(raw).not.toContain("39053344705");
  });
});

describe("meetup status endpoint", () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
  });

  it("reports availability without revealing seat counts", async () => {
    env.DB.raw.prepare("UPDATE meetups SET capacity = 50, registrations_count = 37 WHERE slug = ?").run(SLUG);

    const response = await worker.fetch(getRequest(`https://api.test/api/meetups/${SLUG}/status`), env, ctx);
    const body = await response.json();

    expect(body.isOpen).toBe(true);
    expect(body.isFull).toBe(false);
    expect(JSON.stringify(body)).not.toContain("37");
    expect(JSON.stringify(body)).not.toContain("50");
  });

  it("reports a full meetup as full", async () => {
    env.DB.raw.prepare("UPDATE meetups SET capacity = 10, registrations_count = 10 WHERE slug = ?").run(SLUG);

    const response = await worker.fetch(getRequest(`https://api.test/api/meetups/${SLUG}/status`), env, ctx);
    expect((await response.json()).isFull).toBe(true);
  });

  it("returns 404 for an unknown meetup", async () => {
    const response = await worker.fetch(
      getRequest("https://api.test/api/meetups/nao-existe/status"),
      env,
      ctx
    );
    expect(response.status).toBe(404);
  });
});
