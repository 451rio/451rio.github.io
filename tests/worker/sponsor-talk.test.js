import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import worker from "../../workers/meetup-api/src/index.js";
import { createEnv, createCtx, jsonRequest, getRequest, stubEmailSending } from "../helpers/worker-env.js";

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
    const digest = createHash("sha256").update(encoder.encode(`${challenge.seed}:${nonce}`)).digest();
    if (leadingZeroBits(digest) >= challenge.difficulty) {
      return { id: challenge.id, nonce };
    }
  }
}

const SPONSOR = {
  company: "Empresa Teste",
  website: "https://empresa.example.com",
  contactName: "Contato Teste",
  role: "Head de Marketing",
  email: "contato@empresa.example.com",
  phone: "2133334444",
  message: "Queremos patrocinar"
};

const TALK = {
  title: "Explorando SSRF em ambientes serverless",
  abstract: "Uma palestra sobre como SSRF se manifesta em funcoes serverless e como mitigar.",
  speakerName: "Palestrante Teste",
  email: "palestrante@example.com",
  phone: "21999998888",
  photoUrl: "https://example.com/foto.jpg",
  bio: "Pesquisadora de seguranca com experiencia em aplicacoes web e nuvem.",
  inPerson: "sim",
  imageConsent: true,
  termsAck: true
};

async function postSponsor(env, ctx, overrides = {}) {
  const captcha = await solveCaptcha(env, ctx);
  return worker.fetch(
    jsonRequest("https://api.test/api/sponsors", {
      ...SPONSOR,
      ...overrides,
      captchaId: captcha.id,
      captcha: captcha.nonce
    }),
    env,
    ctx
  );
}

async function postTalk(env, ctx, overrides = {}) {
  const captcha = await solveCaptcha(env, ctx);
  return worker.fetch(
    jsonRequest("https://api.test/api/talks", {
      ...TALK,
      ...overrides,
      captchaId: captcha.id,
      captcha: captcha.nonce
    }),
    env,
    ctx
  );
}

describe("sponsor requests", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
  });

  afterEach(() => {
    mail.restore();
  });

  it("stores a valid request and notifies the organisation", async () => {
    const response = await postSponsor(env, ctx);
    await ctx.settle();

    expect(response.status).toBe(201);

    const row = env.DB.raw.prepare("SELECT company, email FROM sponsor_requests").get();
    expect(row.company).toBe(SPONSOR.company);
    expect(mail.sent.length).toBe(1);
  });

  it("replies to the company address, not to the notification inbox", async () => {
    await postSponsor(env, ctx);
    await ctx.settle();

    const body = mail.sent[0].body;
    const replyTo = body.reply_to || body.replyTo;
    expect(JSON.stringify(replyTo)).toContain(SPONSOR.email);
  });

  it("refuses a request with no captcha", async () => {
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/sponsors", SPONSOR),
      env,
      ctx
    );

    expect(response.status).toBe(400);
    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM sponsor_requests").get();
    expect(Number(count.total)).toBe(0);
  });

  it("rejects invalid company, contact, email and phone", async () => {
    const cases = [
      { company: "" },
      { company: "a" },
      { contactName: "ab" },
      { email: "nao-e-email" },
      { phone: "123" }
    ];

    for (const override of cases) {
      const response = await postSponsor(env, ctx, override);
      expect(response.status, JSON.stringify(override)).toBe(400);
    }

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM sponsor_requests").get();
    expect(Number(count.total)).toBe(0);
  });

  it("rejects an oversized website field", async () => {
    const response = await postSponsor(env, ctx, { website: `https://x.com/${"a".repeat(400)}` });
    expect(response.status).toBe(400);
  });

  it("keeps the submitted text as data and never as markup in the email", async () => {
    await postSponsor(env, ctx, { company: "<script>alert(1)</script> Corp" });
    await ctx.settle();

    const html = mail.sent[0].body.html || "";
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("talk proposals", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
  });

  afterEach(() => {
    mail.restore();
  });

  it("stores a valid proposal and notifies the organisation", async () => {
    const response = await postTalk(env, ctx);
    await ctx.settle();

    expect(response.status).toBe(201);

    const row = env.DB.raw.prepare("SELECT title, email FROM talk_proposals").get();
    expect(row.title).toBe(TALK.title);
    expect(mail.sent.length).toBe(1);
  });

  it("refuses a photo link that is not http or https", async () => {
    const dangerous = [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "ftp://example.com/foto.jpg",
      "//example.com/foto.jpg"
    ];

    for (const photoUrl of dangerous) {
      const response = await postTalk(env, ctx, { photoUrl });
      expect(response.status, photoUrl).toBe(400);
    }

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM talk_proposals").get();
    expect(Number(count.total)).toBe(0);
  });

  it("requires the photo link to be present", async () => {
    const response = await postTalk(env, ctx, { photoUrl: "" });
    expect(response.status).toBe(400);
  });

  it("requires image consent and terms acknowledgement", async () => {
    const withoutConsent = await postTalk(env, ctx, { imageConsent: false });
    const withoutTerms = await postTalk(env, ctx, { termsAck: false });

    expect(withoutConsent.status).toBe(400);
    expect(withoutTerms.status).toBe(400);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM talk_proposals").get();
    expect(Number(count.total)).toBe(0);
  });

  it("does not accept a truthy string in place of a real consent boolean", async () => {
    const response = await postTalk(env, ctx, { imageConsent: "sim" });
    expect(response.status).toBe(400);
  });

  it("rejects an abstract that is too short or absurdly long", async () => {
    const short = await postTalk(env, ctx, { abstract: "curta" });
    const long = await postTalk(env, ctx, { abstract: "a".repeat(6000) });

    expect(short.status).toBe(400);
    expect(long.status).toBe(400);
  });

  it("accepts a proposal with no phone at all", async () => {
    const response = await postTalk(env, ctx, { phone: "" });
    expect(response.status).toBe(201);
  });

  it("refuses a proposal with no captcha", async () => {
    const response = await worker.fetch(jsonRequest("https://api.test/api/talks", TALK), env, ctx);
    expect(response.status).toBe(400);
  });
});

