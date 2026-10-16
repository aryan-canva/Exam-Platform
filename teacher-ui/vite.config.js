import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true lets other devices on the network open the teacher UI too.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
});
