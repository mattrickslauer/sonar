import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // infra/ is a separate CDK package (its own tsconfig, CommonJS Lambdas);
    // it's typechecked + synthesized by its own CI job, not this Next ruleset.
    "infra/**",
  ]),
  {
    // The React Compiler-stage rules in eslint-plugin-react-hooks v6 (bundled
    // with eslint-config-next 16) flag the intentional imperative patterns in
    // the hand-tuned Mapbox layer (refs mirroring latest props, the rAF
    // reconcile, client-only mount init). These are deliberate and correct, so
    // surface them as warnings rather than blocking errors. The classic,
    // high-value hook rules (rules-of-hooks, exhaustive-deps) stay as errors.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
