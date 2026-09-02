import { describe, it, expect, beforeEach } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  jsonRequest,
  getRequest,
  seedMeetup,
  seedRegistration,
  seedSession,
  authHeaders
} from "../helpers/worker-env.js";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

async function saveProfile(env, ctx, token, nickname, isPublic = true) {
  return worker.fetch(
    jsonRequest("https://api.test/api/me/profile", { nickname, isPublic }, { headers: authHeaders(token) }),
    env,
    ctx
  );
}

describe("nickname rules", () => {
  let env;
  let ctx;
  let token;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    seedRegistration(env, { email: ALICE });
    token = (await seedSession(env, ALICE)).token;
  });

  it("accepts a normal nickname", async () => {
    const response = await saveProfile(env, ctx, token, "n0ct4mbul4");
    expect(response.status).toBe(200);
    expect((await response.json()).profile.nickname).toBe("n0ct4mbul4");
  });

  it("rejects nicknames that impersonate the organisation", async () => {
    const reserved = [
      "hackinbrasil",
      "Hack In Brasil",
      "admin",
      "ADMIN",
      "organizador",
      "staff",
      "oficial",
      "moderador",
      "hack in brasil oficial"
    ];

    for (const nickname of reserved) {
      const response = await saveProfile(env, ctx, token, nickname);
      expect(response.status, nickname).toBe(400);
    }
  });

  it("still allows legitimate nicknames that merely contain a reserved word inside another word", async () => {
    for (const nickname of ["Gustaff", "adminstrador", "staffordshire"]) {
      const response = await saveProfile(env, ctx, token, nickname);
      expect(response.status, nickname).toBe(200);
    }
  });

  it("rejects a nickname that is too short instead of padding it", async () => {
    const response = await saveProfile(env, ctx, token, "ab");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/curto/i);
  });

  it("rejects a nickname that is too long instead of truncating it", async () => {
    const long = "a".repeat(40);
    const response = await saveProfile(env, ctx, token, long);
    expect(response.status).toBe(400);

    const stored = env.DB.raw.prepare("SELECT nickname FROM participant_profiles WHERE email = ?").get(ALICE);
    expect(stored).toBeUndefined();
  });

  it("rejects direction overrides and null bytes", async () => {
    const dangerous = [
      `evil${String.fromCharCode(0x202e)}name`,
      `null${String.fromCharCode(0)}byte`,
      "emoji 🦆 aqui",
      "-comeca com traco",
      "termina com ponto."
    ];

    for (const nickname of dangerous) {
      const response = await saveProfile(env, ctx, token, nickname);
      expect(response.status, JSON.stringify(nickname)).toBe(400);
    }
  });

  it("collapses a newline into a plain space instead of storing it", async () => {
    const response = await saveProfile(env, ctx, token, `linha${String.fromCharCode(10)}quebrada`);
    expect(response.status).toBe(200);

    const stored = env.DB.raw.prepare("SELECT nickname FROM participant_profiles WHERE email = ?").get(ALICE);
    expect(stored.nickname).toBe("linha quebrada");
  });

  it("refuses a nickname already taken by someone else, ignoring case and accents", async () => {
    await saveProfile(env, ctx, token, "Corvo Azul");

    seedRegistration(env, { email: BOB, name: "Bob" });
    const bobToken = (await seedSession(env, BOB)).token;

    for (const attempt of ["corvo azul", "CORVO AZUL", "Córvo Azul"]) {
      const response = await saveProfile(env, ctx, bobToken, attempt);
      expect(response.status, attempt).toBe(409);
    }
  });

  it("lets the same person keep their own nickname", async () => {
    await saveProfile(env, ctx, token, "Corvo Azul");
    const again = await saveProfile(env, ctx, token, "Corvo Azul", false);
    expect(again.status).toBe(200);
  });

  it("requires a session", async () => {
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/me/profile", { nickname: "qualquer", isPublic: true }),
      env,
      ctx
    );
    expect(response.status).toBe(401);
  });
});

