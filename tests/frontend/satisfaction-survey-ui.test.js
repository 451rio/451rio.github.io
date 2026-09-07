import { describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const SURVEY_PAGE = fs.readFileSync(path.join(ROOT, "pesquisa-de-satisfacao.html"), "utf8");
const ACCOUNT_PAGE = fs.readFileSync(path.join(ROOT, "minhas-inscricoes.html"), "utf8");
const FORM_UTILS = fs.readFileSync(path.join(ROOT, "assets", "js", "form-utils.js"), "utf8");
const SURVEY_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "satisfaction-survey.js"), "utf8");
const RESULTS_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "survey-results.js"), "utf8");
const TABS_JS = fs.readFileSync(path.join(ROOT, "assets", "js", "admin-tabs.js"), "utf8");

const QUESTIONS = [
  { key: "preEventCommunication", short: "Comunicação pré-evento", label: "Comunicação?" },
  { key: "organization", short: "Organização", label: "Organização?" },
  { key: "venue", short: "Local", label: "Local?" },
  { key: "techInfrastructure", short: "Infraestrutura tecnológica", label: "Infra?" },
  { key: "talks", short: "Palestras", label: "Palestras?" },
  { key: "coffeeBreak", short: "Coffee-break", label: "Coffee?" },
  { key: "rafflePrizes", short: "Brindes sorteados", label: "Brindes?" },
  { key: "networking", short: "Networking", label: "Networking?" },
  { key: "overallExperience", short: "Experiência geral", label: "Geral?" },
  { key: "expectations", short: "Expectativas", label: "Expectativas?" },
  { key: "recommendation", short: "Indicaria o evento", label: "Indicaria?" }
].map((question) => ({
  ...question,
  options: ["Péssima", "Ruim", "Regular", "Boa", "Excelente"]
}));

function stripLiquid(html) {
  return html
    .replace(/^---[\s\S]*?---\n/, "")
    .replace(/\{%[\s\S]*?%\}/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "#");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(10);
  }
  return condition();
}

function gateOpen(mounted) {
  return () => mounted.window.document.getElementById("survey-form-fields").hidden === false;
}

function renderQuestions(window) {
  const fields = window.document.getElementById("survey-form-fields");
  const openQuestion = fields.querySelector(".survey-question--open");
  for (const stale of fields.querySelectorAll(".survey-question:not(.survey-question--open)")) {
    stale.remove();
  }

  for (const question of QUESTIONS) {
    const fieldset = window.document.createElement("fieldset");
    fieldset.className = "survey-question";

    const legend = window.document.createElement("legend");
    legend.className = "survey-question-legend";
    legend.textContent = question.label;
    fieldset.appendChild(legend);

    const scale = window.document.createElement("div");
    scale.className = "survey-scale";
    question.options.forEach((option, index) => {
      const label = window.document.createElement("label");
      label.className = "survey-option";
      label.dataset.value = String(index + 1);

      const input = window.document.createElement("input");
      input.type = "radio";
      input.name = question.key;
      input.value = String(index + 1);
      input.required = true;

      const value = window.document.createElement("span");
      value.className = "survey-option-value";
      value.textContent = String(index + 1);

      const text = window.document.createElement("span");
      text.className = "survey-option-label";
      text.textContent = option;

      label.append(input, value, text);
      scale.appendChild(label);
    });
    fieldset.appendChild(scale);

    fields.insertBefore(fieldset, openQuestion);
  }
}

