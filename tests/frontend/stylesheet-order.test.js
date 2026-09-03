import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, "..", "..", "assets", "css", "style.css"), "utf8");

function lineOfBaseRule(selector) {
  const lines = CSS.split("\n");
  const index = lines.findIndex((line) => line.trimEnd() === `${selector} {`);
  return index === -1 ? null : index + 1;
}

function lineOfNestedRule(selector) {
  const lines = CSS.split("\n");
  const index = lines.findIndex((line) => line.trimEnd() === `  ${selector} {`);
  return index === -1 ? null : index + 1;
}

describe("responsive overrides actually win the cascade", () => {
  const overridden = [
    ".duckrace-pond",
    ".duckrace-lanes",
    ".duckrace-finish-label"
  ];

  it.each(overridden)("mobile rule for %s comes after its base rule", (selector) => {
    const base = lineOfBaseRule(selector);
    const mobile = lineOfNestedRule(selector);

    expect(base, `base rule for ${selector} not found`).not.toBeNull();
    expect(mobile, `mobile rule for ${selector} not found`).not.toBeNull();
    expect(mobile).toBeGreaterThan(base);
  });

  it("leaves open water after the finish line for the winner to swim into", () => {
    const pond = CSS.slice(CSS.indexOf(".duckrace-pond {"), CSS.indexOf(".duckrace-lanes {"));
    expect(pond).toMatch(/--duckrace-finish-w:\s*\d+px/);
    expect(pond).toMatch(/--duckrace-runout-w:\s*\d+px/);

    expect(CSS).toContain("margin-right: calc(var(--duckrace-finish-w, 20px) + var(--duckrace-runout-w, 64px))");
    expect(CSS).toContain("right: var(--duckrace-runout-w, 64px)");
  });

  it("keeps every duck in the water: the shore is a fixed strip, not a percentage", () => {
    const pond = CSS.slice(CSS.indexOf(".duckrace-pond {"), CSS.indexOf(".duckrace-lanes {"));

    expect(pond).toContain("--duckrace-shore-h");
    expect(pond).toContain("padding-top: calc(var(--duckrace-shore-h)");

    const gradient = pond.slice(pond.indexOf("linear-gradient(180deg,\n"), pond.indexOf("overflow"));
    const waterStart = gradient.match(/#3a7ca5\s+([\d.]+)(px|%)/i);

    expect(waterStart, "cor da agua nao encontrada no cenario").not.toBeNull();
    expect(
      waterStart[2],
      "a linha d'agua precisa ser um deslocamento fixo; em % ela desce conforme o lago cresce e os primeiros patos nascem na grama"
    ).toBe("px");

    const shoreHeight = Number(pond.match(/--duckrace-shore-h:\s*(\d+)px/)[1]);
    expect(Number(waterStart[1])).toBe(shoreHeight);
  });

  it("hides the flash overlay from assistive tech, not just visually", () => {
    const block = CSS.slice(CSS.indexOf(".flash-message {"), CSS.indexOf(".flash-message.is-success"));
    expect(block).toContain("visibility: hidden");
    expect(block).toContain("visibility: visible");
  });
});
