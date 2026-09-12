export interface DashboardMetrics {
  memoryRecords: number; projects: number; agents: number; imports: number;
  byKind?: Array<{ kind: string; count: number }>;
  activity?: Array<{ label: string; count: number; latestAt: string | null }>;
  projectBreakdown?: Array<{ id: string; name: string; memories: number; agents: number; latestAt: string | null }>;
  importBreakdown?: Array<{ status: string; count: number }>;
}

/** Private admin client; content is loaded only after its /admin session starts. */
export function renderDashboard(metrics?: DashboardMetrics, nonce = ""): string {
  void metrics;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goldfish · Memory control room</title><style nonce="${nonce}">
  :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#071923;color:#e9f4f3}*{box-sizing:border-box}body{margin:0;background:linear-gradient(120deg,#06151f,#10313a,#06151f);min-width:320px}button,input,select,textarea{font:inherit}button{cursor:pointer}.app{min-height:100vh;display:grid;grid-template-columns:230px minmax(0,1fr)}.side{height:100vh;position:sticky;top:0;padding:20px 13px;display:flex;flex-direction:column;gap:22px;border-right:1px solid #254956;background:#061923e8}.brand{display:flex;align-items:center;gap:9px;padding:0 7px;color:#f6c45a;font-size:1.17rem;font-weight:780}.fish{width:36px;height:36px;filter:drop-shadow(0 5px 11px #e5a63a66)}.brand small{display:block;color:#86a4ac;font-size:.67rem;font-weight:500}nav{display:grid;gap:3px}.nav{padding:10px;border:0;border-radius:9px;color:#aac1c7;background:transparent;text-align:left}.nav:hover,.nav[aria-current=true]{color:#fff0c5;background:#183f49}.note{margin-top:auto;padding:11px;border:1px solid #244a55;border-radius:10px;background:#0b2933;color:#9bb6bc;font-size:.78rem;line-height:1.45}.note b{display:block;color:#f3c45b}.main{padding:30px clamp(18px,4vw,52px) 60px}.top{display:flex;justify-content:space-between;margin-bottom:31px;color:#9db7bd;font-size:.84rem}.top b{color:#f7fbf6}.online{display:flex;align-items:center;gap:8px}.dot{width:8px;height:8px;border-radius:50%;background:#e6ab3b;box-shadow:0 0 0 4px #e6ab3b22}.online.ready .dot{background:#45d09a;box-shadow:0 0 0 4px #45d09a22}.view{display:none}.view.active{display:block}.heading{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:24px}.heading h1{margin:0;color:#fff7e6;font-size:clamp(1.8rem,3vw,2.6rem);letter-spacing:-.05em}.heading p{max-width:650px;margin:8px 0 0;color:#a0bcc0;line-height:1.5;font-size:.94rem}.btn{padding:9px 12px;border:1px solid #3b6570;border-radius:8px;background:#17414c;color:#e1f1ee;font-size:.84rem;font-weight:650}.btn.primary{background:#f4c455;border-color:#f4c455;color:#182419}.btn.danger{background:#512c2e;border-color:#965451;color:#ffc4bc}.btn.ghost{background:transparent}.grid{display:grid;gap:15px}.stats{grid-template-columns:repeat(4,minmax(0,1fr))}.panel,.stat{border:1px solid #2b5761;border-radius:13px;background:#092630d6;box-shadow:0 16px 43px #0002}.stat{min-height:128px;padding:18px}.stat small{color:#8cabb0;font-size:.71rem;text-transform:uppercase;font-weight:700}.stat strong{display:block;margin:13px 0 4px;color:#fcf4e2;font-size:2.1rem;letter-spacing:-.06em}.stat span,.muted{color:#8ca8ad;font-size:.77rem}.two,.split,.graph{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.85fr);gap:15px;margin-top:15px}.panel{padding:18px}.panel h2{margin:0;color:#eef6ee;font-size:1rem}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:17px}.chart{height:225px;display:flex;align-items:end;gap:8px;padding:12px 2px;border-bottom:1px solid #315963}.bar{position:relative;flex:1;border-radius:6px 6px 1px 1px;background:linear-gradient(#f6cf69,#dc8f43)}.bar:nth-child(3n){background:linear-gradient(#72d2c1,#388f88)}.bar span{position:absolute;bottom:-19px;left:50%;transform:translateX(-50%);font-size:.64rem;color:#86a3a8;white-space:nowrap}.empty{width:100%;align-self:center;text-align:center;color:#8ba8ad;font-size:.87rem}.row{display:grid;grid-template-columns:33px 1fr auto;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #234b55}.avatar{display:grid;place-items:center;width:29px;height:29px;border-radius:50%;background:#1e515c;color:#e5f6ef;font-size:.7rem}.row b{display:block;color:#e5efec;font-size:.83rem}.row span,.row time{color:#89a9ae;font-size:.74rem}.toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:11px;margin-bottom:14px}input,select,textarea{padding:9px 10px;border:1px solid #365f69;border-radius:8px;background:#092832;color:#e7f3ee;outline:none}.toolbar input{flex:1 1 220px}.toolbar select{width:auto}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;text-align:left}.table th{padding:0 11px 10px;color:#88a6ac;font-size:.69rem;text-transform:uppercase}.table td{padding:12px 11px;border-top:1px solid #234c56;color:#bed2d2;font-size:.82rem}.table tr[data-id]{cursor:pointer}.table tr[data-id]:hover,.table tr.selected{background:#15424d}.memory{display:block;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f0f6ef;font-weight:650}.tag{display:inline-block;padding:3px 7px;border:1px solid #3d656c;border-radius:999px;background:#16444a;color:#abd8ce;font-size:.69rem}.detail{min-height:510px;position:sticky;top:16px}.content{margin:16px 0;white-space:pre-wrap;line-height:1.6;color:#dcebe5}.meta{display:grid;gap:8px}.meta div{display:flex;justify-content:space-between;gap:9px;padding-top:8px;border-top:1px solid #214854;color:#8ba9ad;font-size:.77rem}.meta code{max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cedfda}.actions{display:flex;gap:7px;margin-top:19px}.version{padding:0 0 15px 20px;border-left:1px solid #416b73}.version b{color:#eaf1eb;font-size:.82rem}.version p{margin:4px 0;color:#90adb0;font-size:.76rem}.half{grid-template-columns:repeat(2,minmax(0,1fr))}.key{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #244d56}.key b{display:block;color:#ebf4ed;font-size:.85rem}.key span{display:block;margin-top:3px;color:#8ca8ad;font-size:.74rem}.notice{padding:11px 12px;margin-bottom:14px;border-left:3px solid #edb94e;border-radius:0 8px 8px 0;background:#342b1b;color:#dacb9c;font-size:.81rem}.toggle{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid #244d56}.toggle b{display:block;color:#eaf3ed;font-size:.85rem}.toggle span{display:block;margin-top:3px;color:#8eaaae;font-size:.76rem}.switch{position:relative;width:42px;height:23px}.switch input{opacity:0}.slider{position:absolute;inset:0;border-radius:99px;background:#395963}.slider:before{content:"";position:absolute;width:17px;height:17px;left:3px;top:3px;border-radius:50%;background:#d7e7df;transition:.15s}.switch input:checked+.slider{background:#259889}.switch input:checked+.slider:before{transform:translateX(19px)}.canvas{min-height:490px;border-radius:10px;background:radial-gradient(circle,#1d4c55 1px,transparent 1px),#09252e;background-size:22px 22px;overflow:hidden}.canvas svg{width:100%;height:100%;min-height:490px}.graph-node text{fill:#d9e9e5;font-size:12px}.gstat{padding:10px;border:1px solid #315b65;border-radius:8px}.gstat strong{display:block;color:#f3c65b;font-size:1.35rem}.gstat span{color:#8ca9ad;font-size:.74rem}.copilot-launch{position:fixed;right:24px;bottom:24px;z-index:8;padding:11px 14px;border:1px solid #f5c258;border-radius:999px;background:#f4c657;color:#182721;font-weight:760}.copilot{position:fixed;right:22px;bottom:78px;z-index:9;width:min(400px,calc(100vw - 30px));max-height:calc(100vh - 110px);display:none;grid-template-rows:auto minmax(0,1fr) auto;border:1px solid #557780;border-radius:15px;background:#0b2b34;box-shadow:0 25px 75px #0008;overflow:hidden}.copilot.open{display:grid}.c-head{display:flex;justify-content:space-between;padding:14px;border-bottom:1px solid #315b64}.c-head b{color:#fff1c7}.c-head span{display:block;color:#91adb1;font-size:.72rem}.log{min-height:250px;overflow:auto;padding:14px;display:grid;align-content:start;gap:10px}.bubble{max-width:89%;padding:10px;border-radius:10px;background:#16414b;color:#dcebe5;font-size:.82rem;line-height:1.45}.bubble.user{justify-self:end;background:#32606a}.c-form{display:flex;gap:8px;padding:12px;border-top:1px solid #315b64}.c-form input{min-width:0;flex:1}.login{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:20px;background:#020c12c9;backdrop-filter:blur(10px)}.login[hidden]{display:none}.login-card{width:min(450px,100%);padding:27px;border:1px solid #4b7078;border-radius:16px;background:#0c2b34;box-shadow:0 28px 90px #0008}.login-card h2{margin:20px 0 7px;color:#fff5df;font-size:1.58rem}.login-card p{color:#9eb9bc;font-size:.88rem;line-height:1.55}.login-card label{display:block;margin:12px 0 6px;color:#b9d0d1;font-size:.78rem}.err{min-height:18px;color:#ffaaa0;font-size:.77rem}.toast{position:fixed;left:50%;bottom:24px;z-index:30;transform:translate(-50%,18px);padding:10px 14px;border:1px solid #4e7779;border-radius:8px;background:#16424a;color:#effaf3;font-size:.82rem;opacity:0;pointer-events:none;transition:.18s}.toast.show{opacity:1;transform:translate(-50%,0)}@media(max-width:900px){.app{grid-template-columns:72px 1fr}.side{padding:17px 10px}.brand div,.nav span,.note{display:none}.brand,.nav{justify-content:center}.stats{grid-template-columns:repeat(2,1fr)}.two,.split,.graph{grid-template-columns:1fr}.detail{position:static}}@media(max-width:600px){.app{display:block}.side{height:auto;position:sticky;z-index:5;padding:8px 10px;flex-direction:row;border-right:0;border-bottom:1px solid #254956}.brand{width:38px}.side nav{display:flex;overflow:auto;flex:1}.nav{min-width:42px;padding:8px}.main{padding:23px 14px 70px}.stats,.half{grid-template-columns:1fr}.heading{align-items:start;flex-direction:column}.table th:nth-child(3),.table td:nth-child(3),.table th:nth-child(5),.table td:nth-child(5){display:none}.copilot-launch{right:14px;bottom:14px}}</style></head><body>
<div class="app"><aside class="side"><div class="brand"><svg class="fish" viewBox="0 0 64 64"><path fill="#f5c458" d="M12 32c0-12 10-22 22-22 8 0 16 5 19 12l8-7v34l-8-7a22 22 0 1 1-41-10Z"/><circle cx="29" cy="27" r="3.3" fill="#17323c"/></svg><div>Goldfish<small>memory control room</small></div></div><nav><button class="nav" data-view="overview" aria-current="true"><span>Overview</span></button><button class="nav" data-view="memories"><span>Memory explorer</span></button><button class="nav" data-view="analytics"><span>Analytics</span></button><button class="nav" data-view="graph"><span>Relationship graph</span></button><button class="nav" data-view="keys"><span>API keys</span></button><button class="nav" data-view="lifecycle"><span>Lifecycle</span></button><button class="nav" data-view="settings"><span>Settings & taxonomy</span></button></nav><div class="note"><b>Private by design</b>Only your authenticated project ledger is loaded here.</div></aside><main class="main"><header class="top"><div>Goldfish / <select id="project-select" aria-label="Project"><option>Loading project…</option></select></div><div id="online" class="online"><i class="dot"></i><span>Connect to open the ledger.</span><button id="logout" class="btn ghost">Sign out</button></div></header>
<section id="view-overview" class="view active"><div class="heading"><div><h1>Memory with a pulse.</h1><p>See what agents retain, where it came from, and how the ledger changes over time.</p></div><button class="btn primary" data-create>Add memory</button></div><div class="grid stats"><article class="stat"><small>Memories</small><strong data-stat="memories">—</strong><span>Current project records</span></article><article class="stat"><small>Agents</small><strong data-stat="agents">—</strong><span>Agents with provenance</span></article><article class="stat"><small>Checkpoints</small><strong data-stat="checkpoints">—</strong><span>Resumable task moments</span></article><article class="stat"><small>Active keys</small><strong data-stat="keys">—</strong><span>Non-revoked credentials</span></article></div><div class="two"><article class="panel"><div class="panel-head"><h2>Memory flow</h2><button class="btn ghost" data-go="analytics">Open analytics</button></div><div id="flow" class="chart"><div class="empty">Private data loads after sign-in.</div></div></article><article class="panel"><div class="panel-head"><h2>Recent ledger activity</h2><button class="btn ghost" data-go="memories">Explore</button></div><div id="activity"><div class="empty">Private data loads after sign-in.</div></div></article></div></section>
<section id="view-memories" class="view"><div class="heading"><div><h1>Memory explorer</h1><p>Search, inspect provenance, edit working context, and trace each record through its version timeline.</p></div><button class="btn primary" data-create>Add memory</button></div><article class="panel toolbar"><input id="search" type="search" placeholder="Search memory content…"><button id="search-go" class="btn">Search</button><select id="kind"><option value="">All kinds</option><option>fact</option><option>task</option><option>conversation</option><option>document</option></select><select id="agent"><option value="">All agents</option></select><select id="category"><option value="">All categories</option></select><select id="lifecycle-filter"><option value="">All lifecycle states</option><option value="active">Active</option><option value="needs_review">Needs review</option><option value="archived">Archived</option><option value="superseded">Superseded</option><option value="deleted">Deleted</option></select><select id="period"><option value="">All time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></article><div class="split"><article class="panel table-wrap"><div class="panel-head"><h2 id="memory-count">Memories</h2><div><button id="select-all" class="btn ghost">Select all</button><button id="bulk-delete" class="btn danger" disabled>Delete selected</button></div></div><table class="table"><thead><tr><th></th><th>Memory</th><th>Kind</th><th>Provenance</th><th>Updated</th></tr></thead><tbody id="memories"><tr><td colspan="5" class="empty">Search the private ledger to load memory records.</td></tr></tbody></table></article><aside class="panel detail" id="detail"><div class="empty">Select a memory to inspect details, metadata, and history.</div></aside></div></section>
<section id="view-analytics" class="view"><div class="heading"><div><h1>Memory analytics</h1><p>Track volume, provenance, lifecycle quality, agent contribution, and working knowledge without keeping request transcripts.</p></div><button id="refresh-analytics" class="btn">Refresh data</button></div><div class="grid stats"><article class="stat"><small>Created this period</small><strong data-a="created">—</strong><span>Selected timeline</span></article><article class="stat"><small>Average age</small><strong data-a="age">—</strong><span>Current lifetime</span></article><article class="stat"><small>Provenance coverage</small><strong data-a="retrievals">—</strong><span>Agent and session attribution</span></article><article class="stat"><small>Needs review</small><strong data-a="review">—</strong><span>Curation candidates</span></article></div><div class="grid half" style="margin-top:15px"><article class="panel"><div class="panel-head"><h2>Activity over time</h2><select id="range"><option value="7d">7 days</option><option value="30d" selected>30 days</option><option value="90d">90 days</option></select></div><div id="timeline" class="chart"><div class="empty">Analytics load after sign-in.</div></div></article><article class="panel"><div class="panel-head"><h2>Memory mix</h2><span id="mix-total" class="muted">— records</span></div><div id="kinds"><div class="empty">No breakdown loaded.</div></div></article><article class="panel"><h2>Agent contribution</h2><div id="agents"><div class="empty">No contribution data loaded.</div></div></article><article class="panel"><h2>Curation queue</h2><div id="queue"><div class="empty">No lifecycle analysis loaded.</div></div></article></div></section>
<section id="view-graph" class="view"><div class="heading"><div><h1>Relationship graph</h1><p>Explore links between projects, agents, sessions, categories, and memories.</p></div><button id="refresh-graph" class="btn">Refresh graph</button></div><div class="graph"><article class="panel" style="padding:10px"><div id="canvas" class="canvas"><svg viewBox="0 0 780 500"><text x="390" y="250" text-anchor="middle" fill="#88aab0" font-size="15">Connect to load the project graph.</text></svg></div></article><aside class="panel"><div class="grid"><input id="graph-query" placeholder="Find a memory or agent"><select id="scope"><option value="all">All relationships</option><option value="agent">Agent provenance</option><option value="session">Sessions</option><option value="category">Categories</option></select><div class="gstat"><strong id="nodes">—</strong><span>nodes</span></div><div class="gstat"><strong id="edges">—</strong><span>relationships</span></div><p id="graph-note" class="muted">The graph only renders persisted provenance and explicit analysis.</p></div></aside></div></section>
<section id="view-keys" class="view"><div class="heading"><div><h1>API keys</h1><p>Issue scoped credentials, review last use, and revoke unused keys.</p></div><button id="issue" class="btn primary">Issue key</button></div><div class="notice">Keys are shown by label and prefix only. A full project token appears once at creation and is never stored in readable form.</div><article class="panel"><div class="panel-head"><h2>Project credentials</h2><span id="key-count" class="muted">No keys loaded</span></div><div id="keys"><div class="empty">Private key metadata loads after sign-in.</div></div></article></section>
<section id="view-lifecycle" class="view"><div class="heading"><div><h1>Memory lifecycle</h1><p>Run reviewable curation. Goldfish creates candidates and keeps originals and audit history intact until you explicitly act.</p></div><button id="curate" class="btn primary">Run curation</button></div><div class="grid half"><article class="panel"><h2>Automatic curation</h2><div class="toggle"><div><b>Schedule candidate reviews</b><span>Run a daily private scan that only produces reversible candidates.</span></div><label class="switch"><input data-policy="autoCurationEnabled" type="checkbox"><i class="slider"></i></label></div><div class="toggle"><div><b>Suggest condensed syntheses</b><span>Flag older long memories for a human-confirmed summary.</span></div><label class="switch"><input data-policy="autoSummarizeEnabled" type="checkbox"><i class="slider"></i></label></div><div class="toggle"><div><b>Flag obvious noise</b><span>Identify greetings or gibberish, then move approved items to review quarantine.</span></div><label class="switch"><input data-policy="autoDeleteGibberishEnabled" type="checkbox"><i class="slider"></i></label></div><label style="display:block;margin-top:16px;color:#b9d0d1;font-size:.78rem">Retention review days<input id="retention-days" type="number" min="0" max="36500" placeholder="No automatic age review" style="display:block;width:100%;margin-top:7px"></label></article><article class="panel"><div class="panel-head"><h2>Review queue</h2><button id="refresh-jobs" class="btn ghost">Refresh</button></div><div id="life-log"><div class="empty">No curation runs loaded.</div></div></article></div></section><section id="view-settings" class="view"><div class="heading"><div><h1>Project policy & taxonomy</h1><p>Set the extraction rules agents follow, maintain categories, and review the private administrative activity trail.</p></div><button id="save-settings" class="btn primary">Save settings</button></div><div class="grid half"><article class="panel"><h2>Agent instructions</h2><label style="display:block;margin-top:14px;color:#b9d0d1;font-size:.78rem">Project instructions<textarea id="project-instructions" style="width:100%;min-height:100px;margin-top:7px" placeholder="How Goldfish should classify this project's memory…"></textarea></label><label style="display:block;margin-top:14px;color:#b9d0d1;font-size:.78rem">Agent instructions<textarea id="agent-instructions" style="width:100%;min-height:100px;margin-top:7px" placeholder="What coding agents should retain or avoid…"></textarea></label><div class="toggle"><div><b>Multilingual memory</b><span>Preserve language-specific phrasing in extraction instructions.</span></div><label class="switch"><input id="multilingual" type="checkbox"><i class="slider"></i></label></div><div class="toggle"><div><b>Memory decay review</b><span>Use the retention window as a review signal, never a silent deletion rule.</span></div><label class="switch"><input id="decay" type="checkbox"><i class="slider"></i></label></div></article><article class="panel"><div class="panel-head"><h2>Categories</h2><button id="add-category" class="btn ghost">Add category</button></div><div id="categories"><div class="empty">Categories load after sign-in.</div></div></article><article class="panel"><div class="panel-head"><h2>Administrative activity</h2><button id="refresh-audit" class="btn ghost">Refresh</button></div><div id="audit"><div class="empty">Activity is private and loads after sign-in.</div></div></article><article class="panel"><h2>Provenance</h2><div id="provenance"><div class="empty">Agent and session coverage load after sign-in.</div></div></article></div></section></main></div>
<button id="copilot-open" class="copilot-launch">Goldfish Copilot</button><aside id="copilot" class="copilot"><header class="c-head"><div><b>Goldfish Copilot</b><span>Natural-language ledger control</span></div><button id="copilot-close" class="btn ghost">×</button></header><div id="log" class="log"><div class="bubble">Ask me to search memory, create a checkpoint, issue a key, or explain ledger activity.</div></div><form id="copilot-form" class="c-form"><input id="copilot-input" placeholder="Ask Goldfish…"><button class="btn primary">Send</button></form></aside>
<div id="login" class="login"><form id="login-form" class="login-card"><div class="brand"><svg class="fish" viewBox="0 0 64 64"><path fill="#f5c458" d="M12 32c0-12 10-22 22-22 8 0 16 5 19 12l8-7v34l-8-7a22 22 0 1 1-41-10Z"/><circle cx="29" cy="27" r="3.3" fill="#17323c"/></svg><div>Goldfish<small>memory control room</small></div></div><h2>Your memory stays private.</h2><p>Authenticate to open this project ledger. Goldfish uses a secure session cookie; a project API key is never written into this page.</p><label>Dashboard password</label><input id="password" type="password" autocomplete="current-password" required><div id="login-error" class="err"></div><div style="display:flex;justify-content:flex-end;margin-top:17px"><button class="btn primary">Open dashboard</button></div></form></div><div id="toast" class="toast"></div>
<script nonce="${nonce}">
(()=>{
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => Array.from(root.querySelectorAll(selector));
  const state = { project: null, projects: [], memories: [], selected: null, selectedIds: new Set(), conversationId: null, meta: null };
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
  const date = value => value ? new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(new Date(value)) : '—';
  const number = value => new Intl.NumberFormat().format(Number(value || 0));
  const toast = message => { const box = $('#toast'); box.textContent = message; box.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 3600); };
  const fail = error => { if (error && error.status === 401) { location.reload(); return; } console.warn(error); toast(error && error.message || 'Goldfish could not complete that action.'); };
  const api = async (path, options={}) => {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('content-type') && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
    const response = await fetch(path, {...options, headers, credentials:'same-origin'});
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(payload.message || payload.error || 'Request failed'); error.status = response.status; throw error; }
    return payload;
  };
  const projectPath = tail => '/admin/api/projects/' + encodeURIComponent(state.project.id) + (tail ? '/' + tail : '');
  const list = value => Array.isArray(value) ? value : [];
  const setText = (selector, value) => $$(selector).forEach(node => { node.textContent = value == null ? '—' : String(value); });
  const rangeDate = value => { const days = { '24h': 1, '7d': 7, '30d': 30 }[value]; if (!days) return ''; return new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19); };

  function route(view) {
    $$('.nav').forEach(button => button.setAttribute('aria-current', String(button.dataset.view === view)));
    $$('.view').forEach(section => section.classList.toggle('active', section.id === 'view-' + view));
    const loaders = { overview: loadOverview, memories: loadMemories, analytics: loadAnalytics, graph: loadGraph, keys: loadKeys, lifecycle: loadLifecycle, settings: loadSettings };
    (loaders[view] || loadOverview)();
  }
  $$('.nav').forEach(button => { button.onclick = () => route(button.dataset.view); });
  $$('[data-go]').forEach(button => { button.onclick = () => route(button.dataset.go); });

  function renderProjectSelect() {
    const select = $('#project-select');
    select.innerHTML = state.projects.map(project => '<option value="' + escape(project.id) + '">' + escape(project.name || project.id) + '</option>').join('');
    select.value = state.project.id;
    select.onchange = () => {
      state.project = state.projects.find(project => project.id === select.value) || state.projects[0];
      localStorage.setItem('goldfish.projectId', state.project.id);
      state.selected = null; state.selectedIds.clear(); state.memories = [];
      loadMeta().then(loadOverview).catch(fail);
    };
  }

  async function startSession() {
    try {
      const session = await api('/admin/session');
      if (!session.authenticated) throw Object.assign(new Error('Dashboard is locked'), {status: 401});
      const projects = await api('/admin/api/projects');
      state.projects = list(projects.projects);
      if (!state.projects.length) throw new Error('No Goldfish project exists yet. Create one through the secured API first.');
      const previous = localStorage.getItem('goldfish.projectId');
      state.project = state.projects.find(project => project.id === previous) || state.projects[0];
      renderProjectSelect();
      $('#online').classList.add('ready');
      $('#online span').textContent = 'Private dashboard session active';
      $('#login').hidden = true;
      await loadMeta();
      await loadOverview();
    } catch (error) {
      if (error && error.status !== 401) { $('#login-error').textContent = error.message || 'Could not open the dashboard.'; }
    }
  }
  $('#login-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await api('/admin/login', {method:'POST', body:JSON.stringify({password:$('#password').value})});
      await startSession();
    } catch (error) { $('#login-error').textContent = error.message || 'Password was not accepted.'; }
  };
  $('#logout').onclick = async () => { try { await api('/admin/logout', {method:'POST'}); } finally { location.reload(); } };

  async function loadMeta() {
    const meta = await api(projectPath('meta'));
    state.meta = meta;
    const agent = $('#agent');
    const selected = agent.value;
    agent.innerHTML = '<option value="">All agents</option>' + list(meta.agents).map(item => '<option value="' + escape(item.id) + '">' + escape(item.name || item.id) + ' (' + number(item.memory_count) + ')</option>').join('');
    agent.value = selected;
    const category = $('#category');
    const selectedCategory = category.value;
    category.innerHTML = '<option value="">All categories</option>' + list(meta.categories).map(item => '<option value="' + escape(item.category) + '">' + escape(item.category) + ' (' + number(item.count) + ')</option>').join('');
    category.value = selectedCategory;
  }
  function chart(node, values) {
    if (!values || !values.length) { node.innerHTML = '<div class="empty">No memory activity exists in this period.</div>'; return; }
    const max = Math.max(...values.map(item => Number(item.count || 0)), 1);
    node.innerHTML = values.map(item => '<div class="bar" style="height:' + Math.max(8, Math.round(Number(item.count || 0) / max * 170)) + 'px"><span>' + escape(item.date || item.label || '') + '</span></div>').join('');
  }
  function compactList(node, rows, title, detail) {
    node.innerHTML = rows && rows.length ? rows.slice(0, 14).map(row => '<div class="key"><div><b>' + escape(title(row)) + '</b><span>' + escape(detail(row)) + '</span></div><strong>' + escape(number(row.count)) + '</strong></div>').join('') : '<div class="empty">No records are available for this view.</div>';
  }

  async function loadOverview() {
    if (!state.project) return;
    try {
      const data = await api(projectPath('analytics?range=30d'));
      const summary = data.summary || {};
      setText('[data-stat=memories]', number(summary.memoryRecords));
      setText('[data-stat=agents]', number(summary.agents));
      setText('[data-stat=checkpoints]', number(summary.checkpoints));
      setText('[data-stat=keys]', number(summary.activeKeys));
      chart($('#flow'), list(data.activity));
      const rows = list(data.recentActivity);
      $('#activity').innerHTML = rows.length ? rows.slice(0, 8).map(item => '<div class="row"><i class="avatar">GF</i><div><b>' + escape(String(item.action || 'memory activity').replaceAll('.', ' ')) + '</b><span>' + escape(item.resourceType || 'Goldfish') + '</span></div><time>' + escape(date(item.createdAt)) + '</time></div>').join('') : '<div class="empty">No private ledger activity has been recorded yet.</div>';
    } catch (error) { fail(error); }
  }

  function memoryParams() {
    const params = new URLSearchParams({pageSize:'100'});
    const query = $('#search').value.trim(); if (query) params.set('query', query);
    const kind = $('#kind').value; if (kind) params.set('kind', kind);
    const agentId = $('#agent').value; if (agentId) params.set('agentId', agentId);
    const category = $('#category').value; if (category) params.set('category', category);
    const lifecycleStatus = $('#lifecycle-filter').value; if (lifecycleStatus) params.set('lifecycleStatus', lifecycleStatus);
    const from = rangeDate($('#period').value); if (from) params.set('from', from);
    return params.toString();
  }
  async function loadMemories() {
    if (!state.project) return;
    try {
      const data = await api(projectPath('memories?' + memoryParams()));
      state.memories = list(data.memories);
      renderMemoryList(data.total || 0);
    } catch (error) { fail(error); }
  }
  function renderMemoryList(total) {
    const target = $('#memories');
    $('#memory-count').textContent = number(total) + ' memories';
    target.innerHTML = state.memories.length ? state.memories.map(memory => {
      const category = memory.metadata && memory.metadata.category ? memory.metadata.category : memory.sourceType || 'memory';
      return '<tr data-id="' + escape(memory.id) + '" class="' + (state.selected && state.selected.id === memory.id ? 'selected' : '') + '"><td><input data-check="' + escape(memory.id) + '" type="checkbox" ' + (state.selectedIds.has(memory.id) ? 'checked' : '') + '></td><td><span class="memory">' + escape(memory.contentPreview || '') + '</span><span class="muted">' + escape(category) + '</span></td><td><span class="tag">' + escape(memory.kind) + '</span><span class="tag">' + escape(memory.lifecycleStatus) + '</span></td><td>' + escape(memory.agentId || 'Unattributed') + '<br><span class="muted">' + escape(memory.sessionId || 'No session') + '</span></td><td>' + escape(date(memory.updatedAt || memory.createdAt)) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">No matching memory was found.</td></tr>';
    $$('tr[data-id]', target).forEach(row => { row.onclick = event => { if (event.target.matches('input')) return; openMemory(row.dataset.id); }; });
    $$('[data-check]', target).forEach(input => { input.onchange = () => { if (input.checked) state.selectedIds.add(input.dataset.check); else state.selectedIds.delete(input.dataset.check); $('#bulk-delete').disabled = !state.selectedIds.size; }; });
  }
  $('#search-go').onclick = loadMemories;
  $('#search').onkeydown = event => { if (event.key === 'Enter') loadMemories(); };
  ['kind', 'agent', 'category', 'lifecycle-filter', 'period'].forEach(id => { $('#' + id).onchange = loadMemories; });
  $('#select-all').onclick = () => { state.memories.forEach(memory => state.selectedIds.add(memory.id)); $('#bulk-delete').disabled = !state.selectedIds.size; renderMemoryList(state.memories.length); };
  $('#bulk-delete').onclick = async () => {
    if (!state.selectedIds.size || !confirm('Move selected memories to the reversible deleted state? Version history remains.')) return;
    try { await api(projectPath('memories/bulk'), {method:'POST', body:JSON.stringify({ids:[...state.selectedIds], operation:'delete'})}); state.selectedIds.clear(); $('#bulk-delete').disabled = true; toast('Selected memories moved to the deleted state.'); await loadMemories(); } catch (error) { fail(error); }
  };

  async function openMemory(id) {
    try {
      const data = await api(projectPath('memories/' + encodeURIComponent(id)));
      state.selected = data.memory;
      renderMemoryList(state.memories.length);
      renderDetail(data);
    } catch (error) { fail(error); }
  }
  function renderDetail(data) {
    const memory = data.memory;
    const metadata = memory.metadata || {};
    $('#detail').innerHTML = '<div class="panel-head"><span class="tag">' + escape(memory.kind) + '</span><button id="close" class="btn ghost">×</button></div><div class="content">' + escape(memory.content) + '</div><div class="meta"><div><span>Memory ID</span><code>' + escape(memory.id) + '</code></div><div><span>Project</span><code>' + escape(memory.projectId) + '</code></div><div><span>Agent</span><code>' + escape(memory.agentId || 'Unattributed') + '</code></div><div><span>Session</span><code>' + escape(memory.sessionId || '—') + '</code></div><div><span>Source</span><code>' + escape(memory.sourceType || 'agent') + '</code></div><div><span>Category</span><code>' + escape(metadata.category || 'Uncategorised') + '</code></div><div><span>Lifecycle</span><code>' + escape(memory.lifecycleStatus) + '</code></div><div><span>Updated</span><code>' + escape(date(memory.updatedAt)) + '</code></div></div><div class="actions"><button id="edit" class="btn">Edit</button>' + (memory.lifecycleStatus !== 'active' ? '<button id="restore" class="btn">Restore</button>' : '') + (memory.lifecycleStatus !== 'deleted' ? '<button id="delete" class="btn danger">Delete</button>' : '') + '</div><div class="actions"><button data-feedback="positive" class="btn ghost">Useful</button><button data-feedback="negative" class="btn ghost">Not useful</button><button data-feedback="flag" class="btn ghost">Flag</button></div><div class="panel-head" style="margin-top:22px"><h2>Change history</h2></div><div id="versions">' + list(data.versions).map(version => '<details class="version"><summary><b>Version ' + escape(version.version) + '</b> · ' + escape(date(version.createdAt)) + ' · ' + escape(version.changeSummary || 'Recorded version') + '</summary><p class="content">' + escape(version.content || '') + '</p></details>').join('') + '</div><div class="panel-head" style="margin-top:18px"><h2>Audit trail</h2></div><div>' + list(data.audit).map(event => '<div class="version"><b>' + escape(String(event.action).replaceAll('.', ' ')) + '</b><p>' + escape(date(event.createdAt)) + ' · ' + escape(event.actorId || 'Goldfish') + '</p></div>').join('') + '</div>';
    $('#close').onclick = () => { state.selected = null; $('#detail').innerHTML = '<div class="empty">Select a memory to inspect details, metadata, and history.</div>'; renderMemoryList(state.memories.length); };
    $('#edit').onclick = () => editMemory(memory);
    const restore = $('#restore'); if (restore) restore.onclick = () => restoreMemory(memory.id);
    const deleteButton = $('#delete'); if (deleteButton) deleteButton.onclick = () => deleteMemory(memory.id);
    $$('[data-feedback]', $('#detail')).forEach(button => { button.onclick = () => leaveFeedback(memory.id, button.dataset.feedback); });
  }
  async function leaveFeedback(id, type) { try { await api(projectPath('memories/' + encodeURIComponent(id) + '/feedback'), {method:'POST', body:JSON.stringify({type})}); toast('Feedback recorded.'); } catch (error) { fail(error); } }
  async function deleteMemory(id) { if (!confirm('Move this memory to the deleted state? You can restore it from its change history.')) return; try { await api(projectPath('memories/' + encodeURIComponent(id)), {method:'DELETE'}); toast('Memory moved to deleted.'); state.selected = null; await loadMemories(); $('#detail').innerHTML = '<div class="empty">Select a memory to inspect details, metadata, and history.</div>'; } catch (error) { fail(error); } }
  async function restoreMemory(id) { if (!confirm('Restore this memory to the active ledger?')) return; try { await api(projectPath('memories/' + encodeURIComponent(id) + '/restore'), {method:'POST', body:'{}'}); toast('Memory restored to the active ledger.'); await loadMemories(); await openMemory(id); } catch (error) { fail(error); } }

  function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.readAsDataURL(file); }); }
  function editMemory(memory) {
    const modal = document.createElement('div'); modal.className = 'login';
    const meta = memory && memory.metadata || {};
    modal.innerHTML = '<form class="login-card"><h2>' + (memory ? 'Edit memory' : 'Add a memory') + '</h2><p>Edits create an immutable version and audit event. Attachments are stored in your private R2 bucket.</p><label>Kind</label><select id="edit-kind"><option value="fact">fact</option><option value="task">task</option><option value="conversation">conversation</option><option value="document">document</option></select><label>Agent</label><input id="edit-agent" placeholder="codex_cli"><label>Session</label><input id="edit-session" placeholder="optional session ID"><label>Category</label><input id="edit-category" placeholder="workflow, preference, architecture…"><label>Memory</label><textarea id="edit-content" required style="width:100%;min-height:150px"></textarea><label>Optional attachment (up to 5 MB)</label><input id="edit-file" type="file"><div class="err"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" class="btn">Cancel</button><button class="btn primary">Save memory</button></div></form>';
    document.body.append(modal);
    $('#edit-kind', modal).value = memory && memory.kind || 'fact'; $('#edit-agent', modal).value = memory && memory.agentId || ''; $('#edit-session', modal).value = memory && memory.sessionId || ''; $('#edit-category', modal).value = meta.category || ''; $('#edit-content', modal).value = memory && memory.content || '';
    $('.btn', modal).onclick = () => modal.remove();
    $('form', modal).onsubmit = async event => {
      event.preventDefault();
      try {
        const category = $('#edit-category', modal).value.trim();
        const payload = {content:$('#edit-content', modal).value, kind:$('#edit-kind', modal).value, agentId:$('#edit-agent', modal).value.trim() || undefined, sessionId:$('#edit-session', modal).value.trim() || undefined, metadata:{...meta, ...(category ? {category} : {})}};
        const saved = await api(memory ? projectPath('memories/' + encodeURIComponent(memory.id)) : projectPath('memories'), {method:memory ? 'PATCH' : 'POST', body:JSON.stringify(payload)});
        const result = saved.memory || saved;
        const file = $('#edit-file', modal).files[0];
        if (file) {
          if (file.size > 5000000) throw new Error('Attachments are limited to 5 MB.');
          const base64 = await readFile(file);
          await api(projectPath('memories/' + encodeURIComponent(result.id) + '/media/upload'), {method:'POST', body:JSON.stringify({base64, fileName:file.name, mimeType:file.type || 'application/octet-stream'})});
        }
        modal.remove(); toast(memory ? 'A new memory version was saved.' : 'Memory saved.'); await loadMeta(); await loadMemories(); await openMemory(result.id);
      } catch (error) { $('.err', modal).textContent = error.message || 'Could not save the memory.'; }
    };
  }
  $$('[data-create]').forEach(button => { button.onclick = () => editMemory(null); });

  async function loadAnalytics() {
    if (!state.project) return;
    try {
      const data = await api(projectPath('analytics?range=' + $('#range').value));
      const summary = data.summary || {};
      setText('[data-a=created]', number(summary.createdInRange));
      setText('[data-a=age]', summary.averageAgeDays + ' d');
      setText('[data-a=retrievals]', number(summary.provenanceCoverage) + '%');
      setText('[data-a=review]', number(summary.pendingCuration));
      chart($('#timeline'), list(data.activity));
      compactList($('#kinds'), list(data.byKind), item => item.kind, item => 'Memory kind');
      compactList($('#agents'), list(data.byAgent), item => item.label, item => item.latestAt ? 'Last change ' + date(item.latestAt) : 'No timestamp');
      compactList($('#queue'), list(data.byLifecycle), item => item.status, item => 'Lifecycle records');
      $('#mix-total').textContent = number(summary.memoryRecords) + ' records · ' + number(summary.categories) + ' categories';
    } catch (error) { fail(error); }
  }
  $('#range').onchange = loadAnalytics; $('#refresh-analytics').onclick = loadAnalytics;

  async function loadGraph() {
    if (!state.project) return;
    try {
      const scope = $('#scope').value;
      const query = $('#graph-query').value.trim();
      const params = new URLSearchParams({limit:'250'});
      if (scope !== 'all') params.set('entityType', scope);
      if (query) params.set('query', query);
      const data = await api(projectPath('graph?' + params.toString()));
      const nodes = list(data.nodes);
      const edges = list(data.edges);
      $('#nodes').textContent = number(nodes.length); $('#edges').textContent = number(edges.length);
      $('#graph-note').textContent = nodes.length ? 'Derived from active memories, agent/session provenance, and categories. Rebuild after major edits.' : 'No relationship nodes match this filter. Rebuild from the current active ledger if needed.';
      const placed = nodes.slice(0, 90).map((node, index) => ({...node, x:80 + (index * 139) % 620, y:72 + (index * 89) % 330}));
      const byId = Object.fromEntries(placed.map(node => [node.id, node]));
      const visualEdges = edges.filter(edge => byId[edge.source_entity_id] && byId[edge.target_entity_id]);
      $('#canvas').innerHTML = placed.length ? '<svg viewBox="0 0 780 500">' + visualEdges.map(edge => { const source = byId[edge.source_entity_id], target = byId[edge.target_entity_id]; return '<line x1="' + source.x + '" y1="' + source.y + '" x2="' + target.x + '" y2="' + target.y + '" stroke="#47757c" stroke-width="' + Math.min(5, 1 + Number(edge.weight || 1) / 2) + '"/>'; }).join('') + placed.map(node => '<g class="graph-node"><circle cx="' + node.x + '" cy="' + node.y + '" r="15" fill="' + ({agent:'#5aaca1',session:'#7c77c8',category:'#efb951'}[node.entity_type] || '#2f6973') + '"/><text x="' + node.x + '" y="' + (node.y + 31) + '" text-anchor="middle">' + escape(node.name || node.id) + '</text></g>').join('') + '</svg>' : '<svg viewBox="0 0 780 500"><text x="390" y="250" text-anchor="middle" fill="#88aab0" font-size="15">No persisted relationships match this view.</text></svg>';
    } catch (error) { fail(error); }
  }
  $('#refresh-graph').onclick = async () => { try { await api(projectPath('graph/rebuild'), {method:'POST', body:JSON.stringify({})}); toast('Relationship graph rebuilt from active memories.'); await loadGraph(); } catch (error) { fail(error); } };
  $('#scope').onchange = loadGraph;
  let graphTimer;
  $('#graph-query').oninput = () => { clearTimeout(graphTimer); graphTimer = setTimeout(loadGraph, 180); };

  async function loadKeys() {
    if (!state.project) return;
    try {
      const data = await api(projectPath('api-keys')); const keys = list(data.keys);
      $('#key-count').textContent = number(keys.length) + ' key' + (keys.length === 1 ? '' : 's');
      $('#keys').innerHTML = keys.length ? keys.map(key => '<div class="key"><div><b>' + escape(key.label || 'Untitled key') + '</b><span>' + escape(key.keyPrefix) + ' · created ' + escape(date(key.createdAt)) + ' · last used ' + escape(date(key.lastUsedAt)) + (key.revokedAt ? ' · revoked' : '') + '</span></div>' + (key.revokedAt ? '' : '<button data-revoke="' + escape(key.id) + '" class="btn danger">Revoke</button>') + '</div>').join('') : '<div class="empty">No project keys have been issued.</div>';
      $$('[data-revoke]', $('#keys')).forEach(button => { button.onclick = () => revokeKey(button.dataset.revoke); });
    } catch (error) { fail(error); }
  }
  async function revokeKey(id) { if (!confirm('Revoke this project key now? Agents using it will lose access immediately.')) return; try { await api(projectPath('api-keys/' + encodeURIComponent(id)), {method:'DELETE'}); toast('API key revoked.'); await loadKeys(); } catch (error) { fail(error); } }
  $('#issue').onclick = async () => { const label = prompt('Label for this scoped project key:'); if (label === null) return; try { const key = await api(projectPath('api-keys'), {method:'POST', body:JSON.stringify({label})}); const notice = document.createElement('div'); notice.className = 'notice'; notice.textContent = 'Copy this token now; it is shown once: ' + key.token; $('#keys').prepend(notice); navigator.clipboard && navigator.clipboard.writeText(key.token).catch(() => undefined); toast('Key issued and copied to the clipboard.'); await loadKeys(); } catch (error) { fail(error); } };

  function renderCuration(job) {
    const candidates = list(job && job.candidates);
    const jobName = job && job.run && job.run.id || '';
    $('#life-log').innerHTML = candidates.length ? candidates.map(candidate => '<div class="key"><div><b>' + escape(candidate.proposed_action) + ' · ' + escape(candidate.content_preview || candidate.memory_record_id) + '</b><span>' + escape(candidate.rationale || 'Review candidate') + '</span></div>' + (candidate.status === 'pending' ? '<button class="btn" data-approve="' + escape(candidate.id) + '" data-job="' + escape(jobName) + '">Mark for review</button>' : '<span class="tag">' + escape(candidate.status) + '</span>') + '</div>').join('') : '<div class="empty">No review candidates exist in this run.</div>';
    $$('[data-approve]', $('#life-log')).forEach(button => { button.onclick = async () => { try { await api(projectPath('jobs/' + encodeURIComponent(button.dataset.job) + '/approve'), {method:'POST', body:JSON.stringify({candidateIds:[button.dataset.approve]})}); toast('Candidate moved to the reversible review state.'); await loadLifecycle(); } catch (error) { fail(error); } }; });
  }
  async function loadLifecycle() {
    if (!state.project) return;
    try {
      const [settings, jobs] = await Promise.all([api(projectPath('settings')), api(projectPath('jobs'))]);
      $$('[data-policy]').forEach(input => { input.checked = Boolean(settings[input.dataset.policy]); });
      $('#retention-days').value = settings.retentionDays == null ? '' : settings.retentionDays;
      const first = list(jobs.jobs)[0];
      if (first) renderCuration(await api(projectPath('jobs/' + encodeURIComponent(first.id)))); else $('#life-log').innerHTML = '<div class="empty">No curation runs exist yet.</div>';
    } catch (error) { fail(error); }
  }
  async function persistLifecycle() {
    try {
      const patch = {}; $$('[data-policy]').forEach(input => { patch[input.dataset.policy] = input.checked; });
      const raw = $('#retention-days').value.trim(); patch.retentionDays = raw ? Number(raw) : null;
      await api(projectPath('settings'), {method:'PATCH', body:JSON.stringify(patch)}); toast('Curation policy saved.');
    } catch (error) { fail(error); }
  }
  $$('[data-policy]').forEach(input => { input.onchange = persistLifecycle; }); $('#retention-days').onchange = persistLifecycle;
  $('#curate').onclick = async () => { try { const run = await api(projectPath('curation/preview'), {method:'POST', body:JSON.stringify({limit:500})}); renderCuration(run); toast('Curation candidates are ready for review.'); } catch (error) { fail(error); } };
  $('#refresh-jobs').onclick = loadLifecycle;

  async function loadSettings() {
    if (!state.project) return;
    try {
      const [settings, categories, audit, analytics] = await Promise.all([api(projectPath('settings')), api(projectPath('categories')), api('/admin/api/audit?projectId=' + encodeURIComponent(state.project.id) + '&limit=60'), api(projectPath('analytics?range=30d'))]);
      const policy = settings.curationPolicy || {};
      $('#project-instructions').value = policy.projectInstructions || '';
      $('#agent-instructions').value = policy.agentInstructions || '';
      $('#multilingual').checked = Boolean(policy.multilingual); $('#decay').checked = Boolean(policy.decay);
      const categoryRows = list(categories.categories);
      $('#categories').innerHTML = categoryRows.length ? categoryRows.map(category => '<div class="key"><div><b>' + escape(category.name) + '</b><span>' + escape(category.description || category.slug) + '</span></div><button class="btn danger" data-category-delete="' + escape(category.id) + '">Delete</button></div>').join('') : '<div class="empty">No category catalog exists yet. Imported memory metadata remains intact.</div>';
      $$('[data-category-delete]', $('#categories')).forEach(button => { button.onclick = async () => { if (!confirm('Delete this category catalog entry? Existing memory metadata remains unchanged.')) return; try { await api(projectPath('categories/' + encodeURIComponent(button.dataset.categoryDelete)), {method:'DELETE'}); await loadSettings(); } catch (error) { fail(error); } }; });
      const events = list(audit.audit);
      $('#audit').innerHTML = events.length ? events.map(event => '<div class="version"><b>' + escape(String(event.action).replaceAll('.', ' ')) + '</b><p>' + escape(date(event.createdAt)) + ' · ' + escape(event.actorId || 'Goldfish') + '</p></div>').join('') : '<div class="empty">No administrative activity in this project.</div>';
      const summary = analytics.summary || {};
      $('#provenance').innerHTML = '<div class="gstat"><strong>' + number(summary.provenanceCoverage) + '%</strong><span>agent/session provenance coverage</span></div><div class="gstat"><strong>' + number(summary.sessions) + '</strong><span>recorded sessions</span></div>';
    } catch (error) { fail(error); }
  }
  $('#save-settings').onclick = async () => { try { await api(projectPath('settings'), {method:'PATCH', body:JSON.stringify({projectInstructions:$('#project-instructions').value, agentInstructions:$('#agent-instructions').value, multilingual:$('#multilingual').checked, decay:$('#decay').checked})}); toast('Project instructions saved.'); } catch (error) { fail(error); } };
  $('#add-category').onclick = async () => { const name = prompt('Category name:'); if (!name) return; const description = prompt('Optional description:') || ''; try { await api(projectPath('categories'), {method:'POST', body:JSON.stringify({name, description})}); toast('Category added.'); await loadSettings(); } catch (error) { fail(error); } };
  $('#refresh-audit').onclick = loadSettings;

  const copilot = $('#copilot');
  $('#copilot-open').onclick = () => { copilot.classList.add('open'); $('#copilot-input').focus(); };
  $('#copilot-close').onclick = () => copilot.classList.remove('open');
  function say(message, user=false) { const bubble = document.createElement('div'); bubble.className = 'bubble' + (user ? ' user' : ''); bubble.textContent = message; $('#log').append(bubble); bubble.scrollIntoView({block:'nearest'}); }
  function showProposals(data) {
    list(data.proposals).forEach(proposal => { const box = document.createElement('div'); box.className = 'bubble'; box.innerHTML = '<b>Proposed: ' + escape(proposal.summary) + '</b><br><span class="muted">Requires your confirmation before Goldfish changes the ledger.</span><br><button class="btn primary" style="margin-top:8px" data-proposal="' + escape(proposal.id) + '">Apply proposal</button>'; $('[data-proposal]', box).onclick = async () => { try { const result = await api(projectPath('copilot/' + encodeURIComponent(data.conversationId) + '/proposals/' + encodeURIComponent(proposal.id) + '/apply'), {method:'POST'}); toast('Copilot proposal applied.'); say('Applied ' + result.proposalType + ' proposal.'); await loadOverview(); await loadMemories(); } catch (error) { fail(error); } }; $('#log').append(box); });
  }
  $('#copilot-form').onsubmit = async event => { event.preventDefault(); const message = $('#copilot-input').value.trim(); if (!message || !state.project) return; $('#copilot-input').value = ''; say(message, true); try { const data = await api(projectPath('copilot'), {method:'POST', body:JSON.stringify({message, conversationId:state.conversationId || undefined})}); state.conversationId = data.conversationId; say(data.reply || 'Goldfish did not return a response.'); showProposals(data); } catch (error) { say(error.message || 'Goldfish Copilot is temporarily unavailable.'); } };

  startSession();
})();
</script></body></html>`;
}
