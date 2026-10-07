import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { index: "src/index.ts", stdout: "src/stdout.ts", "send-email": "src/send-email.ts" },
    dts: {
      generator: "tsgo",
    },
    exports: false,
  },
});
