import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",              // relative asset paths so it loads inside the WebView
  build: { outDir: "dist" },
});
