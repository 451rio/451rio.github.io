import { describe, it, expect, beforeEach, afterEach } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  jsonRequest,
  getRequest,
  seedMeetup,
  seedRegistration,
  seedSession,
  authHeaders,
  stubEmailSending
} from "../helpers/worker-env.js";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const SLUG = "meetup-teste";

describe("participant data isolation", () => {
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

  it("only returns the registrations of the session's own email", async () => {
    seedRegistration(env, { email: ALICE, name: "Alice" });
    seedRegistration(env, { email: BOB, name: "Bob" });

    const { token } = await seedSession(env, ALICE);
    const response = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );
    const body = await response.json();

    expect(body.email).toBe(ALICE);
    expect(body.registrations.length).toBe(1);
    expect(body.registrations[0].name).toBe("Alice");
  });

  it("never exposes the CPF, phone or check-in code of a registration", async () => {
    seedRegistration(env, { email: ALICE, checkin_code: "chk_secret" });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );
    const raw = await response.text();

    expect(raw).not.toContain("document_encrypted");
    expect(raw).not.toContain("phone_encrypted");
    expect(raw).not.toContain("chk_secret");
  });

  it("works for an admin account that has no registrations at all", async () => {
    const { token } = await seedSession(env, "admin@hackinbrasil.com.br");

    const response = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.registrations).toEqual([]);
    expect(body.profile.xp).toBe(0);
  });

  it("refuses to cancel a registration that belongs to someone else", async () => {
    seedRegistration(env, { email: BOB, name: "Bob" });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${SLUG}/cancel`, { confirmation: "CANCELAR" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    expect(response.status).toBe(404);
    const remaining = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(remaining.total)).toBe(1);
  });

  it("refuses to cancel without the exact confirmation word", async () => {
    seedRegistration(env, { email: ALICE });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${SLUG}/cancel`, { confirmation: "sim" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    expect(response.status).toBe(400);
    const remaining = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(remaining.total)).toBe(1);
  });

  it("accepts the confirmation word in lower case and without accents", async () => {
    seedRegistration(env, { email: ALICE });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${SLUG}/cancel`, { confirmation: " cancelar " }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    expect(response.status).toBe(200);
    const remaining = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(remaining.total)).toBe(0);
  });

  it("cancels cleanly when the registration still has a queued email, instead of reporting 404 and leaking the seat", async () => {
    const registration = seedRegistration(env, { email: ALICE });
    env.DB.raw
      .prepare(
        `INSERT INTO email_jobs (kind, meetup_slug, registration_id, recipient_name, recipient_email, subject, text_body, html_body, send_after, status)
         VALUES ('confirmation', ?, ?, 'Alice', ?, 'Assunto', 'corpo', '<p>corpo</p>', datetime('now', '+10 minutes'), 'pending')`
      )
      .run(SLUG, registration.id, ALICE);

    const { token } = await seedSession(env, ALICE);
    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${SLUG}/cancel`, { confirmation: "CANCELAR" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    expect(response.status).toBe(200);

    const registrations = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    const jobs = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM email_jobs").get();
    const meetup = env.DB.raw.prepare("SELECT registrations_count FROM meetups WHERE slug = ?").get(SLUG);

    expect(Number(registrations.total)).toBe(0);
    expect(Number(jobs.total)).toBe(0);
    expect(Number(meetup.registrations_count)).toBe(0);
  });

  it("leaves an already finished meetup alone", async () => {
    seedMeetup(env, { slug: "ja-aconteceu", title: "Passado", event_date: "2020-01-10T19:00:00" });
    seedRegistration(env, { meetup_slug: "ja-aconteceu", email: ALICE });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      jsonRequest("https://api.test/api/me/registrations/ja-aconteceu/cancel", { confirmation: "CANCELAR" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    expect(response.status).toBe(409);
    const remaining = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    expect(Number(remaining.total)).toBe(1);
  });

  it("recomputes the seat counter instead of blindly decrementing it", async () => {
    env.DB.raw.prepare("UPDATE meetups SET registrations_count = 5 WHERE slug = ?").run(SLUG);
    seedRegistration(env, { email: ALICE });
    const { token } = await seedSession(env, ALICE);

    await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${SLUG}/cancel`, { confirmation: "CANCELAR" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    const meetup = env.DB.raw.prepare("SELECT registrations_count FROM meetups WHERE slug = ?").get(SLUG);
    expect(Number(meetup.registrations_count)).toBe(0);
  });

  it("gives a check-in code only for the session's own registration", async () => {
    seedRegistration(env, { email: BOB });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      getRequest(`https://api.test/api/me/registrations/${SLUG}/checkin-code`, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    expect(response.status).toBe(404);
  });

  it("keeps handing back the same check-in code on repeated calls", async () => {
    seedRegistration(env, { email: ALICE });
    const { token } = await seedSession(env, ALICE);

    const first = await worker.fetch(
      getRequest(`https://api.test/api/me/registrations/${SLUG}/checkin-code`, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );
    const second = await worker.fetch(
      getRequest(`https://api.test/api/me/registrations/${SLUG}/checkin-code`, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

    const firstCode = (await first.json()).code;
    const secondCode = (await second.json()).code;

    expect(firstCode).toBeTruthy();
    expect(secondCode).toBe(firstCode);
  });
});

describe("public endpoints", () => {
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

  it("never leaks personal data through the meetup status endpoint", async () => {
    seedRegistration(env, { email: ALICE, name: "Alice Secreta" });

    const response = await worker.fetch(
      getRequest(`https://api.test/api/meetups/${SLUG}/status`),
      env,
      ctx
    );
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(raw).not.toContain("Alice");
    expect(raw).not.toContain(ALICE);
  });

  it("returns 404 for an unknown certificate code without hinting at anything", async () => {
    const response = await worker.fetch(
      getRequest("https://api.test/api/certificates/HIB-AAAA-BBBB-CCCC"),
      env,
      ctx
    );
    expect(response.status).toBe(404);
  });

  it("sends no-store on responses that carry personal data", async () => {
    seedRegistration(env, { email: ALICE });
    const { token } = await seedSession(env, ALICE);

    const response = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("does not reflect an arbitrary Origin back in CORS headers", async () => {
    const response = await worker.fetch(
      new Request(`https://api.test/api/meetups/${SLUG}/status`, {
        headers: { Origin: "https://evil.example.com" }
      }),
      env,
      ctx
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://hackinbrasil.com.br");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(getRequest("https://api.test/api/nao-existe"), env, ctx);
    expect(response.status).toBe(404);
  });
});
