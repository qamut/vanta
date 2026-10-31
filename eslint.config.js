import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "installer/src-tauri", "browser-extension/dist", "node_modules", "release"] },
  {
    files: ["src/**/*.{ts,tsx}", "*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // `invoke<void>` é o tipo idiomático de comando Tauri sem retorno.
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["browser-extension/**/*.js", "scripts/**/*.mjs", "installer/ui/**/*.js", "tests/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, ...globals.node } },
  },
);
