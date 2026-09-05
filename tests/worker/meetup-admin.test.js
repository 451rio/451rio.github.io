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

const ADMIN = "admin@hackinbrasil.com.br";
const USER = "user@example.com";
const SLUG = "meetup-teste";

function futureDate(days = 10) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

describe("admin meetup management", () => {
  let env;
  let ctx;
  let mail;
  let adminToken;

  beforeEach(async () => {
    env = createEnv();
    ctx = createCtx();
    mail = stubEmailSending();
    adminToken = (await seedSession(env, ADMIN)).token;
  });

  afterEach(() => {
    mail.restore();
  });

  const post = (url, body, token = adminToken) =>
    worker.fetch(jsonRequest(url, body, { headers: authHeaders(token) }), env, ctx);
  const get = (url, token = adminToken) =>
    worker.fetch(getRequest(url, { headers: authHeaders(token) }), env, ctx);

  describe("create", () => {
    const validBody = () => ({
      slug: "meetup-novo",
      title: "Meetup Novo",
      eventDate: `${futureDate()}-03:00`,
      capacity: 80,
      durationMinutes: 180,
      isOpen: true
    });

    it("creates a meetup and stores every field", async () => {
      const res = await post("https://api.test/api/admin/meetups", validBody());
      expect(res.status).toBe(200);
      expect((await res.json()).slug).toBe("meetup-novo");

      const row = env.DB.raw
        .prepare("SELECT title, capacity, duration_minutes, is_open FROM meetups WHERE slug = ?")
        .get("meetup-novo");
      expect(row.title).toBe("Meetup Novo");
      expect(Number(row.capacity)).toBe(80);
      expect(Number(row.duration_minutes)).toBe(180);
      expect(Number(row.is_open)).toBe(1);
    });

    it("defaults the duration to 240 minutes when omitted", async () => {
      const body = validBody();
      delete body.durationMinutes;
      const res = await post("https://api.test/api/admin/meetups", body);
      expect(res.status).toBe(200);
      const row = env.DB.raw.prepare("SELECT duration_minutes FROM meetups WHERE slug = ?").get("meetup-novo");
      expect(Number(row.duration_minutes)).toBe(240);
    });

    it("refuses a non-admin session", async () => {
      const { token } = await seedSession(env, USER);
      const res = await post("https://api.test/api/admin/meetups", validBody(), token);
      expect(res.status).toBe(403);
    });

    it("rejects an invalid slug", async () => {
      const res = await post("https://api.test/api/admin/meetups", { ...validBody(), slug: "AB" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing title", async () => {
      const res = await post("https://api.test/api/admin/meetups", { ...validBody(), title: "  " });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid event date", async () => {
      const res = await post("https://api.test/api/admin/meetups", { ...validBody(), eventDate: "nope" });
      expect(res.status).toBe(400);
    });

    it("rejects a non-positive capacity", async () => {
      const res = await post("https://api.test/api/admin/meetups", { ...validBody(), capacity: 0 });
      expect(res.status).toBe(400);
    });

    it("rejects a non-positive duration", async () => {
      const res = await post("https://api.test/api/admin/meetups", { ...validBody(), durationMinutes: -5 });
      expect(res.status).toBe(400);
    });

    it("refuses a duplicate slug", async () => {
      seedMeetup(env, { slug: "meetup-novo" });
      const res = await post("https://api.test/api/admin/meetups", validBody());
      expect(res.status).toBe(409);
    });
  });

  describe("update", () => {
    beforeEach(() => {
      seedMeetup(env, { slug: SLUG, title: "Antigo", capacity: 50 });
    });

    const body = () => ({
      title: "Novo Título",
      eventDate: `${futureDate(20)}-03:00`,
      capacity: 120,
      durationMinutes: 300,
      isOpen: false
    });

    it("updates the meetup fields", async () => {
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}`, body());
      expect(res.status).toBe(200);

      const row = env.DB.raw
        .prepare("SELECT title, capacity, duration_minutes, is_open FROM meetups WHERE slug = ?")
        .get(SLUG);
      expect(row.title).toBe("Novo Título");
      expect(Number(row.capacity)).toBe(120);
      expect(Number(row.duration_minutes)).toBe(300);
      expect(Number(row.is_open)).toBe(0);
    });

    it("returns 404 for an unknown meetup", async () => {
      const res = await post("https://api.test/api/admin/meetups/nao-existe", body());
      expect(res.status).toBe(404);
    });

    it("refuses a non-admin session", async () => {
      const { token } = await seedSession(env, USER);
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}`, body(), token);
      expect(res.status).toBe(403);
    });

    it("rejects invalid data", async () => {
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}`, { ...body(), capacity: -1 });
      expect(res.status).toBe(400);
    });
  });

  describe("meetup list", () => {
    it("reports the real registration count and editable fields", async () => {
      seedMeetup(env, { slug: SLUG, capacity: 42 });
      seedRegistration(env, { email: "a@example.com" });
      seedRegistration(env, { email: "b@example.com" });

      const res = await get("https://api.test/api/admin/meetups");
      expect(res.status).toBe(200);
      const meetup = (await res.json()).meetups.find((m) => m.slug === SLUG);
      expect(meetup.registrationsCount).toBe(2);
      expect(meetup.capacity).toBe(42);
      expect(typeof meetup.isOpen).toBe("boolean");
    });
  });

  describe("attendance", () => {
    beforeEach(() => {
      seedMeetup(env, { slug: SLUG });
      seedRegistration(env, { email: "presente@example.com", name: "Presente", checked_in_at: "2026-01-01 20:00:00" });
      seedRegistration(env, { email: "ausente@example.com", name: "Ausente" });
    });

    it("lists registrations with their presence flag", async () => {
      const res = await get(`https://api.test/api/admin/meetups/${SLUG}/attendance`);
      expect(res.status).toBe(200);
      const data = await res.json();
      const byEmail = Object.fromEntries(data.registrations.map((r) => [r.email, r.present]));
      expect(byEmail["presente@example.com"]).toBe(true);
      expect(byEmail["ausente@example.com"]).toBe(false);
    });

    it("refuses the list for a non-admin", async () => {
      const { token } = await seedSession(env, USER);
      const res = await get(`https://api.test/api/admin/meetups/${SLUG}/attendance`, token);
      expect(res.status).toBe(403);
    });

    it("returns 404 when the meetup does not exist", async () => {
      const res = await get("https://api.test/api/admin/meetups/nao-existe/attendance");
      expect(res.status).toBe(404);
    });

    it("marks people present and absent in one batch", async () => {
      const rows = env.DB.raw.prepare("SELECT id, email FROM registrations WHERE meetup_slug = ?").all(SLUG);
      const present = rows.find((r) => r.email === "presente@example.com");
      const ausente = rows.find((r) => r.email === "ausente@example.com");

      const res = await post(`https://api.test/api/admin/meetups/${SLUG}/attendance`, {
        changes: [
          { id: ausente.id, present: true },
          { id: present.id, present: false }
        ]
      });
      expect(res.status).toBe(200);
      expect((await res.json()).updated).toBe(2);

      const after = env.DB.raw
        .prepare("SELECT email, checked_in_at FROM registrations WHERE meetup_slug = ?")
        .all(SLUG);
      const state = Object.fromEntries(after.map((r) => [r.email, !!r.checked_in_at]));
      expect(state["ausente@example.com"]).toBe(true);
      expect(state["presente@example.com"]).toBe(false);
    });

    it("accepts an empty change set", async () => {
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}/attendance`, { changes: [] });
      expect(res.status).toBe(200);
      expect((await res.json()).updated).toBe(0);
    });

    it("rejects a body without a changes array", async () => {
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}/attendance`, { nope: true });
      expect(res.status).toBe(400);
    });

    it("rejects a change with an invalid id", async () => {
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}/attendance`, {
        changes: [{ id: "abc", present: true }]
      });
      expect(res.status).toBe(400);
    });

    it("refuses a batch update from a non-admin", async () => {
      const { token } = await seedSession(env, USER);
      const res = await post(`https://api.test/api/admin/meetups/${SLUG}/attendance`, { changes: [] }, token);
      expect(res.status).toBe(403);
    });
  });
});
