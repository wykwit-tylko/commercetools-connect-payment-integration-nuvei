import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "NuveiEnabler",
      fileName: "index",
      formats: ["es", "umd"],
    },
    rollupOptions: {
      output: {
        globals: {},
      },
    },
  },
});
