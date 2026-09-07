import { describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const PAGE_HTML = fs.readFileSync(path.join(ROOT, "minhas-inscricoes.html"), "utf8");
const FORM_UTILS = fs.readFileSync(path.join(ROOT, "assets", "js", "form-utils.js"), "utf8");
const MAIN_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "main.js"), "utf8");
const SUBSCRIPTIONS_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "meetup-subscriptions.js"), "utf8");

function stripLiquid(html) {
  return html
    .replace(/^---[\s\S]*?---\n/, "")
    .replace(/\{%[\s\S]*?%\}/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "#");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountAccount({ isAdmin = false, registrations = [], cameraFails = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${stripLiquid(PAGE_HTML)}</body></html>`, {
    url: "https://hackinbrasil.com.br/minhas-inscricoes/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.error || event.message));

  const cameraCalls = [];
  const stoppedTracks = [];
  const calls = [];

  const track = {
    stop() {
      stoppedTracks.push(true);
    }
  };

  window.navigator.mediaDevices = {
    async getUserMedia(constraints) {
      cameraCalls.push(constraints);
      if (cameraFails) throw new Error("permission denied");
      return { getTracks: () => [track] };
    }
  };

  window.HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve();
  };

  window.jsQR = () => null;

  window.fetch = async (url, options) => {
    const target = String(url);
    const method = (options && options.method) || "GET";
    calls.push(`${method} ${target}`);

    const reply = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    });

    if (target.endsWith("/api/me/registrations")) {
      return reply(200, {
        email: "pessoa@example.com",
        confirmationWord: "CANCELAR",
        profile: { nickname: null, isPublic: false, xp: 0, meetupsAttended: 0 },
        registrations
      });
    }
    if (target.endsWith("/api/me/admin-status")) return reply(200, { isAdmin });
    if (target.endsWith("/api/admin/checkin")) {
      return reply(200, { ok: true, alreadyCheckedIn: false, name: "Fulano", meetupTitle: "Meetup" });
    }
    if (target.endsWith("/api/auth/logout")) return reply(200, { ok: true });
    if (target.endsWith("/api/captcha")) {
      return reply(200, { id: "captcha-1", seed: "seed", difficulty: 1 });
    }
    return reply(404, { error: "not found" });
  };

  window.sessionStorage.setItem("hib.subscriptions.session", "session-token");
  window.eval(FORM_UTILS);
  window.eval(MAIN_JS);
  window.eval(SUBSCRIPTIONS_JS);

  return { dom, window, errors, calls, cameraCalls, stoppedTracks };
}

function q(window, selector) {
  return window.document.querySelector(selector);
}

describe("check-in tool inside the account page", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("never asks a regular participant for camera permission", async () => {
    mounted = mountAccount({ isAdmin: false });
    await sleep(300);

    expect(mounted.cameraCalls).toEqual([]);
    expect(q(mounted.window, "#admin-panel").hidden).toBe(true);
    expect(mounted.errors).toEqual([]);
  });

  it("never even renders the scanner for a regular participant", async () => {
    mounted = mountAccount({ isAdmin: false });
    await sleep(300);

    const video = q(mounted.window, "#admin-checkin-video");
    expect(video.srcObject).toBeFalsy();
    expect(mounted.calls.some((call) => call.includes("/api/admin/checkin"))).toBe(false);
  });

  it("still shows the normal participant view when there is no admin access", async () => {
    mounted = mountAccount({
      isAdmin: false,
      registrations: [
        {
          meetupSlug: "meetup-teste",
          title: "Meetup Teste",
          eventDate: "2090-01-10T19:00:00",
          name: "Pessoa",
          isPast: false,
          canCancel: true,
          certificate: { available: false, availableAt: null, code: null }
        }
      ]
    });
    await sleep(300);

    expect(q(mounted.window, "#subscriptions-section").hidden).toBe(false);
    expect(mounted.window.document.querySelectorAll(".subscription-card").length).toBe(1);
  });

  it("reveals the tool for an admin but leaves the camera off until asked", async () => {
    mounted = mountAccount({ isAdmin: true });
    await sleep(300);

    expect(q(mounted.window, "#admin-panel").hidden).toBe(false);
    expect(mounted.cameraCalls).toEqual([]);
    expect(q(mounted.window, "#admin-checkin-video").hidden).toBe(true);
    expect(q(mounted.window, "#admin-checkin-toggle").textContent).toContain("Ativar");
  });

  it("asks for the rear camera only after the admin presses the button", async () => {
    mounted = mountAccount({ isAdmin: true });
    await sleep(300);

    q(mounted.window, "#admin-checkin-toggle").click();
    await sleep(200);

    expect(mounted.cameraCalls.length).toBe(1);
    expect(mounted.cameraCalls[0]).toEqual({ video: { facingMode: "environment" } });
    expect(q(mounted.window, "#admin-checkin-toggle").textContent).toContain("Desligar");
  });

  it("lets the admin turn the camera back off", async () => {
    mounted = mountAccount({ isAdmin: true });
    await sleep(300);

    const toggle = q(mounted.window, "#admin-checkin-toggle");
    toggle.click();
    await sleep(200);
    toggle.click();
    await sleep(100);

    expect(mounted.stoppedTracks.length).toBeGreaterThan(0);
    expect(q(mounted.window, "#admin-checkin-video").srcObject).toBe(null);
    expect(toggle.textContent).toContain("Ativar");
  });

  it("asks the backend before touching the camera, never the other way around", async () => {
    mounted = mountAccount({ isAdmin: true });
    await sleep(300);

    const adminStatusIndex = mounted.calls.findIndex((call) => call.includes("/api/me/admin-status"));
    expect(adminStatusIndex).toBeGreaterThanOrEqual(0);
    expect(mounted.cameraCalls).toEqual([]);

    q(mounted.window, "#admin-checkin-toggle").click();
    await sleep(200);
    expect(mounted.cameraCalls.length).toBe(1);
  });

  it("releases the camera when the person logs out", async () => {
    mounted = mountAccount({ isAdmin: true });
    await sleep(300);
    q(mounted.window, "#admin-checkin-toggle").click();
    await sleep(200);
    expect(mounted.stoppedTracks.length).toBe(0);

    q(mounted.window, "#logout-button").click();
    await sleep(200);

    expect(mounted.stoppedTracks.length).toBeGreaterThan(0);
    expect(q(mounted.window, "#admin-panel").hidden).toBe(true);
    expect(q(mounted.window, "#admin-checkin-video").srcObject).toBe(null);
  });

  it("explains itself instead of breaking when camera permission is denied", async () => {
    mounted = mountAccount({ isAdmin: true, cameraFails: true });
    await sleep(300);
    q(mounted.window, "#admin-checkin-toggle").click();
    await sleep(200);

    expect(q(mounted.window, "#admin-checkin-status").textContent).toContain("câmera");
    expect(mounted.errors).toEqual([]);
  });

  it("hides the scanner again if the session expires", async () => {
    mounted = mountAccount({ isAdmin: true });
    await sleep(300);
    q(mounted.window, "#admin-checkin-toggle").click();
    await sleep(200);
    expect(q(mounted.window, "#admin-panel").hidden).toBe(false);

    const { window } = mounted;
    window.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    q(window, "#retry-button").click();
    await sleep(300);

    expect(q(window, "#admin-panel").hidden).toBe(true);
    expect(mounted.stoppedTracks.length).toBeGreaterThan(0);
    expect(q(window, "#login-section").hidden).toBe(false);
  });

  it("keeps session handling in one place: the raffle widget owns none of it", () => {
    const sorteio = fs.readFileSync(path.join(ROOT, "assets", "js", "sorteio.js"), "utf8");

    expect(SUBSCRIPTIONS_JS).toContain('"hib.subscriptions.session"');
    expect(sorteio).not.toContain("sessionStorage");
    expect(sorteio).not.toContain("hib.subscriptions.session");
    expect(sorteio).not.toContain("/api/auth/");
    expect(sorteio).toContain("window.HIBDuckRace");
  });
});

describe("account page login gate", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("shows the login form and no scanner when there is no session", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${stripLiquid(PAGE_HTML)}</body></html>`, {
      url: "https://hackinbrasil.com.br/minhas-inscricoes/",
      runScripts: "outside-only",
      pretendToBeVisual: true
    });

    const cameraCalls = [];
    dom.window.navigator.mediaDevices = {
      async getUserMedia(constraints) {
        cameraCalls.push(constraints);
        return { getTracks: () => [] };
      }
    };
    dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: "c", seed: "s", difficulty: 1 }) });

    dom.window.eval(FORM_UTILS);
    dom.window.eval(MAIN_JS);
    dom.window.eval(SUBSCRIPTIONS_JS);
    await sleep(300);

    expect(dom.window.document.getElementById("login-section").hidden).toBe(false);
    expect(dom.window.document.getElementById("admin-panel").hidden).toBe(true);
    expect(cameraCalls).toEqual([]);
    dom.window.close();
  });

  it("ignores a malformed token in the url instead of sending it to the api", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${stripLiquid(PAGE_HTML)}</body></html>`, {
      url: "https://hackinbrasil.com.br/minhas-inscricoes/?token=<script>alert(1)</script>",
      runScripts: "outside-only",
      pretendToBeVisual: true
    });

    const calls = [];
    dom.window.navigator.mediaDevices = { async getUserMedia() { return { getTracks: () => [] }; } };
    dom.window.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ id: "c", seed: "s", difficulty: 1 }) };
    };

    dom.window.eval(FORM_UTILS);
    dom.window.eval(MAIN_JS);
    dom.window.eval(SUBSCRIPTIONS_JS);
    await sleep(300);

    expect(calls.some((call) => call.includes("/api/auth/session"))).toBe(false);
    expect(dom.window.location.search).not.toContain("token=");
    dom.window.close();
  });
});
