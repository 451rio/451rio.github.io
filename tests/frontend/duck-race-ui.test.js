import { describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const PAGE_HTML = fs.readFileSync(path.join(ROOT, "minhas-inscricoes.html"), "utf8");
const FORM_UTILS = fs.readFileSync(path.join(ROOT, "assets", "js", "form-utils.js"), "utf8");
const MAIN_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "main.js"), "utf8");
const SORTEIO_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "sorteio.js"), "utf8");
const SUBSCRIPTIONS_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "meetup-subscriptions.js"), "utf8");

function stripFrontMatter(html) {
  return html.replace(/^---[\s\S]*?---\n/, "").replace(/\{\{[\s\S]*?\}\}/g, "#").replace(/\{%[\s\S]*?%\}/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountPage({ isAdmin = true, ducks = [], winners = [], withSession = true } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${stripFrontMatter(PAGE_HTML)}</body></html>`, {
    url: "https://hackinbrasil.com.br/minhas-inscricoes/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
  }
  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.error || event.message));

  let eligible = ducks.slice();
  let drawn = winners.slice();
  const calls = [];

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
        email: "admin@example.com",
        confirmationWord: "CANCELAR",
        profile: { nickname: null, isPublic: false, xp: 0, meetupsAttended: 0 },
        registrations: []
      });
    }
    if (target.endsWith("/api/captcha")) {
      return reply(200, { id: "captcha-1", seed: "seed", difficulty: 0 });
    }
    if (target.endsWith("/api/auth/magic-link")) {
      return reply(200, { ok: true, message: "Link enviado." });
    }
    if (target.endsWith("/api/me/admin-status")) return reply(200, { isAdmin });
    if (target.endsWith("/api/admin/meetups")) {
      return reply(200, {
        meetups: [{ slug: "meetup-teste", title: "Teste", eventDate: new Date().toISOString() }]
      });
    }
    if (/\/duck-race$/.test(target)) return reply(200, { ducks: eligible, winners: drawn });
    if (/\/duck-race\/draw$/.test(target) && method === "POST") {
      if (eligible.length === 0) return reply(409, { error: "Sem elegíveis" });
      const winner = eligible[0];
      eligible = eligible.slice(1);
      drawn = [...drawn, { id: winner.id, name: winner.name, wonAt: "2026-09-03 20:00:00" }];
      return reply(200, { winner: { id: winner.id, name: winner.name } });
    }
    if (/\/duck-race\/reset$/.test(target) && method === "POST") {
      const removed = drawn.length;
      eligible = ducks.slice();
      drawn = [];
      return reply(200, { ok: true, removed });
    }
    return reply(404, { error: "not found" });
  };

  if (withSession) window.sessionStorage.setItem("hib.subscriptions.session", "session-token");
  window.navigator.mediaDevices = {
    async getUserMedia() {
      return { getTracks: () => [{ stop() {} }] };
    }
  };
  window.HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve();
  };
  window.jsQR = () => null;

  window.eval(FORM_UTILS);
  window.HIBForms.createCaptcha = function () {
    return {
      render: async () => {},
      getToken: () => "captcha-1",
      getAnswer: () => "0",
      ready: () => true
    };
  };
  window.eval(MAIN_JS);
  window.eval(SORTEIO_JS);
  window.eval(SUBSCRIPTIONS_JS);

  return { dom, window, errors, calls };
}

describe("duck race page gating", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("keeps the raffle completely hidden from a non-admin session", async () => {
    mounted = mountPage({ isAdmin: false });
    await sleep(250);

    const { window } = mounted;
    expect(window.document.getElementById("duckrace-section").hidden).toBe(true);
    expect(window.document.getElementById("admin-panel").hidden).toBe(true);
    expect(mounted.errors).toEqual([]);
  });

  it("never calls the draw endpoint for a non-admin session", async () => {
    mounted = mountPage({ isAdmin: false });
    await sleep(200);

    expect(mounted.calls.some((call) => call.includes("duck-race/draw"))).toBe(false);
  });

  it("opens the tool for an admin session", async () => {
    mounted = mountPage({
      isAdmin: true,
      ducks: [{ id: 1, name: "Ana" }, { id: 2, name: "Bruno" }]
    });
    await sleep(200);

    const { window } = mounted;
    expect(window.document.getElementById("duckrace-section").hidden).toBe(false);
    expect(window.document.querySelectorAll(".duckrace-lane").length).toBe(2);
  });
});

describe("duck race rendering", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("shows the registration id next to the name so duplicates stay distinguishable", async () => {
    mounted = mountPage({
      ducks: [{ id: 11, name: "Ana Silva" }, { id: 12, name: "Ana Silva" }]
    });
    await sleep(200);

    const names = Array.from(mounted.window.document.querySelectorAll(".duckrace-name")).map(
      (el) => el.textContent
    );
    expect(names).toEqual(["Ana Silva #11", "Ana Silva #12"]);
  });

  it("keeps the id in its own element so a long name can never truncate it away", async () => {
    mounted = mountPage({
      ducks: [{ id: 77, name: "Maria Aparecida da Conceicao dos Santos Nascimento" }]
    });
    await sleep(200);

    const tag = mounted.window.document.querySelector(".duckrace-name");
    const text = tag.querySelector(".duckrace-name-text");
    const id = tag.querySelector(".duckrace-name-id");

    expect(text.textContent).toBe("Maria Aparecida da Conceicao dos Santos Nascimento");
    expect(id.textContent.trim()).toBe("#77");
  });

  it("escapes participant names instead of injecting them as markup", async () => {
    mounted = mountPage({
      ducks: [{ id: 1, name: "<img src=x onerror=alert(1)>" }]
    });
    await sleep(200);

    const { window } = mounted;
    const tag = window.document.querySelector(".duckrace-name");
    expect(tag.querySelector("img")).toBe(null);
    expect(tag.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps the same duck skin for the same id across renders", async () => {
    const first = mountPage({ ducks: [{ id: 42, name: "Ana" }] });
    await sleep(200);
    const firstFill = first.window.document.querySelector(".duckrace-duck-svg ellipse").getAttribute("fill");
    first.dom.window.close();

    const second = mountPage({ ducks: [{ id: 42, name: "Outro Nome" }] });
    await sleep(200);
    const secondFill = second.window.document.querySelector(".duckrace-duck-svg ellipse").getAttribute("fill");
    second.dom.window.close();

    expect(secondFill).toBe(firstFill);
  });

  it("keeps every racer in one column behind a single finish strip", async () => {
    mounted = mountPage({
      ducks: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Pessoa ${i}` }))
    });
    await sleep(300);

    const { window } = mounted;
    expect(window.document.querySelectorAll(".duckrace-lane").length).toBe(100);
    expect(window.document.querySelectorAll(".duckrace-lane-group").length).toBe(1);
    expect(window.document.querySelectorAll(".duckrace-finish").length).toBe(1);
  });

  it("keeps ducks comfortably sized instead of shrinking them to fit the field", async () => {
    const small = mountPage({ ducks: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `P${i}` })) });
    await sleep(300);
    const smallLane = small.window.document.getElementById("duckrace-lanes").style.getPropertyValue("--duckrace-lane-h");
    small.dom.window.close();

    mounted = mountPage({ ducks: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `P${i}` })) });
    await sleep(300);
    const bigLane = mounted.window.document.getElementById("duckrace-lanes").style.getPropertyValue("--duckrace-lane-h");

    expect(parseInt(bigLane, 10)).toBeGreaterThanOrEqual(24);
    expect(
      parseInt(bigLane, 10),
      "o tamanho do pato nao pode encolher so porque entrou mais gente na corrida"
    ).toBe(parseInt(smallLane, 10));
  });

  it("keeps lanes readable instead of collapsing them for a huge field", async () => {
    mounted = mountPage({
      ducks: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Pessoa ${i}` }))
    });
    await sleep(300);

    const lanes = mounted.window.document.getElementById("duckrace-lanes");
    const lane = parseInt(lanes.style.getPropertyValue("--duckrace-lane-h"), 10);

    expect(lane).toBeGreaterThanOrEqual(12);
  });

  it("disables the start button when nobody checked in", async () => {
    mounted = mountPage({ ducks: [] });
    await sleep(200);

    const { window } = mounted;
    expect(window.document.getElementById("duckrace-start-button").disabled).toBe(true);
    expect(window.document.getElementById("duckrace-status").textContent).toContain("Ninguém fez check-in");
  });
});

describe("raffle reset confirmation", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("keeps reset disabled when there is nothing to reset", async () => {
    mounted = mountPage({ ducks: [{ id: 1, name: "Ana" }], winners: [] });
    await sleep(200);

    expect(mounted.window.document.getElementById("duckrace-reset-button").disabled).toBe(true);
  });

  it("requires the exact confirmation word before enabling the reset", async () => {
    mounted = mountPage({
      ducks: [{ id: 1, name: "Ana" }],
      winners: [{ id: 2, name: "Bruno", wonAt: "2026-09-03 20:00:00" }]
    });
    await sleep(200);

    const { window } = mounted;
    const resetButton = window.document.getElementById("duckrace-reset-button");
    expect(resetButton.disabled).toBe(false);

    resetButton.click();
    await sleep(50);

    const input = window.document.getElementById("duckrace-reset-confirmation");
    const confirm = window.document.getElementById("duckrace-reset-confirm-button");

    expect(confirm.disabled).toBe(true);

    input.value = "apagar";
    input.dispatchEvent(new window.Event("input"));
    expect(confirm.disabled).toBe(true);

    input.value = "resetar";
    input.dispatchEvent(new window.Event("input"));
    expect(confirm.disabled).toBe(false);
  });

  it("does not call the reset endpoint while the confirmation is wrong", async () => {
    mounted = mountPage({
      ducks: [{ id: 1, name: "Ana" }],
      winners: [{ id: 2, name: "Bruno", wonAt: "2026-09-03 20:00:00" }]
    });
    await sleep(200);

    const { window } = mounted;
    window.document.getElementById("duckrace-reset-button").click();
    await sleep(50);

    const input = window.document.getElementById("duckrace-reset-confirmation");
    input.value = "qualquer coisa";
    input.dispatchEvent(new window.Event("input"));

    window.document
      .getElementById("duckrace-reset-form")
      .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(100);

    expect(mounted.calls.some((call) => call.includes("duck-race/reset"))).toBe(false);
  });

  it("restores the full field after a confirmed reset", async () => {
    mounted = mountPage({
      ducks: [{ id: 1, name: "Ana" }, { id: 2, name: "Bruno" }],
      winners: [{ id: 3, name: "Carla", wonAt: "2026-09-03 20:00:00" }]
    });
    await sleep(200);

    const { window } = mounted;
    window.document.getElementById("duckrace-reset-button").click();
    await sleep(50);

    const input = window.document.getElementById("duckrace-reset-confirmation");
    input.value = "RESETAR";
    input.dispatchEvent(new window.Event("input"));

    window.document
      .getElementById("duckrace-reset-form")
      .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(200);

    expect(mounted.calls.some((call) => call.includes("duck-race/reset"))).toBe(true);
    expect(window.document.querySelectorAll(".duckrace-winners-list li").length).toBe(0);
  });
});

describe("login feedback follows the site pattern", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("shows the magic link result in the shared modal, not as loose text", async () => {
    mounted = mountPage({ withSession: false });
    await sleep(300);

    const { window } = mounted;
    const modal = window.document.getElementById("subscriptionFeedbackModal");
    expect(modal).not.toBeNull();
    expect(modal.classList.contains("open")).toBe(false);

    window.document.getElementById("login-email").value = "admin@example.com";

    const form = window.document.getElementById("magic-link-form");
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(200);

    expect(modal.classList.contains("open")).toBe(true);
    expect(window.document.getElementById("subscription-feedback-message").textContent).toContain("Link enviado.");
    expect(window.document.getElementById("subscription-feedback-title").textContent).toBe("Tudo certo");
  });

  it("no longer ships a separate raffle page", () => {
    expect(fs.existsSync(path.join(ROOT, "sorteio.html"))).toBe(false);
  });

  it("keeps check-in and raffle on one page, behind one admin check", () => {
    const account = fs.readFileSync(path.join(ROOT, "minhas-inscricoes.html"), "utf8");
    expect(account).toContain('id="admin-checkin-section"');
    expect(account).toContain('id="duckrace-section"');

    expect(account).toMatch(/id="duckrace-section"[^>]*\shidden/);
    expect(account).toMatch(/id="admin-panel"[^>]*\shidden/);

    const subscriptions = fs.readFileSync(path.join(ROOT, "assets", "js", "meetup-subscriptions.js"), "utf8");
    const startCalls = subscriptions.match(/HIBDuckRace\.start\(/g) || [];
    expect(startCalls.length).toBe(1);
    expect(subscriptions).toContain("/api/me/admin-status");
  });
});

