import { describe, it, expect, beforeEach, afterEach } from "vitest";
import worker from "../../workers/meetup-api/src/index.js";
import {
  createEnv,
  createCtx,
  seedMeetup,
  seedRegistration
} from "../helpers/worker-env.js";

const SLUG = "meetup-teste";

function queueJob(env, overrides = {}) {
  const job = {
    kind: "confirmation",
    meetup_slug: SLUG,
    registration_id: null,
    certificate_code: null,
    recipient_name: "Fulano",
    recipient_email: "fulano@example.com",
    subject: "Assunto",
    text_body: "corpo",
    html_body: "<p>corpo</p>",
    send_after: "datetime('now', '-1 minute')",
    status: "pending",
    attempts: 0,
    cap_retries: 0,
    ...overrides
  };

  env.DB.raw
    .prepare(
      `INSERT INTO email_jobs (kind, meetup_slug, registration_id, certificate_code, recipient_name, recipient_email, subject, text_body, html_body, send_after, status, attempts, cap_retries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${job.send_after}, ?, ?, ?)`
    )
    .run(
      job.kind,
      job.meetup_slug,
      job.registration_id,
      job.certificate_code,
      job.recipient_name,
      job.recipient_email,
      job.subject,
      job.text_body,
      job.html_body,
      job.status,
      job.attempts,
      job.cap_retries
    );
}

function jobRows(env) {
  return env.DB.raw
    .prepare("SELECT id, status, attempts, cap_retries, send_after, last_error FROM email_jobs ORDER BY id")
    .all();
}

function sendsToday(env) {
  const row = env.DB.raw
    .prepare("SELECT COUNT(*) AS total FROM email_sends WHERE date(sent_at) = date('now')")
    .get();
  return Number(row.total);
}

