import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { PLANS, planPrice } from "./src/lib/types";

const SITE = "https://mathsprint.org";
const PLANS_TITLE = "MathSprint plans and pricing: Free, Pro and Pro Max";
const PLANS_DESCRIPTION =
  "Compare MathSprint plans: Free for 5 decks with no card, Pro at $5 a month for 50 decks and student groups, and Pro Max at $10 a month for 100 decks.";

/** The company, for every page's JSON-LD. sameAs lists only profiles MathSprint owns: add more as they're set up
 * (keep the copies in the static pages in web/public in step). */
const ORG = {
  "@type": "Organization",
  "@id": `${SITE}/#org`,
  name: "MathSprint",
  url: SITE,
  logo: `${SITE}/logo.png`,
  email: "team@mathsprint.org",
  sameAs: ["https://www.youtube.com/@mathsprint_go"],
};
const jsonLd = (graph: object[]) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;

/** Links every crawler-readable page carries in its body, so no page is reached only through the sitemap. */
const RELATED =
  `<h2>More from MathSprint</h2><ul>` +
  `<li><a href="/tutors">MathSprint for tutors</a>: assign a deck as a test and see each student's time on every question.</li>` +
  `<li><a href="/parents">MathSprint for parents</a>: a practice test on what's coming up, and the topics that still need work.</li>` +
  `<li><a href="/vs/worksheets">MathSprint vs hand-written worksheets</a>: when paper still wins, and when a checked deck saves prep time.</li>` +
  `<li><a href="/about">About MathSprint</a>: who we are, and how a math engine checks every answer.</li>` +
  `</ul>`;

/** The home page as plain HTML inside #root, for search engines. React replaces it on load, and its heading is the
 * sign-in page's own, so the swap doesn't jar. */
const HOME =
  `<main class="wrap" style="max-width:640px;padding-top:10vh"><div class="stack">` +
  `<h1>Timed math practice for high school and college students.</h1>` +
  `<p>MathSprint is a timed math practice app that builds a practice deck with worked solutions in about a minute.</p>` +
  `<p>Type a topic like "related rates, AP Calc AB" or upload a worksheet. A separate math engine solves every question again before you see it.</p>` +
  `<p>It covers Algebra 1 through AP Calculus and college math, SAT and ACT prep, and subjects like physics and chemistry.</p>` +
  `<p>Your first 5 decks are free, with no card needed. Pro is $5 a month, and Pro Max is $10 a month (<a href="/plans">compare plans</a>).</p>` +
  RELATED +
  `</div></main>`;

/** The plan table as plain HTML inside #root of /plans, for search engines (React replaces it on load). */
function plansTable() {
  const [free, pro, promax] = PLANS;
  return (
    `<main style="max-width:820px;margin:0 auto;padding:32px 20px"><h1>Compare plans</h1>` +
    `<p>MathSprint is a timed math practice app, and every plan gets the same checked answers and worked solutions.</p>` +
    `<p>${free.label} costs $0 and gives you ${free.decks} decks of up to ${free.questions} questions each, with no card needed.</p>` +
    `<p>${pro.label} costs $${pro.usdPerMonth} a month for ${pro.decks} decks, plus student groups and tests you assign to them.</p>` +
    `<p>${promax.label} costs $${promax.usdPerMonth} a month for ${promax.decks} decks of up to ${promax.questions} questions each.</p>` +
    `<table><thead><tr><th></th>${PLANS.map((p) => `<th>${p.label}</th>`).join("")}</tr></thead><tbody>` +
    `<tr><th>Price</th>${PLANS.map((p) => `<td>${planPrice(p.usdPerMonth)}</td>`).join("")}</tr>` +
    `<tr><th>Decks you can build</th>${PLANS.map((p) => `<td>${p.decks}</td>`).join("")}</tr>` +
    `<tr><th>Questions per deck</th>${PLANS.map((p) => `<td>${p.questions}</td>`).join("")}</tr>` +
    `<tr><th>Every answer checked by a math engine</th><td>Yes</td><td>Yes</td><td>Yes</td></tr>` +
    `<tr><th>Student groups and assigned tests</th><td>No</td><td>Yes</td><td>Yes</td></tr>` +
    `</tbody></table>` +
    `<p>Payments go through Square, and the Free plan never asks for a card. <a href="/">Build your first deck free</a>.</p>` +
    RELATED +
    `</main>`
  );
}

