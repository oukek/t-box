import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  base: "./",
  build: { target: "es2022" },
  server: {
    headers: { "Referrer-Policy": "strict-origin-when-cross-origin" },
    fs: { deny: ["**/.env", "**/.env.*", "**/*.{crt,pem}", "**/.secrets/**"] },
  },
});
