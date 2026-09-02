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
  authHeaders,
  stubEmailSending
} from "../helpers/worker-env.js";

const ADMIN = "admin@hackinbrasil.com.br";
const ALICE = "alice@example.com";
const SLUG = "meetup-teste";

function drawRequest(token, slug = SLUG) {
  return jsonRequest(`https://api.test/api/admin/meetups/${slug}/duck-race/draw`, {}, {
    headers: authHeaders(token)
  });
}

function resetRequest(token, body, slug = SLUG) {
  return jsonRequest(`https://api.test/api/admin/meetups/${slug}/duck-race/reset`, body, {
    headers: authHeaders(token)
  });
}

describe("reset requires confirmation on the server, not just in the browser", () => {
  let env;
  let ctx;
  let token;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    seedRegistration(env, { email: ALICE, checked_in_at: "2026-09-03 20:00:00" });
    token = (await seedSession(env, ADMIN)).token;
    await worker.fetch(drawRequest(token), env, ctx);
  });

  function winnerCount() {
    return Number(env.DB.raw.prepare("SELECT COUNT(*) AS total FROM raffle_winners").get().total);
  }

  it("refuses a reset with no confirmation at all", async () => {
    const response = await worker.fetch(resetRequest(token, {}), env, ctx);

    expect(response.status).toBe(400);
    expect(winnerCount()).toBe(1);
  });

  it("refuses a reset with the wrong word", async () => {
    const response = await worker.fetch(resetRequest(token, { confirmation: "apagar" }), env, ctx);

    expect(response.status).toBe(400);
    expect(winnerCount()).toBe(1);
  });

  it("accepts the confirmation word in lower case and without accents", async () => {
    const response = await worker.fetch(resetRequest(token, { confirmation: " resetar " }), env, ctx);

    expect(response.status).toBe(200);
    expect(winnerCount()).toBe(0);
  });

  it("still refuses a confirmed reset from a non-admin session", async () => {
    seedRegistration(env, { email: "outro@example.com", name: "Outro" });
    const intruder = await seedSession(env, "outro@example.com");

    const response = await worker.fetch(
      resetRequest(intruder.token, { confirmation: "RESETAR" }),
      env,
      ctx
    );

    expect(response.status).toBe(403);
    expect(winnerCount()).toBe(1);
  });
});

describe("a winner can still delete their own registration", () => {
  let env;
  let ctx;
  let mail;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    seedMeetup(env, { slug: SLUG, title: "Meetup Teste", event_date: "2090-01-10T19:00:00" });
  });

  it("cancels cleanly after the person has won a raffle", async () => {
    seedRegistration(env, { email: ALICE, checked_in_at: "2026-09-03 20:00:00" });

    const admin = await seedSession(env, ADMIN);
    const draw = await worker.fetch(drawRequest(admin.token), env, ctx);
    expect(draw.status).toBe(200);

    const alice = await seedSession(env, ALICE);
    const cancel = await worker.fetch(
      jsonRequest(`https://api.test/api/me/registrations/${SLUG}/cancel`, { confirmation: "CANCELAR" }, {
        headers: authHeaders(alice.token)
      }),
      env,
      ctx
    );

    expect(cancel.status).toBe(200);

    const registrations = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM registrations").get();
    const winners = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM raffle_winners").get();
    const meetup = env.DB.raw.prepare("SELECT registrations_count FROM meetups WHERE slug = ?").get(SLUG);

    expect(Number(registrations.total)).toBe(0);
    expect(Number(winners.total)).toBe(0);
    expect(Number(meetup.registrations_count)).toBe(0);

    mail.restore();
  });
});

