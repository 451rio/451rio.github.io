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
  makeOpaqueToken
} from "../helpers/worker-env.js";

const ADMIN = "admin@hackinbrasil.com.br";
const PARTICIPANT = "pessoa@example.com";

const ADMIN_ROUTES = [
  { method: "GET", path: "/api/admin/meetups" },
  { method: "GET", path: "/api/admin/meetups/meetup-teste/duck-race" },
  { method: "POST", path: "/api/admin/meetups/meetup-teste/duck-race/draw" },
  { method: "POST", path: "/api/admin/meetups/meetup-teste/duck-race/reset" },
  { method: "POST", path: "/api/admin/checkin", body: { code: "chk_whatever" } }
];

function call(env, ctx, route, token) {
  const url = `https://api.test${route.path}`;
  const headers = token ? authHeaders(token) : {};
  const request = route.method === "GET"
    ? getRequest(url, { headers })
    : jsonRequest(url, route.body || {}, { headers });
  return worker.fetch(request, env, ctx);
}

describe("admin route authorization", () => {
  let env;
  let ctx;

  beforeEach(() => {
    env = createEnv();
    ctx = createCtx();
    seedMeetup(env);
    seedRegistration(env, { email: PARTICIPANT, checked_in_at: "2026-09-03 20:00:00" });
  });

  it("rejects every admin route without a session", async () => {
    for (const route of ADMIN_ROUTES) {
      const response = await call(env, ctx, route);
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("rejects every admin route for a valid NON-admin session", async () => {
    const { token } = await seedSession(env, PARTICIPANT);

    for (const route of ADMIN_ROUTES) {
      const response = await call(env, ctx, route, token);
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
    }
  });

  it("rejects admin routes for a session whose email only differs in case handling", async () => {
    const { token } = await seedSession(env, "Admin@Hackinbrasil.com.br".toLowerCase() + ".evil.com");
    const response = await call(env, ctx, ADMIN_ROUTES[0], token);
    expect(response.status).toBe(403);
  });

  it("accepts admin routes for an admin session regardless of letter case in the allowlist", async () => {
    env.ADMIN_EMAILS = " ADMIN@HACKINBRASIL.COM.BR , outro@hackinbrasil.com.br ";
    const { token } = await seedSession(env, ADMIN);

    const response = await call(env, ctx, ADMIN_ROUTES[0], token);
    expect(response.status).toBe(200);
  });

  it("rejects a revoked session", async () => {
    const { token } = await seedSession(env, ADMIN, { revoked: true });
    const response = await call(env, ctx, ADMIN_ROUTES[0], token);
    expect(response.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { token } = await seedSession(env, ADMIN, { expiresAt: "datetime('now', '-1 minute')" });
    const response = await call(env, ctx, ADMIN_ROUTES[0], token);
    expect(response.status).toBe(401);
  });

  it("rejects a well-formed bearer token that was never issued", async () => {
    const response = await call(env, ctx, ADMIN_ROUTES[0], makeOpaqueToken());
    expect(response.status).toBe(401);
  });

  it("rejects a malformed bearer token before it reaches the database", async () => {
    for (const bad of ["short", "tem espaço no meio", "'; DROP TABLE auth_sessions; --", "a".repeat(200)]) {
      const response = await call(env, ctx, ADMIN_ROUTES[0], bad);
      expect(response.status, bad).toBe(401);
    }

    const table = env.DB.raw.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get();
    expect(Number(table.total)).toBe(0);
  });

  it("reports isAdmin=false to a participant and true to an admin", async () => {
    const participant = await seedSession(env, PARTICIPANT);
    const admin = await seedSession(env, ADMIN);

    const asParticipant = await worker.fetch(
      getRequest("https://api.test/api/me/admin-status", { headers: authHeaders(participant.token) }),
      env,
      ctx
    );
    const asAdmin = await worker.fetch(
      getRequest("https://api.test/api/me/admin-status", { headers: authHeaders(admin.token) }),
      env,
      ctx
    );

    expect((await asParticipant.json()).isAdmin).toBe(false);
    expect((await asAdmin.json()).isAdmin).toBe(true);
  });

  it("does not let an empty ADMIN_EMAILS secret turn everyone into an admin", async () => {
    env.ADMIN_EMAILS = "";
    const { token } = await seedSession(env, PARTICIPANT);

    const status = await worker.fetch(
      getRequest("https://api.test/api/me/admin-status", { headers: authHeaders(token) }),
      env,
      ctx
    );
    expect((await status.json()).isAdmin).toBe(false);

    for (const route of ADMIN_ROUTES) {
      const response = await call(env, ctx, route, token);
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
    }
  });

  it("does not let a blank entry in ADMIN_EMAILS authorize a blank email", async () => {
    env.ADMIN_EMAILS = "admin@hackinbrasil.com.br,,  ,";
    const { token } = await seedSession(env, "");
    const response = await call(env, ctx, ADMIN_ROUTES[0], token);
    expect(response.status).toBe(403);
  });
});
