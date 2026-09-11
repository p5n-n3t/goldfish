export interface DashboardMetrics {
  memoryRecords: number;
  projects: number;
  agents: number;
  imports: number;
}

const unavailableCards = [
  {
    label: "Memory records",
    state: "Unavailable",
    detail: "A live record count requires an authenticated project query."
  },
  {
    label: "Projects",
    state: "Unavailable",
    detail: "Project membership has not been exposed to the dashboard."
  },
  {
    label: "Agents",
    state: "Unavailable",
    detail: "No authenticated agent registry is connected."
  },
  {
    label: "Recent activity",
    state: "Unavailable",
    detail: "Activity events are not collected by this baseline."
  }
] as const;

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function dashboardCard(label: string, state: string, detail: string): string {
  return `<article class="card"><p class="eyebrow">${escapeHtml(label)}</p><p class="state">${escapeHtml(state)}</p><p class="detail">${escapeHtml(detail)}</p></article>`;
}

/**
 * Returns the dashboard shell. The Worker supplies aggregate D1 counts; this
 * renderer never invents metrics when a binding is unavailable.
 */
export function renderDashboard(metrics?: DashboardMetrics): string {
  const cards = metrics ? [
    { label: "Memory records", state: metrics.memoryRecords.toLocaleString(), detail: "Live canonical-record total from D1." },
    { label: "Projects", state: metrics.projects.toLocaleString(), detail: "Live project total from D1." },
    { label: "Agents", state: metrics.agents.toLocaleString(), detail: "Live agent total from D1." },
    { label: "Imports", state: metrics.imports.toLocaleString(), detail: "Live import-ledger total from D1." }
  ] : unavailableCards;
  const statusCards = cards.map(({ label, state, detail }) => dashboardCard(label, state, detail)).join("");
  const notice = metrics
    ? "<aside class=\"notice\"><strong>Live data.</strong> Counts are read from the Goldfish D1 ledger and refresh on every page load.</aside>"
    : "<aside class=\"notice\"><strong>Dashboard data is unavailable.</strong> Authentication and dashboard data sources have not been configured in this Worker baseline.</aside>";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Goldfish project memory service dashboard">
  <title>Goldfish · Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #eef2ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; background: radial-gradient(circle at top right, #1d3159 0, transparent 38rem), #0b1020; }
    main { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; padding: 3.5rem 0 4rem; }
    .brand { display: inline-flex; gap: .55rem; align-items: center; color: #a5b4fc; font-size: .9rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .brand::before { content: ""; width: .65rem; height: .65rem; border-radius: 999px; background: #7dd3fc; box-shadow: 0 0 1.25rem #7dd3fc; }
    h1 { max-width: 42rem; margin: 1rem 0 .8rem; font-size: clamp(2.15rem, 6vw, 4.5rem); line-height: 1.02; letter-spacing: -.055em; }
    .lede { max-width: 44rem; margin: 0; color: #cbd5e1; font-size: clamp(1rem, 2vw, 1.17rem); line-height: 1.65; }
    .notice { margin: 2.25rem 0; padding: 1rem 1.1rem; border: 1px solid #3b4a69; border-radius: .85rem; background: rgba(15, 23, 42, .7); color: #dbeafe; line-height: 1.5; }
    .notice strong { color: #f8fafc; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
    .card { min-height: 11.75rem; padding: 1.25rem; border: 1px solid #2b3957; border-radius: 1rem; background: rgba(15, 23, 42, .78); }
    .eyebrow { margin: 0; color: #94a3b8; font-size: .8rem; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
    .state { margin: 1rem 0 .75rem; color: #f8fafc; font-size: 1.5rem; font-weight: 700; }
    .detail { margin: 0; color: #cbd5e1; font-size: .94rem; line-height: 1.5; }
    .sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
    .panel { padding: 1.35rem; border: 1px solid #2b3957; border-radius: 1rem; background: rgba(15, 23, 42, .78); }
    h2 { margin: 0 0 .7rem; font-size: 1.1rem; }
    .panel p { margin: 0; color: #cbd5e1; line-height: 1.55; }
    footer { margin-top: 2rem; color: #94a3b8; font-size: .9rem; }
    @media (max-width: 800px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { main { padding-top: 2.25rem; } .grid, .sections { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="brand">Goldfish</div>
    <h1>Project memory, with an honest operational view.</h1>
    <p class="lede">A small operational view of the Goldfish ledger. Aggregate counts are read from D1 on every page load; no memory content is exposed here.</p>
    ${notice}
    <section class="grid" aria-label="Service overview">${statusCards}</section>
    <section class="sections" aria-label="Operational detail">
      <article class="panel"><h2>Imports</h2><p>${metrics ? `${metrics.imports.toLocaleString()} import ledger entries are recorded in D1.` : "Import history is unavailable until the D1 binding is connected."}</p></article>
      <article class="panel"><h2>Retrieval</h2><p>Goldfish currently uses project-scoped lexical search. Recall quality, latency, and hit-rate analytics will appear after request telemetry is added; no values are estimated.</p></article>
    </section>
    <footer>Goldfish dashboard · ${metrics ? "live D1 totals" : "no live metrics are displayed"}.</footer>
  </main>
</body>
</html>`;
}
