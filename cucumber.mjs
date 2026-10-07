// TypeScript step definitions load through Node's native type stripping, as the rest of the repo runs TypeScript.
export default {
  paths: ["tests/**/*.feature"],
  import: ["tests/**/*.steps.ts"],
  strict: true,
};