describe("public forms cannot starve participant email", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
  });

  afterEach(() => {
    mail.restore();
  });

  it("caps sponsor notifications on their own budget", { timeout: 40000 }, async () => {
    env.NOTIFY_EMAIL_DAILY_CAP = "2";

    for (let i = 0; i < 3; i += 1) {
      await postSponsor(env, ctx, { email: `empresa${i}@example.com` });
      await ctx.settle();
    }

    expect(mail.sent.length).toBe(2);
  });

  it("keeps the whole participant budget intact even after a flood of public submissions", { timeout: 40000 }, async () => {
    env.NOTIFY_EMAIL_DAILY_CAP = "1";
    env.DAILY_EMAIL_CAP = "10";

    for (let i = 0; i < 3; i += 1) {
      await postSponsor(env, ctx, { email: `flood${i}@example.com` });
      await ctx.settle();
    }

    const spent = Number(
      env.DB.raw.prepare("SELECT COUNT(*) AS t FROM email_sends WHERE date(sent_at) = date('now')").get().t
    );

    expect(spent).toBe(1);
    expect(10 - spent).toBeGreaterThanOrEqual(9);
  });

  it("still records every submission even when the notification is suppressed", { timeout: 40000 }, async () => {
    env.NOTIFY_EMAIL_DAILY_CAP = "1";

    await postSponsor(env, ctx, { email: "a@example.com" });
    await ctx.settle();
    await postSponsor(env, ctx, { email: "b@example.com" });
    await ctx.settle();

    const rows = Number(env.DB.raw.prepare("SELECT COUNT(*) AS t FROM sponsor_requests").get().t);
    expect(rows).toBe(2);
  });

  it("gives talks their own budget, separate from sponsors", { timeout: 40000 }, async () => {
    env.NOTIFY_EMAIL_DAILY_CAP = "1";

    await postSponsor(env, ctx, { email: "empresa@example.com" });
    await ctx.settle();
    await postTalk(env, ctx, { email: "palestrante@example.com" });
    await ctx.settle();

    expect(mail.sent.length).toBe(2);
  });
});

describe("http hardening", () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
  });

  it("answers CORS preflight without leaking extra methods", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/api/sponsors", {
        method: "OPTIONS",
        headers: { Origin: "https://hackinbrasil.com.br" }
      }),
      env,
      ctx
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET,POST,OPTIONS");
  });

  it("rejects a body that is not a json object", async () => {
    for (const body of ["[1,2,3]", '"apenas texto"', "null", "42"]) {
      const response = await worker.fetch(
        new Request("https://api.test/api/sponsors", {
          method: "POST",
          headers: { "content-type": "application/json", Origin: "https://hackinbrasil.com.br" },
          body
        }),
        env,
        ctx
      );
      expect(response.status, body).toBe(400);
    }
  });

  it("rejects malformed json", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/api/sponsors", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: "https://hackinbrasil.com.br" },
        body: "{ nao e json"
      }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
  });

  it("refuses an oversized payload before parsing it", async () => {
    const response = await worker.fetch(
      new Request("https://api.test/api/sponsors", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: "https://hackinbrasil.com.br" },
        body: JSON.stringify({ company: "a".repeat(64 * 1024) })
      }),
      env,
      ctx
    );
    expect(response.status).toBe(413);
  });

  it("does not accept a GET on a write-only route", async () => {
    const response = await worker.fetch(getRequest("https://api.test/api/sponsors"), env, ctx);
    expect(response.status).toBe(404);
  });
});
