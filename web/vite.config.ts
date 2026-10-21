import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In production Hosting sends /c/** to the challenge_page function; this does the same for the score card
    // pictures when running against the emulators.
    proxy: {
      "^/c/[^/]+/card\\.png": {
        target: "http://127.0.0.1:5001",
        rewrite: (path) => `/demo-mathsprint/us-central1/challenge_page${path}`,
      },
    },
  },
  test: { environment: "node" },
});
