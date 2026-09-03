import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const SORTEIO_SRC = fs.readFileSync(path.join(ROOT, "assets", "js", "sorteio.js"), "utf8");

function readConstant(name) {
  const match = SORTEIO_SRC.match(new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`));
  if (!match) throw new Error(`constant ${name} not found in sorteio.js`);
  return Number(match[1]);
}

const WINNER_MIN_MS = readConstant("WINNER_MIN_MS");
const WINNER_MAX_MS = readConstant("WINNER_MAX_MS");
const OTHER_MIN_MS = readConstant("OTHER_MIN_MS");
const OTHER_MAX_MS = readConstant("OTHER_MAX_MS");
const START_STAGGER_MS = readConstant("START_STAGGER_MS");

function extractFunction(name) {
  const start = SORTEIO_SRC.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in sorteio.js`);

  let depth = 0;
  let seenBrace = false;

  for (let i = start; i < SORTEIO_SRC.length; i += 1) {
    const char = SORTEIO_SRC[i];
    if (char === "{") {
      depth += 1;
      seenBrace = true;
    } else if (char === "}") {
      depth -= 1;
      if (seenBrace && depth === 0) {
        return SORTEIO_SRC.slice(start, i + 1);
      }
    }
  }

  throw new Error(`could not delimit function ${name}`);
}

const raceProgress = new Function(`${extractFunction("raceProgress")}; return raceProgress;`)();
const hashSeed = new Function(`${extractFunction("hashSeed")}; return hashSeed;`)();

function extractEntryShape() {
  const start = SORTEIO_SRC.indexOf("entries.push({");
  const end = SORTEIO_SRC.indexOf("});", start);
  if (start === -1 || end === -1) throw new Error("entry shape not found in animateRace");
  return SORTEIO_SRC.slice(start, end);
}

const ENTRY_SHAPE = extractEntryShape();

function makeEntry(isWinner) {
  return {
    finishTime: isWinner
      ? WINNER_MIN_MS + Math.random() * (WINNER_MAX_MS - WINNER_MIN_MS)
      : OTHER_MIN_MS + Math.random() * (OTHER_MAX_MS - OTHER_MIN_MS),
    startDelay: Math.random() * START_STAGGER_MS,
    surgeAmp: 0.05 + Math.random() * 0.035,
    surgeFreq: 0.5 + Math.random() * 0.3,
    surgePhase: Math.random() * Math.PI * 2,
    rippleAmp: 0.008 + Math.random() * 0.007,
    rippleFreq: 1.2 + Math.random() * 0.5,
    ripplePhase: Math.random() * Math.PI * 2,
    isWinner
  };
}

describe("the tests exercise the shipped implementation", () => {
  it("runs the real raceProgress, not a copy kept in the test file", () => {
    expect(extractFunction("raceProgress")).toContain("envelope");
    expect(typeof raceProgress).toBe("function");
  });

  it("builds entries with every field the real animation assigns", () => {
    const entry = makeEntry(true);
    const fields = ["finishTime", "startDelay", "surgeAmp", "surgeFreq", "surgePhase", "rippleAmp", "rippleFreq", "ripplePhase"];

    for (const field of fields) {
      const assigned = new RegExp(`\\b${field}\\s*[:,]`).test(ENTRY_SHAPE);
      expect(assigned, `animateRace no longer sets ${field}`).toBe(true);
      expect(entry[field], `test entry is missing ${field}`).toBeTypeOf("number");
    }
  });
});

describe("victory glide", () => {
  function readMs(name) {
    return Number(SORTEIO_SRC.match(new RegExp(`const ${name} = (\\d+);`))[1]);
  }

  it("gives the winner a visible moment past the line before the banner", () => {
    expect(readMs("VICTORY_RUN_MS")).toBeGreaterThanOrEqual(3000);
  });

  it("keeps the winner moving the whole time instead of parking early", () => {
    const glideSrc = SORTEIO_SRC.match(/const glide = ([^;]+);/);
    expect(glideSrc, "trecho do deslize nao encontrado").not.toBeNull();

    const glide = new Function("victory", `return ${glideSrc[1]};`);
    const samples = [0, 0.25, 0.5, 0.75, 1].map(glide);

    for (let i = 1; i < samples.length; i += 1) {
      const step = samples[i] - samples[i - 1];
      expect(step, "o pato nao pode parar antes do fim da volta de honra").toBeGreaterThan(0.1);
    }
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBeCloseTo(1, 5);
  });

  it("has water after the line for the whole glide", () => {
    const css = fs.readFileSync(path.join(ROOT, "assets", "css", "style.css"), "utf8");
    const runout = Number(css.match(/--duckrace-runout-w:\s*(\d+)px/)[1]);
    const distance = Number(SORTEIO_SRC.match(/const VICTORY_RUN_PX = (\d+);/)[1]);

    expect(runout).toBeGreaterThanOrEqual(distance);
  });
});

describe("race timing bands", () => {
  it("keeps the winner band strictly faster than the field", () => {
    expect(WINNER_MAX_MS).toBeLessThan(OTHER_MIN_MS);
  });

  it("gives the field enough spread for position changes", () => {
    expect(OTHER_MAX_MS - OTHER_MIN_MS).toBeGreaterThan(2000);
  });
});

