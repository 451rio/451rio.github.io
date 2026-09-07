import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  jsonRequest,
  getRequest,
  seedMeetup,
  seedSession,
  authHeaders
} from "../helpers/worker-env.js";

const ADMIN = "admin@hackinbrasil.com.br";
const USER = "user@example.com";
const SLUG = "meetup-teste";

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

const ANSWERS = {
  preEventCommunication: 5,
  organization: 4,
  venue: 5,
  techInfrastructure: 3,
  talks: 5,
  coffeeBreak: 2,
  rafflePrizes: 4,
  networking: 5,
  overallExperience: 5,
  expectations: 4,
  recommendation: 5
};

async function postSurvey(env, ctx, overrides = {}, slug = SLUG) {
  const captcha = await solveCaptcha(env, ctx);
  return worker.fetch(
    jsonRequest(`https://api.test/api/meetups/${slug}/survey`, {
      ...ANSWERS,
      ...overrides,
      captchaId: captcha.id,
      captcha: captcha.nonce
    }),
    env,
    ctx
  );
}

describe("satisfaction survey submission", () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env, { slug: SLUG });
  });

  it("stores an anonymous response with every rating", async () => {
    const response = await postSurvey(env, ctx, { comments: "  Evento excelente  " });
    expect(response.status).toBe(201);

    const row = env.DB.raw
      .prepare("SELECT * FROM satisfaction_surveys WHERE meetup_slug = ?")
      .get(SLUG);

    expect(row.pre_event_communication).toBe(5);
    expect(row.coffee_break).toBe(2);
    expect(row.recommendation).toBe(5);
    expect(row.comments).toBe("Evento excelente");
  });

  it("stores a response without comments", async () => {
    const response = await postSurvey(env, ctx);
    expect(response.status).toBe(201);

    const row = env.DB.raw
      .prepare("SELECT comments FROM satisfaction_surveys WHERE meetup_slug = ?")
      .get(SLUG);
    expect(row.comments).toBe(null);
  });

  it("refuses a response with no captcha", async () => {
    const response = await worker.fetch(
      jsonRequest(`https://api.test/api/meetups/${SLUG}/survey`, ANSWERS),
      env,
      ctx
    );

    expect(response.status).toBe(400);
    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM satisfaction_surveys").get();
    expect(Number(count.total)).toBe(0);
  });

  it("refuses reusing the same captcha twice", async () => {
    const captcha = await solveCaptcha(env, ctx);
    const body = { ...ANSWERS, captchaId: captcha.id, captcha: captcha.nonce };

    const first = await worker.fetch(
      jsonRequest(`https://api.test/api/meetups/${SLUG}/survey`, body),
      env,
      ctx
    );
    const second = await worker.fetch(
      jsonRequest(`https://api.test/api/meetups/${SLUG}/survey`, body),
      env,
      ctx
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(400);
  });

  it("rejects ratings out of the 1-5 scale, missing answers and non-integers", async () => {
    const cases = [
      { organization: 0 },
      { organization: 6 },
      { organization: 3.5 },
      { organization: "excelente" },
      { organization: undefined },
      { talks: null }
    ];

    for (const override of cases) {
      const response = await postSurvey(env, ctx, override);
      expect(response.status, JSON.stringify(override)).toBe(400);
    }

    const count = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM satisfaction_surveys").get();
    expect(Number(count.total)).toBe(0);
  });

  it("rejects an oversized comment", async () => {
    const response = await postSurvey(env, ctx, { comments: "a".repeat(2001) });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a meetup that does not exist", async () => {
    const response = await postSurvey(env, ctx, {}, "meetup-inexistente");
    expect(response.status).toBe(404);
  });
});

describe("satisfaction survey results for the organisation", () => {
  let env;
  let ctx;
  let adminToken;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env, { slug: SLUG });
    adminToken = (await seedSession(env, ADMIN)).token;
  });

  const results = (token = adminToken, slug = SLUG) =>
    worker.fetch(
      getRequest(`https://api.test/api/admin/meetups/${slug}/survey`, {
        headers: authHeaders(token)
      }),
      env,
      ctx
    );

  it("aggregates counts and averages per question", async () => {
    await postSurvey(env, ctx, { organization: 5, comments: "Muito bom" });
    await postSurvey(env, ctx, { organization: 3, comments: "" });

    const response = await results();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.totalResponses).toBe(2);

    const organization = data.questions.find((question) => question.key === "organization");
    expect(organization.counts).toEqual([0, 0, 1, 0, 1]);
    expect(organization.average).toBe(4);

    expect(data.comments.map((comment) => comment.text)).toEqual(["Muito bom"]);
  });

  it("reports an empty aggregate when nobody answered", async () => {
    const data = await (await results()).json();

    expect(data.totalResponses).toBe(0);
    expect(data.comments).toEqual([]);
    for (const question of data.questions) {
      expect(question.counts).toEqual([0, 0, 0, 0, 0]);
      expect(question.average).toBe(null);
    }
  });

  it("only counts responses of the requested meetup", async () => {
    seedMeetup(env, { slug: "meetup-outro", title: "Outro" });
    await postSurvey(env, ctx, {}, SLUG);
    await postSurvey(env, ctx, {}, "meetup-outro");

    const data = await (await results(adminToken, "meetup-outro")).json();
    expect(data.totalResponses).toBe(1);
    expect(data.meetup.slug).toBe("meetup-outro");
  });

  it("refuses non-admin sessions and anonymous access", async () => {
    const userToken = (await seedSession(env, USER)).token;

    expect((await results(userToken)).status).toBe(403);
    expect(
      (await worker.fetch(
        getRequest(`https://api.test/api/admin/meetups/${SLUG}/survey`),
        env,
        ctx
      )).status
    ).toBe(401);
  });

  it("returns 404 for a meetup that does not exist", async () => {
    expect((await results(adminToken, "meetup-inexistente")).status).toBe(404);
  });
});
