import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, send API calls to the server so the browser sees a single origin (no CORS).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/runs": "http://localhost:3001" } },
});
