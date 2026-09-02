import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["workers/meetup-api/src/**/*.js"],
      exclude: ["workers/meetup-api/src/certificate-assets.js"],
      thresholds: {
        statements: 88,
        functions: 92,
        branches: 70
      }
    }
  }
});
