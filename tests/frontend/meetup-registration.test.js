import { describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const PAGE_HTML = fs.readFileSync(path.join(ROOT, "meetup-03-09-2026.html"), "utf8");
const FORM_UTILS = fs.readFileSync(path.join(ROOT, "assets", "js", "form-utils.js"), "utf8");
const MAIN_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "main.js"), "utf8");
const REGISTRATION_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "meetup-registration.js"), "utf8");

function stripLiquid(html) {
  return html
    .replace(/^---[\s\S]*?---\n/, "")
    .replace(/\{%[\s\S]*?%\}/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "#");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountMeetup(status) {
  const dom = new JSDOM(`<!doctype html><html><body>${stripLiquid(PAGE_HTML)}</body></html>`, {
    url: "https://hackinbrasil.com.br/meetup-03-09-2026/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
  }

  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.error || event.message));

  window.fetch = async (url) => {
    const target = String(url);
    const reply = (body) => ({ ok: true, status: 200, json: async () => body });

    if (target.includes("/api/captcha")) return reply({ id: "c", seed: "s", difficulty: 0 });
    if (target.includes("/status")) return reply(status);
    return reply({});
  };

  window.eval(FORM_UTILS);
  window.HIBForms.createCaptcha = function () {
    return { render: async () => {}, getToken: () => "c", getAnswer: () => "0", ready: () => true };
  };
  window.eval(MAIN_JS);
  window.eval(REGISTRATION_JS);

  return { dom, window, errors };
}

function fields(window) {
  return window.document.getElementById("reg-form-fields");
}

describe("closed meetup hides the registration area", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("hides the form when the API says registrations are closed", async () => {
    mounted = mountMeetup({
      slug: "meetup-03-09-2026",
      title: "Meetup",
      eventDate: "2090-09-03T18:50:00-03:00",
      isOpen: false,
      isFull: true
    });
    await sleep(250);

    expect(fields(mounted.window).hidden).toBe(true);
    expect(mounted.errors).toEqual([]);
  });

  it("says the registrations are closed instead of promising a next batch", async () => {
    mounted = mountMeetup({
      slug: "meetup-03-09-2026",
      title: "Meetup",
      eventDate: "2090-09-03T18:50:00-03:00",
      isOpen: false,
      isFull: true
    });
    await sleep(250);

    const status = mounted.window.document.getElementById("registration-status").textContent;
    expect(status).toMatch(/encerradas/i);
    expect(status).not.toMatch(/lote/i);
  });

  it("keeps the form open while the meetup still accepts people", async () => {
    mounted = mountMeetup({
      slug: "meetup-03-09-2026",
      title: "Meetup",
      eventDate: "2090-09-03T18:50:00-03:00",
      isOpen: true,
      isFull: false
    });
    await sleep(250);

    expect(fields(mounted.window).hidden).toBe(false);
    expect(mounted.window.document.getElementById("registration-submit").disabled).toBe(false);
  });

  it("still offers the next-batch message when it is only full, not closed", async () => {
    mounted = mountMeetup({
      slug: "meetup-03-09-2026",
      title: "Meetup",
      eventDate: "2090-09-03T18:50:00-03:00",
      isOpen: true,
      isFull: true
    });
    await sleep(250);

    const status = mounted.window.document.getElementById("registration-status").textContent;
    expect(status).toMatch(/lote/i);
    expect(mounted.window.document.getElementById("registration-submit").disabled).toBe(true);
  });

  it("never re-opens the form after the captcha finishes on a closed meetup", async () => {
    mounted = mountMeetup({
      slug: "meetup-03-09-2026",
      title: "Meetup",
      eventDate: "2090-09-03T18:50:00-03:00",
      isOpen: false,
      isFull: true
    });
    await sleep(600);

    expect(fields(mounted.window).hidden).toBe(true);
  });
});
