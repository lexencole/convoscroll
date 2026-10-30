import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// `vite build --mode cli` builds only the headless render page used by the
// command line into dist-cli/, so it never ships with the website.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  ...(mode === "cli"
    ? {
        build: {
          outDir: "dist-cli",
          emptyOutDir: true,
          rollupOptions: { input: "render.html" },
        },
      }
    : {}),
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    // Command-line tests drive a real browser through `npm run test:cli`.
    exclude: [...configDefaults.exclude, "cli/**", "output/**"],
  },
}));
