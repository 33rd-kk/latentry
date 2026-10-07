import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Unused args are often the documented shape of a callback.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Generated images are data: URLs and gallery files are served by our own
      // route; next/image would only add a second resize on top.
      "@next/next/no-img-element": "off",
    },
  },
  {
    // lib/image-meta is kept free of the app so it can become its own package:
    // node's built-ins and its own files only (see its README.md).
    files: ["lib/image-meta/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^(?!node:|\\./)", message: "lib/image-meta imports only node: built-ins and its own files." }] },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    // Builds of a second dev server (LATENTRY_DIST_DIR) and agent worktrees.
    ".next-*/**",
    ".claude/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
    ".runtime/**",
    "models/**",
    "output/**",
  ]),
]);

export default eslintConfig;
