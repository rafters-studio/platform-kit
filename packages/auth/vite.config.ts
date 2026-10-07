import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "shared/index": "src/shared/index.ts",
      "server/index": "src/server/index.ts",
      "client/index": "src/client/index.ts",
      "migrations/install": "src/migrations/install.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: false,
  },
});
