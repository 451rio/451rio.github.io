import { describe, it, expect, beforeEach, afterEach } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import { buildCertificatePdf, bytesToBase64Pdf } from "../../workers/meetup-api/src/pdf.js";
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
const PAST_SLUG = "meetup-passado";

async function issue(env, ctx, token, slug = PAST_SLUG) {
  return worker.fetch(
    jsonRequest(`https://api.test/api/me/registrations/${slug}/certificate`, {}, {
      headers: authHeaders(token)
    }),
    env,
    ctx
  );
}

describe("certificate issuing", () => {
  let env;
  let ctx;
  let mail;
  let token;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    seedMeetup(env, { slug: PAST_SLUG, title: "Meetup Passado", event_date: "2020-01-10T19:00:00" });
    token = (await seedSession(env, ALICE)).token;
  });

  afterEach(() => {
    mail.restore();
  });

  it("refuses to issue for someone with no registration on that meetup", async () => {
    seedRegistration(env, {
      meetup_slug: PAST_SLUG,
      email: BOB,
      checked_in_at: "2020-01-10 20:00:00"
    });

    const response = await issue(env, ctx, token);
    expect(response.status).toBe(404);
  });

  it("refuses to issue for someone who never checked in", async () => {
    seedRegistration(env, { meetup_slug: PAST_SLUG, email: ALICE, checked_in_at: null });

    const response = await issue(env, ctx, token);
    expect(response.status).toBe(409);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM certificates").get();
    expect(Number(count.total)).toBe(0);
  });

  it("refuses to issue before the meetup has ended plus the waiting window", async () => {
    seedMeetup(env, { slug: "meetup-futuro", title: "Futuro", event_date: "2090-01-10T19:00:00" });
    seedRegistration(env, {
      meetup_slug: "meetup-futuro",
      email: ALICE,
      checked_in_at: "2090-01-10 20:00:00"
    });

    const response = await issue(env, ctx, token, "meetup-futuro");
    expect(response.status).toBe(409);
    expect((await response.json()).availableAt).toBeTruthy();
  });

  it("issues once and keeps returning the very same code", async () => {
    seedRegistration(env, {
      meetup_slug: PAST_SLUG,
      email: ALICE,
      checked_in_at: "2020-01-10 20:00:00"
    });

    const first = await issue(env, ctx, token);
    const second = await issue(env, ctx, token);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstCode = (await first.json()).code;
    const secondCode = (await second.json()).code;

    expect(firstCode).toMatch(/^HIB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(secondCode).toBe(firstCode);

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM certificates").get();
    expect(Number(count.total)).toBe(1);
  });

  it("freezes the participant name at issue time", async () => {
    seedRegistration(env, {
      meetup_slug: PAST_SLUG,
      email: ALICE,
      name: "Nome Original",
      checked_in_at: "2020-01-10 20:00:00"
    });

    await issue(env, ctx, token);
    env.DB.raw.prepare("UPDATE registrations SET name = ? WHERE email = ?").run("Nome Trocado", ALICE);

    const stored = env.DB.raw.prepare("SELECT participant_name FROM certificates").get();
    expect(stored.participant_name).toBe("Nome Original");
  });

  it("requires a session", async () => {
    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${PAST_SLUG}/certificate`, {}),
      env,
      ctx
    );
    expect(response.status).toBe(401);
  });
});

describe("public certificate lookup", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    seedMeetup(env, { slug: PAST_SLUG, title: "Meetup Passado", event_date: "2020-01-10T19:00:00" });
    seedRegistration(env, {
      meetup_slug: PAST_SLUG,
      email: ALICE,
      name: "Alice Secreta",
      checked_in_at: "2020-01-10 20:00:00"
    });
  });

  afterEach(() => {
    mail.restore();
  });

  it("confirms a real certificate without ever revealing the name", async () => {
    const { token } = await seedSession(env, ALICE);
    const issued = await issue(env, ctx, token);
    const code = (await issued.json()).code;

    const response = await worker.fetch(
      getRequest(`https://api.test/api/certificates/${code}`),
      env,
      ctx
    );
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(raw).toContain("Meetup Passado");
    expect(raw).not.toContain("Alice");
    expect(raw).not.toContain(ALICE);
  });

  it("is case insensitive on the code", async () => {
    const { token } = await seedSession(env, ALICE);
    const issued = await issue(env, ctx, token);
    const code = (await issued.json()).code;

    const response = await worker.fetch(
      getRequest(`https://api.test/api/certificates/${code.toLowerCase()}`),
      env,
      ctx
    );
    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown but well-formed code", async () => {
    const response = await worker.fetch(
      getRequest("https://api.test/api/certificates/HIB-ZZZZ-ZZZZ-ZZZZ"),
      env,
      ctx
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for a malformed code without touching anything", async () => {
    for (const code of ["HIB-1", "AAAAAAAAAAAA", "HIB-AAAA-AAAA-AAA"]) {
      const response = await worker.fetch(
        getRequest(`https://api.test/api/certificates/${code}`),
        env,
        ctx
      );
      expect(response.status, code).toBe(404);
    }
  });
});

describe("certificate pdf builder", () => {
  const sample = {
    participantName: "Fulano de Tal",
    participationSentence: "participou do evento Hack in Brasil, realizado em 10 de janeiro de 2020.",
    issuedSentence: "Emitido em Rio de Janeiro, Brasil, 10/01/2020.",
    code: "HIB-ABCD-EFGH-JKLM"
  };

  it("produces a structurally valid pdf", () => {
    const bytes = buildCertificatePdf(sample);
    const head = new TextDecoder().decode(bytes.slice(0, 8));
    const tail = new TextDecoder().decode(bytes.slice(-32));

    expect(head.startsWith("%PDF-")).toBe(true);
    expect(tail).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("carries the participant name into the document", () => {
    const bytes = buildCertificatePdf(sample);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("Fulano de Tal");
    expect(text).toContain("HIB-ABCD-EFGH-JKLM");
  });

  it("survives accented names", () => {
    const bytes = buildCertificatePdf({ ...sample, participantName: "Conceição João Ártemis" });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("encodes to base64 for the email attachment", () => {
    const base64 = bytesToBase64Pdf(buildCertificatePdf(sample));
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });
});
