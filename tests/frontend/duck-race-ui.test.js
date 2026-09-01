import { describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const PAGE_HTML = fs.readFileSync(path.join(ROOT, "sorteio.html"), "utf8");
const FORM_UTILS = fs.readFileSync(path.join(ROOT, "assets", "js", "form-utils.js"), "utf8");
const MAIN_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "main.js"), "utf8");
const SORTEIO_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "sorteio.js"), "utf8");

function stripFrontMatter(html) {
  return html.replace(/^---[\s\S]*?---\n/, "").replace(/\{\{[\s\S]*?\}\}/g, "#").replace(/\{%[\s\S]*?%\}/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountPage({ isAdmin = true, ducks = [], winners = [] } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${stripFrontMatter(PAGE_HTML)}</body></html>`, {
    url: "https://hackinbrasil.com.br/sorteio/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
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

  window.sessionStorage.setItem("hib.subscriptions.session", "session-token");
  window.eval(FORM_UTILS);
  window.eval(MAIN_JS);
  window.eval(SORTEIO_JS);

  return { dom, window, errors, calls };
}

describe("duck race page gating", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("shows the access denied card for a non-admin session", async () => {
    mounted = mountPage({ isAdmin: false });
    await sleep(200);

    const { window } = mounted;
    expect(window.document.getElementById("duckrace-denied-section").hidden).toBe(false);
    expect(window.document.getElementById("duckrace-main-section").hidden).toBe(true);
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
    expect(window.document.getElementById("duckrace-main-section").hidden).toBe(false);
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

  it("switches to the compact density tier for a large field", async () => {
    mounted = mountPage({
      ducks: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Pessoa ${i}` }))
    });
    await sleep(300);

    const lanes = mounted.window.document.getElementById("duckrace-lanes");
    expect(lanes.dataset.density).toBe("compact");
    expect(mounted.window.document.querySelectorAll(".duckrace-lane").length).toBe(60);
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

describe("session handling", () => {
  it("ignores a malformed token in the URL instead of sending it to the API", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>${stripFrontMatter(PAGE_HTML)}</body></html>`, {
      url: "https://hackinbrasil.com.br/sorteio/?token=<script>alert(1)</script>",
      runScripts: "outside-only",
      pretendToBeVisual: true
    });

    const calls = [];
    dom.window.fetch = async (url) => {
      calls.push(String(url));
      return { ok: false, status: 401, json: async () => ({}) };
    };

    dom.window.eval(FORM_UTILS);
    dom.window.eval(MAIN_JS);
    dom.window.eval(SORTEIO_JS);
    await sleep(150);

    expect(calls.some((call) => call.includes("/api/auth/session"))).toBe(false);
    expect(dom.window.location.search).not.toContain("token=");
    dom.window.close();
  });
});