function plansJsonLd() {
  return jsonLd([
    ORG,
    {
      "@type": "Product",
      name: "MathSprint",
      url: `${SITE}/plans`,
      image: `${SITE}/og-image.png`,
      description: "Timed math practice decks with worked solutions. A math engine (SymPy) checks every answer before students see it.",
      brand: { "@id": `${SITE}/#org` },
      offers: PLANS.map((p) => ({
        "@type": "Offer",
        name: p.label,
        price: String(p.usdPerMonth),
        priceCurrency: "USD",
        description: `${p.decks} decks, up to ${p.questions} questions each`,
        url: `${SITE}/plans`,
        ...(p.usdPerMonth
          ? { priceSpecification: { "@type": "UnitPriceSpecification", price: String(p.usdPerMonth), priceCurrency: "USD", unitText: "month" } }
          : {}),
      })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "MathSprint", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Plans and pricing", item: `${SITE}/plans` },
      ],
    },
  ]);
}

function homeJsonLd() {
  return jsonLd([
    ORG,
    { "@type": "WebSite", "@id": `${SITE}/#site`, name: "MathSprint", url: `${SITE}/`, publisher: { "@id": `${SITE}/#org` } },
    {
      "@type": "SoftwareApplication",
      name: "MathSprint",
      url: `${SITE}/`,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      description: "Timed math practice decks with worked solutions, built in about a minute. A math engine checks every answer.",
      publisher: { "@id": `${SITE}/#org` },
      offers: PLANS.map((p) => ({ "@type": "Offer", name: p.label, price: String(p.usdPerMonth), priceCurrency: "USD" })),
    },
  ]);
}

/** One page made from the app shell: its own title, description, canonical, JSON-LD and crawler-readable content. */
function page(shell: string, o: { title?: string; description?: string; url: string; head: string; body: string }) {
  let html = shell;
  if (o.title) {
    html = html
      .replace(/<title>[^<]*<\/title>/, () => `<title>${o.title}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*"/, (_, start) => `${start}${o.title}"`);
  }
  if (o.description) {
    html = html
      .replace(/(<meta name="description" content=")[^"]*"/, (_, start) => `${start}${o.description}"`)
      .replace(/(<meta property="og:description" content=")[^"]*"/, (_, start) => `${start}${o.description}"`);
  }
  return html
    .replace("</head>", () => `  <link rel="canonical" href="${o.url}" />\n    <meta property="og:url" content="${o.url}" />\n    ${o.head}\n  </head>`)
    .replace('<div id="root"></div>', () => `<div id="root">${o.body}</div>`);
}

/** After the build, dist/index.html is the plain app shell. This keeps that shell as app.html (served for every app
 * route in firebase.json, and read by the share-preview functions), and rewrites index.html as the home page and
 * plans.html as /plans, each with crawler-readable content. */
function sitePages(): Plugin {
  return {
    name: "site-pages",
    apply: "build",
    enforce: "post",
    writeBundle(options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") return;
      const shell = String(index.source);
      const dir = options.dir ?? "dist";
      writeFileSync(join(dir, "app.html"), shell);
      writeFileSync(join(dir, "index.html"), page(shell, { url: `${SITE}/`, head: homeJsonLd(), body: HOME }));
      writeFileSync(
        join(dir, "plans.html"),
        page(shell, { title: PLANS_TITLE, description: PLANS_DESCRIPTION, url: `${SITE}/plans`, head: plansJsonLd(), body: plansTable() }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), sitePages()],
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
