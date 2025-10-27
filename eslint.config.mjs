// provides ESLint’s built-in recommended JavaScript rules.
import js from "@eslint/js";
// provides JSDOC rules
import jsdoc from "eslint-plugin-jsdoc";
// Provides a config that turns off all rules that are unnecessary or might conflict with
import prettier from "eslint-config-prettier/flat";
// gives predefined global variables (e.g. window, document) for different environments.
import globals from "globals";
// enables TypeScript parsing and rules.
import tseslint from "typescript-eslint";
// helper for type-safe config definition.
import { defineConfig } from "eslint/config";

export default defineConfig([
  // ESLin built-in and recommended rules
  {
    // which files the rules apply to.
    files: ["**/*.{js,ts}"],
    // loads the @eslint/js plugin so we can use its pre-made configs, such as js/recommended.
    plugins: { js },
    // enables all rules marked as recommended on https://eslint.org/docs/latest/rules
    extends: ["js/recommended"],
    rules: {
      /** possible logic errors */
      "no-unused-vars": "warn",
      "no-promise-executor-return": "warn",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      "no-unmodified-loop-condition": "warn",
      "no-useless-assignment": "error",
      "require-atomic-updates": "error",
    },
    // tell ESLint not to flag built-in Node globals (e.g., process, __dirname) as undefined.
    languageOptions: { globals: globals.node },
  },
  // JSDOC rules
  {
    ...jsdoc.configs["flat/recommended-typescript"],
    files: ["**/*.{js,ts}"],
    rules: {
      // Warns when the specified kinds of declarations lack a JSDoc comment.
      "jsdoc/require-jsdoc": [
        "warn",
        {
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "FunctionDeclaration",
            // ensure every property in RemoteRunnerConfig carries JSDoc, inline style
            {
              context: "TSInterfaceDeclaration > TSInterfaceBody > TSPropertySignature",
            },
          ],
        },
      ],
      "jsdoc/require-param": [
        "warn",
        {
          // only require the root destructured object, not each property
          checkDestructured: false,
          checkDestructuredRoots: true,
        },
      ],
      "jsdoc/require-returns": "warn",
      "jsdoc/multiline-blocks": [
        "warn",
        {
          // collapse empty comments to a one-liner
          requireSingleLineUnderCount: 80,
          noSingleLineBlocks: false,
        },
      ],
      "jsdoc/no-blank-blocks": "warn",
    },
  },
  // merges in TypeScript-specific parsing and rule recommendations from
  ...tseslint.configs.recommended,
  prettier,
]);
