import { describe, it, expect, beforeEach, afterEach } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  jsonRequest,
  getRequest,
  seedMeetup,
  seedRegistration,
  stubEmailSending
} from "../helpers/worker-env.js";

const ADMIN = "admin@hackinbrasil.com.br";
const PARTICIPANT = "pessoa@example.com";
const STRANGER = "ninguem@example.com";

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

async function issueCaptcha(env, ctx) {
  const issued = await worker.fetch(getRequest("https://api.test/api/captcha"), env, ctx);
  return issued.json();
}

async function solveChallenge(challenge) {
  const encoder = new TextEncoder();
  for (let nonce = 0; ; nonce += 1) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${challenge.seed}:${nonce}`));
    if (leadingZeroBits(new Uint8Array(digest)) >= challenge.difficulty) {
      return { id: challenge.id, nonce };
    }
  }
}

async function solveCaptcha(env, ctx) {
  const challenge = await issueCaptcha(env, ctx);
  const solved = await solveChallenge(challenge);
  await sleep(1100);
  return solved;
}

async function requestMagicLink(env, ctx, email) {
  const captcha = await solveCaptcha(env, ctx);
  const response = await worker.fetch(
    jsonRequest("https://api.test/api/auth/magic-link", {
      email,
      captchaId: captcha.id,
      captcha: captcha.nonce
    }),
    env,
    ctx
  );
  await ctx.settle();
  return response;
}

function issuedTokenCount(env, email) {
  const row = env.DB.raw
    .prepare("SELECT COUNT(*) AS total FROM auth_login_requests WHERE email = ? AND token_hash IS NOT NULL")
    .get(email);
  return Number(row.total);
}

describe("magic link authorization", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    seedMeetup(env);
    seedRegistration(env, { email: PARTICIPANT });
  });

  afterEach(() => {
    mail.restore();
  });

  it("issues a token for an address that has registrations", async () => {
    const response = await requestMagicLink(env, ctx, PARTICIPANT);
    expect(response.status).toBe(200);
    expect(issuedTokenCount(env, PARTICIPANT)).toBe(1);
  });

  it("issues a token for an admin address with no registrations at all", async () => {
    const response = await requestMagicLink(env, ctx, ADMIN);
    expect(response.status).toBe(200);
    expect(issuedTokenCount(env, ADMIN)).toBe(1);
  });

  it("issues NO token for an address that is neither a participant nor an admin", async () => {
    const response = await requestMagicLink(env, ctx, STRANGER);
    expect(response.status).toBe(200);
    expect(issuedTokenCount(env, STRANGER)).toBe(0);
    expect(mail.sent.length).toBe(0);
  });

  it("answers with the exact same body whether or not the address exists", async () => {
    const known = await requestMagicLink(env, ctx, PARTICIPANT);
    const unknown = await requestMagicLink(env, ctx, STRANGER);

    expect(await known.text()).toBe(await unknown.text());
    expect(known.status).toBe(unknown.status);
  });

  it("never stores the raw email of an unauthorized address, only its blind index", async () => {
    await requestMagicLink(env, ctx, STRANGER);

    const rows = env.DB.raw.prepare("SELECT email, email_hash FROM auth_login_requests").all();
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe(null);
    expect(typeof rows[0].email_hash).toBe("string");
    expect(rows[0].email_hash.length).toBeGreaterThan(10);
  });

  it("stores only a hash of the token, never the token itself", async () => {
    await requestMagicLink(env, ctx, PARTICIPANT);

    const row = env.DB.raw
      .prepare("SELECT token_hash FROM auth_login_requests WHERE email = ?")
      .get(PARTICIPANT);
    const link = mail.sent[0].body.html || mail.sent[0].body.text || "";

    expect(row.token_hash).toBeTruthy();
    expect(link).not.toContain(row.token_hash);
  });

  it("rate limits repeated attempts for the same address", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await requestMagicLink(env, ctx, PARTICIPANT);
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });

  it("counts unauthorized attempts toward the same rate limit", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await requestMagicLink(env, ctx, STRANGER);
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });

  it("rejects a reused captcha", async () => {
    const captcha = await solveCaptcha(env, ctx);
    const body = { email: PARTICIPANT, captchaId: captcha.id, captcha: captcha.nonce };

    const first = await worker.fetch(jsonRequest("https://api.test/api/auth/magic-link", body), env, ctx);
    const second = await worker.fetch(jsonRequest("https://api.test/api/auth/magic-link", body), env, ctx);
    await ctx.settle();

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });

  it("rejects a captcha solved faster than a human plausibly could", async () => {
    const challenge = await issueCaptcha(env, ctx);
    const solved = await solveChallenge(challenge);

    const response = await worker.fetch(
      jsonRequest("https://api.test/api/auth/magic-link", {
        email: PARTICIPANT,
        captchaId: solved.id,
        captcha: solved.nonce
      }),
      env,
      ctx
    );

    expect(response.status).toBe(400);
    expect(issuedTokenCount(env, PARTICIPANT)).toBe(0);
  });

  it("rejects a wrong proof of work for a valid challenge", async () => {
    const challenge = await issueCaptcha(env, ctx);
    const solved = await solveChallenge(challenge);
    await sleep(1100);

    const response = await worker.fetch(
      jsonRequest("https://api.test/api/auth/magic-link", {
        email: PARTICIPANT,
        captchaId: solved.id,
        captcha: solved.nonce + 1
      }),
      env,
      ctx
    );

    expect(response.status).toBe(400);
    expect(issuedTokenCount(env, PARTICIPANT)).toBe(0);
  });

  it("never reveals the expected answer in the challenge payload", async () => {
    const challenge = await issueCaptcha(env, ctx);
    expect(Object.keys(challenge).sort()).toEqual(["difficulty", "id", "seed"]);
  });

  it("rejects a request with no captcha at all", async () => {
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/auth/magic-link", { email: PARTICIPANT }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
  });

  it("rejects malformed emails before touching the database", async () => {
    const captcha = await solveCaptcha(env, ctx);
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/auth/magic-link", {
        email: "not-an-email",
        captchaId: captcha.id,
        captcha: captcha.nonce
      }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
  });

  it("points the emailed link at the account page", async () => {
    await requestMagicLink(env, ctx, ADMIN);
    const body = mail.sent[0].body;
    const content = `${body.html || ""}${body.text || ""}`;
    expect(content).toContain("/minhas-inscricoes/?token=");
    expect(content).not.toContain("/checkin/");
  });
});

describe("session exchange", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    seedMeetup(env);
    seedRegistration(env, { email: PARTICIPANT });
  });

  afterEach(() => {
    mail.restore();
  });

  it("burns the magic link after a single use", async () => {
    await requestMagicLink(env, ctx, PARTICIPANT);
    const content = `${mail.sent[0].body.html || ""}${mail.sent[0].body.text || ""}`;
    const token = decodeURIComponent(content.match(/token=([A-Za-z0-9_-]+)/)[1]);

    const first = await worker.fetch(
      jsonRequest("https://api.test/api/auth/session", { token }),
      env,
      ctx
    );
    const second = await worker.fetch(
      jsonRequest("https://api.test/api/auth/session", { token }),
      env,
      ctx
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });

  it("rejects an invented token", async () => {
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/auth/session", { token: "made-up-token-value" }),
      env,
      ctx
    );
    expect(response.status).toBe(401);
  });
});
