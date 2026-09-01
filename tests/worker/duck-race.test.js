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

const ADMIN = "admin@hackinbrasil.com.br";
const SLUG = "meetup-teste";

async function draw(env, ctx, token, slug = SLUG) {
  return worker.fetch(
    jsonRequest(`https://api.test/api/admin/meetups/${slug}/duck-race/draw`, {}, {
      headers: authHeaders(token)
    }),
    env,
    ctx
  );
}

async function state(env, ctx, token, slug = SLUG) {
  const response = await worker.fetch(
    getRequest(`https://api.test/api/admin/meetups/${slug}/duck-race`, { headers: authHeaders(token) }),
    env,
    ctx
  );
  return response.json();
}

describe("duck race eligibility and draws", () => {
  let env;
  let ctx;
  let token;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    token = (await seedSession(env, ADMIN)).token;
  });

  it("only lists people who actually checked in", async () => {
    seedRegistration(env, { email: "a@example.com", name: "Com check-in", checked_in_at: "2026-09-03 20:00:00" });
    seedRegistration(env, { email: "b@example.com", name: "Sem check-in", checked_in_at: null });

    const { ducks } = await state(env, ctx, token);
    expect(ducks.map((d) => d.name)).toEqual(["Com check-in"]);
  });

  it("never draws someone who did not check in", async () => {
    seedRegistration(env, { email: "a@example.com", name: "Com check-in", checked_in_at: "2026-09-03 20:00:00" });
    seedRegistration(env, { email: "b@example.com", name: "Sem check-in", checked_in_at: null });

    for (let i = 0; i < 5; i += 1) {
      const response = await draw(env, ctx, token);
      if (response.status === 200) {
        const { winner } = await response.json();
        expect(winner.name).toBe("Com check-in");
      }
    }
  });

  it("removes the winner from the eligible pool", async () => {
    const first = seedRegistration(env, { email: "a@example.com", name: "A", checked_in_at: "2026-09-03 20:00:00" });
    seedRegistration(env, { email: "b@example.com", name: "B", checked_in_at: "2026-09-03 20:00:00" });

    const response = await draw(env, ctx, token);
    const { winner } = await response.json();

    const after = await state(env, ctx, token);
    expect(after.ducks.map((d) => d.id)).not.toContain(winner.id);
    expect(after.ducks.length).toBe(1);
    expect(after.winners.map((w) => w.id)).toEqual([winner.id]);
    expect([first.id]).toBeTruthy();
  });

  it("cannot draw the same person twice across many draws", async () => {
    const total = 6;
    for (let i = 0; i < total; i += 1) {
      seedRegistration(env, {
        email: `p${i}@example.com`,
        name: `Pessoa ${i}`,
        checked_in_at: "2026-09-03 20:00:00"
      });
    }

    const winners = [];
    for (let i = 0; i < total; i += 1) {
      const response = await draw(env, ctx, token);
      expect(response.status).toBe(200);
      winners.push((await response.json()).winner.id);
    }

    expect(new Set(winners).size).toBe(total);

    const exhausted = await draw(env, ctx, token);
    expect(exhausted.status).toBe(409);
  });

  it("returns 409 when nobody checked in", async () => {
    seedRegistration(env, { email: "a@example.com", checked_in_at: null });
    const response = await draw(env, ctx, token);
    expect(response.status).toBe(409);
  });

  it("keeps draws scoped to one meetup", async () => {
    seedMeetup(env, { slug: "outro-meetup", title: "Outro" });
    seedRegistration(env, { email: "a@example.com", name: "Do teste", checked_in_at: "2026-09-03 20:00:00" });
    seedRegistration(env, {
      meetup_slug: "outro-meetup",
      email: "b@example.com",
      name: "Do outro",
      checked_in_at: "2026-09-03 20:00:00"
    });

    const response = await draw(env, ctx, token);
    const { winner } = await response.json();
    expect(winner.name).toBe("Do teste");

    const other = await state(env, ctx, token, "outro-meetup");
    expect(other.winners.length).toBe(0);
    expect(other.ducks.map((d) => d.name)).toEqual(["Do outro"]);
  });

  it("resets only the chosen meetup and makes everyone eligible again", async () => {
    seedMeetup(env, { slug: "outro-meetup", title: "Outro" });
    seedRegistration(env, { email: "a@example.com", name: "A", checked_in_at: "2026-09-03 20:00:00" });
    seedRegistration(env, {
      meetup_slug: "outro-meetup",
      email: "b@example.com",
      name: "B",
      checked_in_at: "2026-09-03 20:00:00"
    });

    await draw(env, ctx, token);
    await draw(env, ctx, token, "outro-meetup");

    const reset = await worker.fetch(
      jsonRequest(`https://api.test/api/admin/meetups/${SLUG}/duck-race/reset`, {}, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );
    expect(reset.status).toBe(200);
    expect((await reset.json()).removed).toBe(1);

    const after = await state(env, ctx, token);
    expect(after.winners.length).toBe(0);
    expect(after.ducks.length).toBe(1);

    const untouched = await state(env, ctx, token, "outro-meetup");
    expect(untouched.winners.length).toBe(1);
  });

  it("spreads winners across the field instead of always picking the same row", async () => {
    for (let i = 0; i < 8; i += 1) {
      seedRegistration(env, {
        email: `p${i}@example.com`,
        name: `Pessoa ${i}`,
        checked_in_at: "2026-09-03 20:00:00"
      });
    }

    const firstPicks = new Set();
    for (let round = 0; round < 24; round += 1) {
      const response = await draw(env, ctx, token);
      firstPicks.add((await response.json()).winner.id);
      await worker.fetch(
        jsonRequest(`https://api.test/api/admin/meetups/${SLUG}/duck-race/reset`, {}, {
          headers: authHeaders(token)
        }),
        env,
        ctx
      );
    }

    expect(firstPicks.size).toBeGreaterThan(1);
  });
});

describe("admin check-in scanning", () => {
  let env;
  let ctx;
  let token;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    token = (await seedSession(env, ADMIN)).token;
  });

  it("confirms a check-in and reports a repeat scan without duplicating it", async () => {
    seedRegistration(env, { email: "a@example.com", name: "Fulano", checkin_code: "chk_abc123" });

    const first = await worker.fetch(
      jsonRequest("https://api.test/api/admin/checkin", { code: "chk_abc123" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );
    const firstBody = await first.json();

    const second = await worker.fetch(
      jsonRequest("https://api.test/api/admin/checkin", { code: "chk_abc123" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.alreadyCheckedIn).toBe(false);
    expect(secondBody.alreadyCheckedIn).toBe(true);
    expect(secondBody.name).toBe("Fulano");
  });

  it("rejects an unknown code", async () => {
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/admin/checkin", { code: "chk_naoexiste" }, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );
    expect(response.status).toBe(404);
  });

  it("rejects an empty code", async () => {
    const response = await worker.fetch(
      jsonRequest("https://api.test/api/admin/checkin", { code: "" }, { headers: authHeaders(token) }),
      env,
      ctx
    );
    expect(response.status).toBe(400);
  });
});
