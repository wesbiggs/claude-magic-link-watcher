import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // Target files
    files: ["**/*.js", "claude-magic-link-watcher"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]