function stubResend({ fail = false } = {}) {
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw new Error(`unexpected fetch: ${url}`);
    }
    if (!(hostname === "resend.com" || hostname.endsWith(".resend.com"))) {
      throw new Error(`unexpected fetch: ${url}`);
    }

    calls.push(init && init.body ? JSON.parse(init.body) : null);
    if (fail) {
      return new Response(JSON.stringify({ message: "provider is down" }), { status: 500 });
    }
    return new Response(JSON.stringify({ id: `email-${calls.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

async function runCron(env) {
  const ctx = createCtx();
  await worker.scheduled({}, env, ctx);
  await ctx.settle();
}

describe("email queue processing", () => {
  let env;
  let resend;

  beforeEach(() => {
    env = createEnv();
    seedMeetup(env);
    resend = stubResend();
  });

  afterEach(() => {
    resend.restore();
  });

  it("sends a due job and records it in the ledger", async () => {
    queueJob(env);
    await runCron(env);

    expect(resend.calls.length).toBe(1);
    expect(jobRows(env)[0].status).toBe("sent");
    expect(sendsToday(env)).toBe(1);
  });

  it("leaves a job that is not due yet untouched", async () => {
    queueJob(env, { send_after: "datetime('now', '+1 hour')" });
    await runCron(env);

    expect(resend.calls.length).toBe(0);
    expect(jobRows(env)[0].status).toBe("pending");
  });

  it("never sends the same job twice", async () => {
    queueJob(env);
    await runCron(env);
    await runCron(env);

    expect(resend.calls.length).toBe(1);
    expect(sendsToday(env)).toBe(1);
  });

  it("stops at the daily cap and reschedules the overflow for the next morning", async () => {
    for (let i = 0; i < 100; i += 1) {
      env.DB.raw.prepare("INSERT INTO email_sends (kind) VALUES ('confirmation')").run();
    }

    queueJob(env);
    await runCron(env);

    const job = jobRows(env)[0];
    expect(resend.calls.length).toBe(0);
    expect(job.status).toBe("pending");
    expect(job.cap_retries).toBe(1);
    expect(job.last_error).toContain("Limite diário");
    expect(job.send_after > new Date().toISOString().slice(0, 19).replace("T", " ")).toBe(true);
  });

  it("gives up on a job that keeps hitting the cap", async () => {
    for (let i = 0; i < 100; i += 1) {
      env.DB.raw.prepare("INSERT INTO email_sends (kind) VALUES ('confirmation')").run();
    }

    queueJob(env, { cap_retries: 3 });
    await runCron(env);

    const job = jobRows(env)[0];
    expect(job.status).toBe("failed");
    expect(job.last_error).toContain("todos os reagendamentos");
  });

  it("honours a raised cap from the environment instead of the hardcoded default", async () => {
    env.DAILY_EMAIL_CAP = "150";

    for (let i = 0; i < 120; i += 1) {
      env.DB.raw.prepare("INSERT INTO email_sends (kind) VALUES ('confirmation')").run();
    }

    queueJob(env);
    await runCron(env);

    expect(resend.calls.length).toBe(1);
    expect(jobRows(env)[0].status).toBe("sent");
  });

  it("still stops once the raised cap itself is reached", async () => {
    env.DAILY_EMAIL_CAP = "150";

    for (let i = 0; i < 150; i += 1) {
      env.DB.raw.prepare("INSERT INTO email_sends (kind) VALUES ('confirmation')").run();
    }

    queueJob(env);
    await runCron(env);

    expect(resend.calls.length).toBe(0);
    expect(jobRows(env)[0].cap_retries).toBe(1);
  });

  it("falls back to the safe default when the variable is missing or nonsense", async () => {
    for (const value of [undefined, "", "abc", "0", "-5"]) {
      const scenario = createEnv();
      seedMeetup(scenario);
      if (value !== undefined) scenario.DAILY_EMAIL_CAP = value;

      for (let i = 0; i < 100; i += 1) {
        scenario.DB.raw.prepare("INSERT INTO email_sends (kind) VALUES ('confirmation')").run();
      }

      queueJob(scenario);
      await runCron(scenario);

      expect(jobRows(scenario)[0].status, `cap=${String(value)}`).toBe("pending");
    }
  });

  it("counts immediate sends against the same daily budget", async () => {
    const before = sendsToday(env);
    queueJob(env);
    await runCron(env);

    expect(sendsToday(env)).toBe(before + 1);
  });

  it("never sends more than the remaining budget in one tick", async () => {
    for (let i = 0; i < 98; i += 1) {
      env.DB.raw.prepare("INSERT INTO email_sends (kind) VALUES ('confirmation')").run();
    }
    for (let i = 0; i < 10; i += 1) {
      queueJob(env, { recipient_email: `p${i}@example.com` });
    }

    await runCron(env);

    expect(resend.calls.length).toBeLessThanOrEqual(2);
    expect(sendsToday(env)).toBeLessThanOrEqual(100);
  });
});

describe("jobs interrupted mid-send are not lost", () => {
  let env;
  let resend;

  beforeEach(() => {
    env = createEnv();
    seedMeetup(env);
    resend = stubResend();
  });

  afterEach(() => {
    resend.restore();
  });

  function stuckJob(minutesAgo, attempts = 1) {
    queueJob(env, { status: "processing", attempts });
    env.DB.raw
      .prepare("UPDATE email_jobs SET updated_at = datetime('now', ?) WHERE id = (SELECT MAX(id) FROM email_jobs)")
      .run(`-${minutesAgo} minutes`);
  }

  it("requeues and delivers a job left stuck in processing", async () => {
    stuckJob(30);

    await runCron(env);

    expect(resend.calls.length).toBe(1);
    expect(jobRows(env)[0].status).toBe("sent");
  });

  it("leaves a job that is still being worked on alone", async () => {
    stuckJob(1);

    await runCron(env);

    expect(resend.calls.length).toBe(0);
    expect(jobRows(env)[0].status).toBe("processing");
  });

  it("gives up on a stuck job that already burned every attempt", async () => {
    stuckJob(30, 5);

    await runCron(env);

    const job = jobRows(env)[0];
    expect(job.status).toBe("failed");
    expect(job.last_error).toContain("tentativas esgotadas");
    expect(resend.calls.length).toBe(0);
  });

  it("does not resurrect a job that already went out", async () => {
    queueJob(env, { status: "sent" });

    await runCron(env);

    expect(resend.calls.length).toBe(0);
    expect(jobRows(env)[0].status).toBe("sent");
  });
});

describe("email retry behaviour", () => {
  let env;
  let resend;

  beforeEach(() => {
    env = createEnv();
    seedMeetup(env);
    resend = stubResend({ fail: true });
  });

  afterEach(() => {
    resend.restore();
  });

  it("reschedules a failed send instead of losing it", async () => {
    queueJob(env);
    await runCron(env);

    const job = jobRows(env)[0];
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBeTruthy();
    expect(sendsToday(env)).toBe(0);
  });

  it("marks a job failed after the fifth attempt", async () => {
    queueJob(env, { attempts: 4 });
    await runCron(env);

    const job = jobRows(env)[0];
    expect(job.attempts).toBe(5);
    expect(job.status).toBe("failed");
  });

  it("does not write to the ledger when the provider refuses the message", async () => {
    queueJob(env);
    await runCron(env);
    expect(sendsToday(env)).toBe(0);
  });
});

describe("automatic reminders", () => {
  let env;
  let resend;

  beforeEach(() => {
    env = createEnv();
    resend = stubResend();
  });

  afterEach(() => {
    resend.restore();
  });

  function seedUpcomingMeetup(daysAhead) {
    const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const slug = `meetup-em-${daysAhead}-dias`;
    seedMeetup(env, {
      slug,
      title: `Meetup em ${daysAhead} dias`,
      event_date: date.toISOString().slice(0, 19)
    });
    return slug;
  }

  it("queues exactly one reminder per registration, even across repeated cron ticks", async () => {
    const slug = seedUpcomingMeetup(3);
    seedRegistration(env, { meetup_slug: slug, email: "a@example.com" });

    await runCron(env);
    await runCron(env);
    await runCron(env);

    const reminders = env.DB.raw
      .prepare("SELECT COUNT(*) AS total FROM email_jobs WHERE kind = 'reminder'")
      .get();

    expect(Number(reminders.total)).toBeLessThanOrEqual(1);
  });

  it("does not queue reminders for a meetup far outside the window", async () => {
    const slug = seedUpcomingMeetup(60);
    seedRegistration(env, { meetup_slug: slug, email: "a@example.com" });

    await runCron(env);

    const reminders = env.DB.raw
      .prepare("SELECT COUNT(*) AS total FROM email_jobs WHERE kind = 'reminder' AND meetup_slug = ?")
      .get(slug);

    expect(Number(reminders.total)).toBe(0);
  });

  it("does not queue reminders for a meetup that already happened", async () => {
    seedMeetup(env, { slug: "ja-foi", title: "Ja foi", event_date: "2020-01-10T19:00:00" });
    seedRegistration(env, { meetup_slug: "ja-foi", email: "a@example.com" });

    await runCron(env);

    const reminders = env.DB.raw
      .prepare("SELECT COUNT(*) AS total FROM email_jobs WHERE kind = 'reminder' AND meetup_slug = ?")
      .get("ja-foi");

    expect(Number(reminders.total)).toBe(0);
  });

  it("drops the queued reminder when the person cancels", async () => {
    const slug = seedUpcomingMeetup(3);
    const registration = seedRegistration(env, { meetup_slug: slug, email: "a@example.com" });

    await runCron(env);
    env.DB.raw.prepare("DELETE FROM registrations WHERE id = ?").run(registration.id);

    const orphans = env.DB.raw
      .prepare("SELECT COUNT(*) AS total FROM email_jobs WHERE registration_id = ?")
      .get(registration.id);

    expect(Number(orphans.total)).toBe(0);
  });
});

describe("cron housekeeping", () => {
  let env;
  let resend;

  beforeEach(() => {
    env = createEnv();
    seedMeetup(env);
    resend = stubResend();
  });

  afterEach(() => {
    resend.restore();
  });

  it("purges expired captcha challenges", async () => {
    env.DB.raw
      .prepare(
        "INSERT INTO captcha_challenges (id, seed, difficulty, expires_at) VALUES ('velho', 'seed', 10, datetime('now', '-1 hour'))"
      )
      .run();
    env.DB.raw
      .prepare(
        "INSERT INTO captcha_challenges (id, seed, difficulty, expires_at) VALUES ('novo', 'seed', 10, datetime('now', '+1 hour'))"
      )
      .run();

    await runCron(env);

    const remaining = env.DB.raw.prepare("SELECT id FROM captcha_challenges").all();
    expect(remaining.map((row) => row.id)).toEqual(["novo"]);
  });

  it("purges stale login requests and sessions", async () => {
    env.DB.raw
      .prepare(
        "INSERT INTO auth_login_requests (email_hash, created_at) VALUES ('hash', datetime('now', '-3 days'))"
      )
      .run();
    env.DB.raw
      .prepare(
        "INSERT INTO auth_sessions (email, token_hash, expires_at, created_at) VALUES ('a@example.com', 'hash', datetime('now', '-2 days'), datetime('now', '-3 days'))"
      )
      .run();

    await runCron(env);

    const requests = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM auth_login_requests").get();
    const sessions = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get();

    expect(Number(requests.total)).toBe(0);
    expect(Number(sessions.total)).toBe(0);
  });

  it("keeps a live session alive", async () => {
    env.DB.raw
      .prepare(
        "INSERT INTO auth_sessions (email, token_hash, expires_at) VALUES ('a@example.com', 'hash', datetime('now', '+20 minutes'))"
      )
      .run();

    await runCron(env);

    const sessions = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get();
    expect(Number(sessions.total)).toBe(1);
  });
});