describe("concurrent draws cannot hand the same prize twice", () => {
  let env;
  let ctx;
  let token;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    token = (await seedSession(env, ADMIN)).token;
  });

  it("never records the same person twice when draws overlap", async () => {
    seedRegistration(env, { email: "a@example.com", name: "A", checked_in_at: "2026-09-03 20:00:00" });
    seedRegistration(env, { email: "b@example.com", name: "B", checked_in_at: "2026-09-03 20:00:00" });

    const responses = await Promise.all([
      worker.fetch(drawRequest(token), env, ctx),
      worker.fetch(drawRequest(token), env, ctx)
    ]);

    for (const response of responses) {
      expect([200, 409]).toContain(response.status);
      expect(response.status).not.toBe(500);
    }

    const rows = env.DB.raw.prepare("SELECT registration_id FROM raffle_winners").all();
    const unique = new Set(rows.map((row) => row.registration_id));

    expect(unique.size).toBe(rows.length);
  });

  it("does not exceed the eligible pool even under a burst of draws", async () => {
    for (let i = 0; i < 3; i += 1) {
      seedRegistration(env, {
        email: `p${i}@example.com`,
        name: `Pessoa ${i}`,
        checked_in_at: "2026-09-03 20:00:00"
      });
    }

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => worker.fetch(drawRequest(token), env, ctx))
    );

    const ok = responses.filter((response) => response.status === 200);
    const rows = env.DB.raw.prepare("SELECT registration_id FROM raffle_winners").all();

    expect(ok.length).toBeLessThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(new Set(rows.map((row) => row.registration_id)).size).toBe(rows.length);
    expect(responses.every((response) => response.status !== 500)).toBe(true);
  });

  it("never draws a registration that was cancelled between draws", async () => {
    const first = seedRegistration(env, {
      email: "a@example.com",
      name: "A",
      checked_in_at: "2026-09-03 20:00:00"
    });
    seedRegistration(env, { email: "b@example.com", name: "B", checked_in_at: "2026-09-03 20:00:00" });

    env.DB.raw.prepare("DELETE FROM registrations WHERE id = ?").run(first.id);

    const response = await worker.fetch(drawRequest(token), env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.winner.name).toBe("B");
  });
});

describe("draw fairness is enforced by the server", () => {
  it("spreads winners close to uniformly across the field", async () => {
    const env = createEnv();
    const ctx = createCtx();
    seedMeetup(env);
    const token = (await seedSession(env, ADMIN)).token;

    const FIELD = 4;
    const ROUNDS = 400;

    for (let i = 0; i < FIELD; i += 1) {
      seedRegistration(env, {
        email: `p${i}@example.com`,
        name: `Pessoa ${i}`,
        checked_in_at: "2026-09-03 20:00:00"
      });
    }

    const counts = new Map();

    for (let round = 0; round < ROUNDS; round += 1) {
      const response = await worker.fetch(drawRequest(token), env, ctx);
      const { winner } = await response.json();
      counts.set(winner.id, (counts.get(winner.id) || 0) + 1);

      await worker.fetch(resetRequest(token, { confirmation: "RESETAR" }), env, ctx);
    }

    expect(counts.size).toBe(FIELD);

    const expected = ROUNDS / FIELD;
    const chiSquare = Array.from(counts.values()).reduce(
      (total, observed) => total + ((observed - expected) ** 2) / expected,
      0
    );

    expect(chiSquare).toBeLessThan(16.27);
  });
});

describe("state endpoint stays consistent", () => {
  it("reports the winner it just recorded", async () => {
    const env = createEnv();
    const ctx = createCtx();
    seedMeetup(env);
    seedRegistration(env, { email: ALICE, name: "Alice", checked_in_at: "2026-09-03 20:00:00" });
    const token = (await seedSession(env, ADMIN)).token;

    const draw = await worker.fetch(drawRequest(token), env, ctx);
    const { winner } = await draw.json();

    const state = await worker.fetch(
      getRequest(`https://api.test/api/admin/meetups/${SLUG}/duck-race`, { headers: authHeaders(token) }),
      env,
      ctx
    );
    const body = await state.json();

    expect(body.winners.map((row) => row.id)).toEqual([winner.id]);
    expect(body.ducks).toEqual([]);
  });
});