function mountSurveyPage() {
  const dom = new JSDOM(`<!doctype html><html><body>${stripLiquid(SURVEY_PAGE)}</body></html>`, {
    url: "https://hackinbrasil.com.br/pesquisa-de-satisfacao/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
  const errors = [];
  const calls = [];
  window.addEventListener("error", (event) => errors.push(event.error || event.message));

  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
  }

  window.fetch = async (url, options) => {
    const target = String(url);
    const method = (options && options.method) || "GET";
    calls.push({ method, target, body: options && options.body ? JSON.parse(options.body) : null });

    if (target.endsWith("/api/captcha")) {
      return { ok: true, status: 200, json: async () => ({ id: "captcha-1", seed: "seed", difficulty: 0 }) };
    }
    if (target.endsWith("/status")) {
      return { ok: true, status: 200, json: async () => ({ title: "Meetup de Teste" }) };
    }
    return { ok: true, status: 201, json: async () => ({ ok: true }) };
  };

  window.HIBSurveyQuestions = QUESTIONS;
  renderQuestions(window);
  window.eval(FORM_UTILS);
  window.eval(SURVEY_JS);

  return { dom, window, calls, errors };
}

function mountAdminResults({ results, meetups } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${stripLiquid(ACCOUNT_PAGE)}</body></html>`, {
    url: "https://hackinbrasil.com.br/minhas-inscricoes/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });

  const { window } = dom;
  const errors = [];
  const calls = [];
  window.addEventListener("error", (event) => errors.push(event.error || event.message));

  window.HIBSurveyQuestions = QUESTIONS;
  window.eval(TABS_JS);
  window.eval(RESULTS_JS);

  window.HIBSurveyResults.start({
    async apiFetch(url) {
      calls.push(url);
      if (url === "/api/admin/meetups") {
        return {
          response: { ok: true, status: 200 },
          data: { meetups: meetups || [{ slug: "meetup-teste", title: "Meetup de Teste" }] }
        };
      }
      return { response: { ok: true, status: 200 }, data: results };
    }
  });

  return { dom, window, calls, errors };
}

function emptyCounts() {
  return [0, 0, 0, 0, 0];
}

function resultsFixture(overrides = {}) {
  return {
    meetup: { slug: "meetup-teste", title: "Meetup de Teste", eventDate: "2026-09-03T19:00:00" },
    totalResponses: 4,
    questions: QUESTIONS.map((question) => ({
      key: question.key,
      counts: question.key === "recommendation" ? [0, 0, 1, 1, 2] : [0, 0, 0, 1, 3],
      average: question.key === "recommendation" ? 4.25 : 4.75
    })),
    comments: [{ text: "Faltou estacionamento", createdAt: "2026-09-04 12:00:00" }],
    ...overrides
  };
}

describe("public satisfaction survey page", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("keeps the questions behind the captcha gate until it resolves", async () => {
    mounted = mountSurveyPage();
    const fields = mounted.window.document.getElementById("survey-form-fields");
    expect(fields.hidden).toBe(true);

    expect(await waitFor(gateOpen(mounted))).toBe(true);
    expect(mounted.errors).toEqual([]);
  });

  it("never asks for name, e-mail or document", () => {
    expect(SURVEY_PAGE).not.toMatch(/type="email"/);
    expect(SURVEY_PAGE).not.toMatch(/name="(name|email|document|phone)"/);
    expect(SURVEY_PAGE).toContain("Anônima");
  });

  it("tracks progress as the questions are answered", async () => {
    mounted = mountSurveyPage();
    await waitFor(gateOpen(mounted));

    const { window } = mounted;
    const label = window.document.getElementById("survey-progress-label");
    const fill = window.document.getElementById("survey-progress-fill");

    const first = window.document.querySelector('input[name="venue"][value="3"]');
    first.checked = true;
    first.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(label.textContent).toBe(`1 de ${QUESTIONS.length} respondidas`);
    expect(fill.style.width).toBe(`${(1 / QUESTIONS.length) * 100}%`);
  });

  it("shows every option label next to its number", () => {
    expect(SURVEY_PAGE).toContain('class="survey-option-label"');
    expect(SURVEY_PAGE).toContain("{{ option }}");
  });

  it("refuses to submit while a question is unanswered and says which one", async () => {
    mounted = mountSurveyPage();
    await waitFor(gateOpen(mounted));

    const { window } = mounted;
    window.document.querySelector('input[name="organization"][value="4"]').checked = true;
    window.document.getElementById("survey-form").dispatchEvent(new window.Event("submit"));
    await waitFor(() => window.document.getElementById("survey-feedback-message").textContent !== "");

    expect(mounted.calls.some((call) => call.target.endsWith("/survey"))).toBe(false);
    const message = window.document.getElementById("survey-feedback-message").textContent;
    expect(message).toContain("Comunicação pré-evento");
    expect(message).not.toContain("Organização");
  });

  it("sends every answer on the 1-5 scale plus the optional comment", async () => {
    mounted = mountSurveyPage();
    await waitFor(gateOpen(mounted));

    const { window } = mounted;
    for (const question of QUESTIONS) {
      window.document.querySelector(`input[name="${question.key}"][value="5"]`).checked = true;
    }
    window.document.querySelector('input[name="coffeeBreak"][value="5"]').checked = false;
    window.document.querySelector('input[name="coffeeBreak"][value="2"]').checked = true;
    window.document.getElementById("survey-comments").value = "  Muito bom  ";

    window.document.getElementById("survey-form").dispatchEvent(new window.Event("submit"));
    await waitFor(() => mounted.calls.some((call) => call.target.endsWith("/survey")));

    const submission = mounted.calls.find((call) => call.target.endsWith("/survey"));
    expect(submission.method).toBe("POST");
    expect(submission.target).toContain("/api/meetups/meetup-03-09-2026/survey");
    expect(submission.body.preEventCommunication).toBe(5);
    expect(submission.body.coffeeBreak).toBe(2);
    expect(submission.body.comments).toBe("Muito bom");
    expect(submission.body.captchaId).toBe("captcha-1");
  });

  it("hides the form after a successful answer so nobody sends it twice by accident", async () => {
    mounted = mountSurveyPage();
    await waitFor(gateOpen(mounted));

    const { window } = mounted;
    for (const question of QUESTIONS) {
      window.document.querySelector(`input[name="${question.key}"][value="4"]`).checked = true;
    }
    window.document.getElementById("survey-form").dispatchEvent(new window.Event("submit"));
    await waitFor(() => window.document.getElementById("survey-form-fields").hidden === true);

    expect(window.document.getElementById("survey-form-fields").hidden).toBe(true);
    expect(window.document.getElementById("surveyFeedbackModal").classList.contains("is-success")).toBe(true);
  });
});

describe("survey results in the organisation panel", () => {
  let mounted;

  afterEach(() => {
    if (mounted) mounted.dom.window.close();
    mounted = null;
  });

  it("shows one tab per admin tool and opens only the selected one", () => {
    mounted = mountAdminResults({ results: resultsFixture() });
    const { window } = mounted;

    const tabs = Array.from(window.document.querySelectorAll(".admin-tab"));
    expect(tabs.map((tab) => tab.dataset.tab)).toEqual(["checkin", "duckrace", "manage", "survey"]);

    const panels = Array.from(window.document.querySelectorAll(".admin-tabpanel"));
    expect(panels.filter((panel) => !panel.hidden).length).toBe(1);

    window.HIBAdminTabs.select("survey");
    const open = panels.filter((panel) => !panel.hidden);
    expect(open.length).toBe(1);
    expect(open[0].dataset.tab).toBe("survey");
  });

  it("summarises the answers and charts every question", async () => {
    mounted = mountAdminResults({ results: resultsFixture() });
    await waitFor(() => mounted.window.document.querySelectorAll(".survey-stat-value").length > 0);

    const { window } = mounted;
    const stats = Array.from(window.document.querySelectorAll(".survey-stat-value")).map(
      (node) => node.textContent
    );
    expect(stats[0]).toBe("4");
    expect(stats[1]).toBe("4,7 / 5");
    expect(stats[2]).toBe("75%");

    expect(window.document.querySelectorAll(".survey-chart-card").length).toBe(QUESTIONS.length + 1);
    expect(window.document.querySelectorAll(".survey-ranking-row").length).toBe(QUESTIONS.length);

    const firstQuestionCard = window.document.querySelectorAll(".survey-chart-card")[1];
    expect(firstQuestionCard.querySelectorAll(".survey-bar-segment").length).toBe(2);
    expect(firstQuestionCard.querySelectorAll(".survey-legend-item").length).toBe(5);
    expect(mounted.errors).toEqual([]);
  });

  it("lists the free-text comments as text, never as markup", async () => {
    mounted = mountAdminResults({
      results: resultsFixture({
        comments: [{ text: "<img src=x onerror=alert(1)>", createdAt: "2026-09-04 12:00:00" }]
      })
    });
    await waitFor(() => mounted.window.document.querySelector(".survey-comment-text") !== null);

    const { window } = mounted;
    const comment = window.document.querySelector(".survey-comment-text");
    expect(comment.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(window.document.querySelectorAll(".survey-comment img").length).toBe(0);
  });

  it("says plainly when a meetup has no answers yet", async () => {
    mounted = mountAdminResults({
      results: resultsFixture({
        totalResponses: 0,
        comments: [],
        questions: QUESTIONS.map((question) => ({
          key: question.key,
          counts: emptyCounts(),
          average: null
        }))
      })
    });
    await waitFor(() =>
      mounted.window.document.getElementById("survey-results-status").textContent.includes("Nenhuma resposta")
    );

    const { window } = mounted;
    expect(window.document.getElementById("survey-results-status").textContent).toContain("Nenhuma resposta");
    expect(window.document.querySelectorAll(".survey-chart-card").length).toBe(0);
    expect(window.document.getElementById("survey-results-comments-section").hidden).toBe(true);
  });
});
