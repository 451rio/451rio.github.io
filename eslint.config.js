import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "_site/**",
      "node_modules/**",
      "assets/js/vendor/**",
      "workers/meetup-api/node_modules/**",
      "workers/meetup-api/.wrangler/**",
      "workers/meetup-api/src/certificate-assets.js"
    ]
  },
  js.configs.recommended,
  {
    files: ["assets/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        HIBForms: "readonly",
        HIBFlash: "writable",
        jsQR: "readonly",
        qrcode: "readonly"
      }
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-implicit-globals": "error",
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["workers/meetup-api/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.worker,
        crypto: "readonly",
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly"
      }
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off"
    }
  },
  {
    files: ["tests/**/*.js", "eslint.config.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  }
];