describe("race animation guarantees", () => {
  const RACES = 120;
  const FIELD = 10;
  const STEP_MS = 16;

  it("never moves a duck backwards", () => {
    let violations = 0;

    for (let race = 0; race < RACES; race += 1) {
      const entries = [makeEntry(true), ...Array.from({ length: FIELD - 1 }, () => makeEntry(false))];
      for (const entry of entries) {
        let previous = -1;
        for (let t = 0; t <= entry.finishTime; t += STEP_MS) {
          const progress = raceProgress(entry, t);
          if (progress < previous - 1e-9) violations += 1;
          previous = progress;
        }
      }
    }

    expect(violations).toBe(0);
  });

  it("never lets a non-winner reach the line before the drawn winner", () => {
    let violations = 0;

    for (let race = 0; race < RACES; race += 1) {
      const winner = makeEntry(true);
      const others = Array.from({ length: FIELD - 1 }, () => makeEntry(false));

      for (const other of others) {
        if (raceProgress(other, winner.finishTime) >= 1) violations += 1;
      }
    }

    expect(violations).toBe(0);
  });

  it("produces at least one lead change in every race", () => {
    let racesWithOvertaking = 0;

    for (let race = 0; race < RACES; race += 1) {
      const entries = [makeEntry(true), ...Array.from({ length: FIELD - 1 }, () => makeEntry(false))];
      const winnerFinish = entries[0].finishTime;

      let previousOrder = null;
      let sawChange = false;

      for (let t = 500; t < winnerFinish; t += 250) {
        const order = entries
          .map((entry, index) => [index, raceProgress(entry, t)])
          .sort((a, b) => b[1] - a[1])
          .map((pair) => pair[0])
          .join(",");

        if (previousOrder !== null && order !== previousOrder) sawChange = true;
        previousOrder = order;
      }

      if (sawChange) racesWithOvertaking += 1;
    }

    expect(racesWithOvertaking).toBe(RACES);
  });

  it("has every duck exactly at the line at its own finish time", () => {
    for (let race = 0; race < 20; race += 1) {
      const entry = makeEntry(race % 2 === 0);
      expect(raceProgress(entry, entry.finishTime)).toBe(1);
      expect(raceProgress(entry, entry.finishTime - 1)).toBeLessThan(1);
    }
  });
});

describe("duck skin generation", () => {
  const COLORS = SORTEIO_SRC.match(/const DUCK_COLORS = \[([\s\S]*?)\];/)[1]
    .match(/"#[0-9a-fA-F]{6}"/g)
    .map((value) => value.replace(/"/g, ""));
  const COSTUMES = SORTEIO_SRC.match(/const DUCK_COSTUMES = \[([\s\S]*?)\];/)[1]
    .match(/"[a-z-]+"/g)
    .map((value) => value.replace(/"/g, ""));
  const VARIANTS = SORTEIO_SRC.match(/const DUCK_VARIANTS = \[([\s\S]*?)\];/)[1]
    .match(/"[a-z]+"/g)
    .map((value) => value.replace(/"/g, ""));

  function skinFor(id) {
    const seed = hashSeed(id);
    return {
      color: COLORS[seed % COLORS.length],
      costume: COSTUMES[Math.floor(seed / COLORS.length) % COSTUMES.length],
      variant: VARIANTS[Math.floor(seed / (COLORS.length * COSTUMES.length)) % VARIANTS.length]
    };
  }

  it("is deterministic for the same id", () => {
    expect(skinFor(42)).toEqual(skinFor(42));
  });

  it("offers enough combinations for a field of a hundred ducks", () => {
    expect(COLORS.length * COSTUMES.length * VARIANTS.length).toBeGreaterThan(100);
  });

  it("spreads a field of a hundred ducks over many distinct looks", () => {
    const seen = new Set();
    for (let id = 1; id <= 100; id += 1) {
      const skin = skinFor(id);
      seen.add(`${skin.color}|${skin.costume}|${skin.variant}`);
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it("keeps every drawing inside the svg viewBox", () => {
    const start = SORTEIO_SRC.indexOf("function costumeBackMarkup");
    const end = SORTEIO_SRC.indexOf("function buildDuckSvg");
    const region = SORTEIO_SRC.slice(start, end);
    const literals = region.match(/'(?:[^'\\]|\\.)*'/g) || [];

    let checked = 0;
    const outOfRange = [];

    for (const literal of literals) {
      const withoutColors = literal.replace(/#[0-9a-fA-F]{3,8}/g, "");

      for (const pathAttr of withoutColors.match(/\bd="([^"]*)"/g) || []) {
        for (const number of pathAttr.match(/-?\d+(\.\d+)?/g) || []) {
          checked += 1;
          const value = Number(number);
          if (value < -0.5 || value > 64.5) outOfRange.push(`${value} in ${pathAttr}`);
        }
      }

      for (const attr of withoutColors.match(/\b(cx|cy|x1|y1|x2|y2|rx|ry|r|width|height|x|y)="(-?\d+(\.\d+)?)"/g) || []) {
        const value = Number(attr.match(/="(-?\d+(\.\d+)?)"/)[1]);
        const isVertical = /^(cy|y1|y2|y|ry|height)=/.test(attr);
        checked += 1;
        if (value < -0.5 || value > (isVertical ? 48.5 : 64.5)) outOfRange.push(`${value} in ${attr}`);
      }
    }

    expect(checked).toBeGreaterThan(50);
    expect(outOfRange).toEqual([]);
  });
});
