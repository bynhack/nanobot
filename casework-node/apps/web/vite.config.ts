import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8081",
      "/sessions": "http://127.0.0.1:8081",
      "/uploads": "http://127.0.0.1:8081",
      "/media": "http://127.0.0.1:8081",
      "/ws": { target: "ws://127.0.0.1:8081", ws: true },
    },
  },
  test: {
    environment: "node",
  },
});
