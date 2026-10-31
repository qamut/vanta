import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Duas janelas, duas entradas: a cápsula e as configurações não partilham bundle de UI.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "island.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