describe("public ranking", () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env, {
      slug: "meetup-passado",
      title: "Meetup Passado",
      event_date: "2020-01-10T19:00:00"
    });
    seedMeetup(env, {
      slug: "meetup-futuro",
      title: "Meetup Futuro",
      event_date: "2090-01-10T19:00:00"
    });
  });

  function makePublicProfile(email, nickname, isPublic = 1) {
    env.DB.raw
      .prepare("INSERT INTO participant_profiles (email, nickname, nickname_key, is_public) VALUES (?, ?, ?, ?)")
      .run(email, nickname, nickname.toLowerCase(), isPublic);
  }

  it("shows only nickname and xp, never the email", async () => {
    makePublicProfile(ALICE, "Corvo");
    seedRegistration(env, { meetup_slug: "meetup-passado", email: ALICE });

    const response = await worker.fetch(getRequest("https://api.test/api/ranking"), env, ctx);
    const raw = await response.text();

    expect(raw).not.toContain(ALICE);
    expect(raw).toContain("Corvo");
  });

  it("keeps private profiles out of the ranking", async () => {
    makePublicProfile(ALICE, "Publico", 1);
    makePublicProfile(BOB, "Privado", 0);
    seedRegistration(env, { meetup_slug: "meetup-passado", email: ALICE });
    seedRegistration(env, { meetup_slug: "meetup-passado", email: BOB });

    const response = await worker.fetch(getRequest("https://api.test/api/ranking"), env, ctx);
    const body = await response.json();

    expect(body.ranking.map((row) => row.nickname)).toEqual(["Publico"]);
  });

  it("does not score meetups that have not happened yet", async () => {
    makePublicProfile(ALICE, "SoFuturo");
    seedRegistration(env, { meetup_slug: "meetup-futuro", email: ALICE });

    const response = await worker.fetch(getRequest("https://api.test/api/ranking"), env, ctx);
    const body = await response.json();

    expect(body.ranking[0].nickname).toBe("SoFuturo");
    expect(body.ranking[0].xp).toBe(0);
  });

  it("scores a meetup that already ended", async () => {
    makePublicProfile(ALICE, "JaFoi");
    seedRegistration(env, { meetup_slug: "meetup-passado", email: ALICE });

    const response = await worker.fetch(getRequest("https://api.test/api/ranking"), env, ctx);
    const body = await response.json();

    expect(body.ranking[0].xp).toBeGreaterThan(0);
  });

  it("orders by xp descending", async () => {
    makePublicProfile(ALICE, "Dois");
    makePublicProfile(BOB, "Um");
    seedRegistration(env, { meetup_slug: "meetup-passado", email: ALICE });
    seedMeetup(env, { slug: "outro-passado", title: "Outro", event_date: "2020-02-10T19:00:00" });
    seedRegistration(env, { meetup_slug: "meetup-passado", email: BOB });
    seedRegistration(env, { meetup_slug: "outro-passado", email: BOB });

    const response = await worker.fetch(getRequest("https://api.test/api/ranking"), env, ctx);
    const body = await response.json();

    expect(body.ranking[0].nickname).toBe("Um");
    expect(body.ranking[0].xp).toBeGreaterThan(body.ranking[1].xp);
  });
});

describe("logout", () => {
  it("revokes the session so it cannot be reused", async () => {
    const env = createEnv();
    const ctx = createCtx();
    seedMeetup(env);
    seedRegistration(env, { email: ALICE });
    const { token } = await seedSession(env, ALICE);

    const before = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );
    expect(before.status).toBe(200);

    await worker.fetch(
      jsonRequest("https://api.test/api/auth/logout", {}, { headers: authHeaders(token) }),
      env,
      ctx
    );

    const after = await worker.fetch(
      getRequest("https://api.test/api/me/registrations", { headers: authHeaders(token) }),
      env,
      ctx
    );
    expect(after.status).toBe(401);
  });
});
