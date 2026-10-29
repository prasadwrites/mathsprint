import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { PLANS, planPrice } from "./src/lib/types";

const PLANS_TITLE = "MathSprint plans and pricing: timed practice decks for tutors";
const PLANS_DESCRIPTION =
  "Free for 5 decks with no card needed, Pro $5 a month for 50 decks plus student groups and assigned tests, Pro Max $10 a month for 100 decks. Every answer checked.";

/** Writes dist/plans.html: the app's index.html with its own title and description, and the plan table as plain HTML
 * inside #root for search engines (React replaces it on load). firebase.json serves it at /plans. */
function plansPage(): Plugin {
  const table =
    `<main style="max-width:820px;margin:0 auto;padding:32px 20px"><h1>Compare plans</h1>` +
    `<table><thead><tr><th></th>${PLANS.map((p) => `<th>${p.label}</th>`).join("")}</tr></thead><tbody>` +
    `<tr><th>Price</th>${PLANS.map((p) => `<td>${planPrice(p.usdPerMonth)}</td>`).join("")}</tr>` +
    `<tr><th>Decks you can build</th>${PLANS.map((p) => `<td>${p.decks}</td>`).join("")}</tr>` +
    `<tr><th>Questions per deck</th>${PLANS.map((p) => `<td>${p.questions}</td>`).join("")}</tr>` +
    `<tr><th>Every answer checked by a math engine</th><td>Yes</td><td>Yes</td><td>Yes</td></tr>` +
    `<tr><th>Student groups and assigned tests</th><td>No</td><td>Yes</td><td>Yes</td></tr>` +
    `</tbody></table><p>Free needs no card. Payments by Square. <a href="/">Start free</a></p></main>`;
  return {
    name: "plans-page",
    apply: "build",
    enforce: "post",
    writeBundle(options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") return;
      const html = String(index.source)
        .replace(/<title>[^<]*<\/title>/, () => `<title>${PLANS_TITLE}</title>\n    <link rel="canonical" href="https://mathsprint.org/plans" />`)
        .replace(/(<meta name="description" content=")[^"]*"/, (_, start) => `${start}${PLANS_DESCRIPTION}"`)
        .replace(/(<meta property="og:title" content=")[^"]*"/, (_, start) => `${start}${PLANS_TITLE}"`)
        .replace(/(<meta property="og:description" content=")[^"]*"/, (_, start) => `${start}${PLANS_DESCRIPTION}"`)
        .replace('<div id="root"></div>', `<div id="root">${table}</div>`);
      writeFileSync(join(options.dir ?? "dist", "plans.html"), html);
    },
  };
}

export default defineConfig({
  plugins: [react(), plansPage()],
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
