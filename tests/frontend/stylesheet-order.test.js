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
    '.duckrace-lanes[data-density="cozy"]',
    '.duckrace-lanes[data-density="compact"]',
    ".duckrace-finish-label"
  ];

  it.each(overridden)("mobile rule for %s comes after its base rule", (selector) => {
    const base = lineOfBaseRule(selector);
    const mobile = lineOfNestedRule(selector);

    expect(base, `base rule for ${selector} not found`).not.toBeNull();
    expect(mobile, `mobile rule for ${selector} not found`).not.toBeNull();
    expect(mobile).toBeGreaterThan(base);
  });

  it("keeps the finish strip width and the lane margin driven by one variable", () => {
    expect(CSS).toContain("--duckrace-finish-w: 30px");
    expect(CSS).toContain("margin-right: var(--duckrace-finish-w, 30px)");
    expect(CSS).toContain("width: var(--duckrace-finish-w, 30px)");
  });

  it("hides the flash overlay from assistive tech, not just visually", () => {
    const block = CSS.slice(CSS.indexOf(".flash-message {"), CSS.indexOf(".flash-message.is-success"));
    expect(block).toContain("visibility: hidden");
    expect(block).toContain("visibility: visible");
  });
});
