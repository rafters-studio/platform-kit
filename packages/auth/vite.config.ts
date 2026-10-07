import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "shared/index": "src/shared/index.ts",
      "server/index": "src/server/index.ts",
      "client/index": "src/client/index.ts",
    },
    dts: {
      generator: "tsgo",
    },
    exports: false,
  },
});
