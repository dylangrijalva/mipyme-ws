import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",
    },
  },
  { files: ["src/contracts/**/*.ts"], rules: { "@typescript-eslint/no-redeclare": "off" } },
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  { files: ["tests/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
]);
