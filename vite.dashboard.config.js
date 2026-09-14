import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  root: "dashboard",
  publicDir: "../assets",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022"
  }
});
