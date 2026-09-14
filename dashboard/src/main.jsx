import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as echarts from "echarts/core";
import { BarChart, GraphChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "./styles.css";

echarts.use([BarChart, GraphChart, HeatmapChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const NAV = [
  ["overview", "Overview"], ["memories", "Memories"], ["requests", "Requests"],
  ["projects", "Projects & Agents"], ["analytics", "Analytics"], ["keys", "API Keys"], ["settings", "Settings"]
];
const COLORS = ["#ffb84d", "#62d4b2", "#63a8ff", "#ba88ff", "#ff7668", "#f0d25d"];
const kinds = ["fact", "conversation", "document", "task"];
const lifecycle = ["active", "needs_review", "archived", "superseded", "deleted"];
const fmt = value => Number(value || 0).toLocaleString();
const when = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 401) { location.reload(); throw new Error("Session expired"); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
  return data;
};
const pathFor = (project, tail = "") => `/admin/api/projects/${encodeURIComponent(project.id)}/${tail}`;

function Chart({ option, className = "chart" }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, null, { renderer: "canvas" });
    chart.setOption({ backgroundColor: "transparent", textStyle: { color: "#b9d1d7", fontFamily: "Inter, ui-sans-serif, system-ui" }, ...option });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(ref.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [option]);
  return <div ref={ref} class={className} />;
}

function Badge({ children, tone = "sea" }) { return <span class={`badge ${tone}`}>{children}</span>; }
function Empty({ title, body }) { return <div class="empty"><span>◌</span><b>{title}</b><p>{body}</p></div>; }
function Metric({ label, value, detail, tone = "gold" }) { return <div class={`metric ${tone}`}><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>; }
function Panel({ title, subtitle, action, children, wide = false }) { return <section class={`panel ${wide ? "wide" : ""}`}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>; }

function Overview({ project, analytics, requests, onNavigate }) {
  const activity = analytics?.activity || [];
  const line = useMemo(() => ({
    tooltip: { trigger: "axis", formatter: p => `<b>${p[0]?.axisValue}</b><br/>${fmt(p[0]?.value)} memories recorded` },
    grid: { left: 34, right: 12, top: 22, bottom: 28 }, xAxis: { type: "category", data: activity.map(x => x.date), axisLabel: { color: "#76939a", hideOverlap: true }, axisLine: { lineStyle: { color: "#214650" } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: "#76939a" }, splitLine: { lineStyle: { color: "#153943" } } },
    series: [{ type: "line", smooth: .35, symbolSize: 6, data: activity.map(x => x.count), lineStyle: { width: 3, color: "#ffb84d" }, itemStyle: { color: "#ffb84d" }, areaStyle: { color: "rgba(255,184,77,.13)" } }]
  }), [activity]);
  const mix = useMemo(() => ({
    tooltip: { trigger: "item", formatter: p => `<b>${p.name}</b><br/>${fmt(p.value)} memories · ${p.percent}%` },
    legend: { bottom: 0, textStyle: { color: "#8faab0" }, itemWidth: 10, itemHeight: 10 },
    series: [{ type: "pie", radius: ["50%", "76%"], center: ["50%", "43%"], padAngle: 3, itemStyle: { borderRadius: 4 }, label: { show: false }, data: (analytics?.byKind || []).map((x, i) => ({ name: x.kind, value: x.count, itemStyle: { color: COLORS[i] } })) }]
  }), [analytics]);
  const s = analytics?.summary || {};
  const rq = requests?.summary || {};
  return <div class="page-grid overview-grid">
    <section class="aquarium-hero">
      <div><Badge tone="gold">LIVE MEMORY LEDGER</Badge><h1>Memory Aquarium</h1><p>Every useful project fact, checkpoint, and agent handoff—clean, traceable, and ready for the next agent.</p><div class="hero-actions"><button class="primary" onClick={() => onNavigate("memories")}>Explore memories</button><button onClick={() => onNavigate("requests")}>Inspect requests</button></div></div>
      <div class="fish-orbit"><span class="bubble b1"/><span class="bubble b2"/><img src="/goldfish-logo.png" alt="Goldfish remembers everything" /></div>
    </section>
    <div class="metrics-strip">
      <Metric label="Active memories" value={fmt(s.activeMemories)} detail={`${fmt(s.memoryRecords)} total records`} />
      <Metric label="Requests today" value={fmt(rq.today)} detail={`${fmt(rq.successRate)}% successful`} tone="sea" />
      <Metric label="Search latency" value={rq.p95Ms != null ? `${fmt(rq.p95Ms)} ms` : "Collecting"} detail="p95 over selected period" tone="blue" />
      <Metric label="Needs review" value={fmt(s.pendingCuration || s.needsReview)} detail="merge and cleanup proposals" tone="coral" />
    </div>
    <Panel title="Memory activity" subtitle="Records created by day. Hover for the exact value." wide><Chart option={line} /></Panel>
    <Panel title="Memory composition" subtitle="What the current project remembers"><Chart option={mix} /></Panel>
    <Panel title="Operational pulse" subtitle="Real request telemetry, linked to the ledger">
      <div class="pulse-list">
        {[ ["Searches", rq.searches], ["Writes", rq.writes], ["Errors", rq.errors], ["Agents", s.agents], ["Sessions", s.sessions] ].map(([l,v],i)=><button class="pulse-row" onClick={()=>onNavigate(i<3?"requests":"projects")}><span><i style={{background:COLORS[i]}}/>{l}</span><b>{v == null ? "—" : fmt(v)}</b></button>)}
      </div>
    </Panel>
    <Panel title="Recent ledger events" subtitle="Changes that affected memory state" wide>
      <div class="event-list">{(analytics?.recentActivity || []).slice(0,8).map(e=><div class="event"><Badge tone={e.action?.includes("delete")?"coral":"sea"}>{e.action?.replaceAll("_"," ")}</Badge><span>{e.resourceType || "record"}</span><code>{e.resourceId?.slice(0,18) || "—"}</code><time>{when(e.createdAt)}</time></div>)}</div>
    </Panel>
  </div>;
}

function Memories({ project, meta, toast }) {
  const [data, setData] = useState({ memories: [], total: 0, page: 1 });
  const [filters, setFilters] = useState({ query:"", kind:"", category:"", agentId:"", lifecycleStatus:"", from:"", to:"" });
  const [selected, setSelected] = useState(new Set());
  const [detail, setDetail] = useState(null); const [tab, setTab] = useState("content"); const [loading,setLoading]=useState(true);
  const load = async (page=1) => { setLoading(true); try { const q = new URLSearchParams({page:String(page),pageSize:"40"}); Object.entries(filters).forEach(([k,v])=>v&&q.set(k,v)); setData(await api(pathFor(project, `memories?${q}`))); } finally { setLoading(false); } };
  useEffect(()=>{ load(); setSelected(new Set()); },[project.id]);
  const open = async id => { setDetail(await api(pathFor(project, `memories/${encodeURIComponent(id)}`))); setTab("content"); };
  const apply = async operation => { if(!selected.size)return; if(operation==="summarize"){const result=await api(pathFor(project,"summaries"),{method:"POST",body:JSON.stringify({memoryIds:[...selected],title:"Selected-memory brief"})});toast(`Summary draft created from ${result.summary.sourceCount} memories`);return;} const payload={ids:[...selected],operation,...(operation==="lifecycle"?{lifecycleStatus:"archived"}:{})}; await api(pathFor(project,"memories/bulk"),{method:"POST",body:JSON.stringify(payload)}); toast(`${selected.size} memories updated`); setSelected(new Set()); await load(data.page); };
  const save = async () => { const content=document.querySelector("#memory-content").value; const kind=document.querySelector("#memory-kind").value; const category=document.querySelector("#memory-category").value.trim(); await api(pathFor(project,`memories/${detail.memory.id}`),{method:"PATCH",body:JSON.stringify({content,kind,metadata:{...(detail.memory.metadata||{}),...(category?{category}:{})},changeSummary:"Edited in Memory Aquarium"})}); toast("Memory saved with a new version"); await open(detail.memory.id); await load(data.page); };
  const toggle = id => setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n});
  return <div class="stack">
    <div class="section-title"><div><Badge tone="gold">MEMORY EXPLORER</Badge><h1>Find the right context</h1><p>Filter by meaning, origin, time, and lifecycle. Open any memory for its complete history.</p></div><div class="button-row"><button onClick={async()=>{const result=await api(pathFor(project,"summaries"),{method:"POST",body:JSON.stringify({title:"Project brief"})});toast(`Project brief draft created from ${result.summary.sourceCount} memories`)}}>Generate project brief</button><button class="primary" onClick={()=>setDetail({create:true,memory:{content:"",kind:"fact",metadata:{}}})}>+ Add memory</button></div></div>
    <div class="filter-deck">
      <label class="search-field"><span>⌕</span><input placeholder="Search memory text…" value={filters.query} onInput={e=>setFilters({...filters,query:e.currentTarget.value})}/></label>
      <select value={filters.kind} onChange={e=>setFilters({...filters,kind:e.currentTarget.value})}><option value="">All kinds</option>{kinds.map(x=><option>{x}</option>)}</select>
      <select value={filters.category} onChange={e=>setFilters({...filters,category:e.currentTarget.value})}><option value="">All categories</option>{(meta?.categories||[]).map(x=><option value={x.category}>{x.category}</option>)}</select>
      <select value={filters.agentId} onChange={e=>setFilters({...filters,agentId:e.currentTarget.value})}><option value="">All agents</option>{(meta?.agents||[]).map(x=><option value={x.id}>{x.name||x.id}</option>)}</select>
      <select value={filters.lifecycleStatus} onChange={e=>setFilters({...filters,lifecycleStatus:e.currentTarget.value})}><option value="">Any state</option>{lifecycle.map(x=><option>{x}</option>)}</select>
      <label class="date"><span>From</span><input type="date" value={filters.from} onInput={e=>setFilters({...filters,from:e.currentTarget.value})}/></label>
      <label class="date"><span>To</span><input type="date" value={filters.to} onInput={e=>setFilters({...filters,to:e.currentTarget.value})}/></label>
      <button class="primary" onClick={()=>load(1)}>Apply filters</button><button onClick={()=>{setFilters({query:"",kind:"",category:"",agentId:"",lifecycleStatus:"",from:"",to:""});setTimeout(()=>load(1),0)}}>Reset</button>
    </div>
    <div class="table-shell">
      <div class="bulkbar"><label><input aria-label="Select visible memories" type="checkbox" checked={data.memories.length>0&&selected.size===data.memories.length} onChange={e=>setSelected(e.currentTarget.checked?new Set(data.memories.map(x=>x.id)):new Set())}/> {selected.size?`${selected.size} selected`:`${fmt(data.total)} memories`}</label><div><button disabled={!selected.size} onClick={()=>apply("summarize")}>Summarize</button><button disabled={!selected.size} onClick={()=>apply("lifecycle")}>Archive</button><button class="danger" disabled={!selected.size} onClick={()=>apply("delete")}>Delete</button></div></div>
      {loading?<div class="loading">Reading the ledger…</div>:data.memories.length?<div class="memory-table"><div class="tr th"><span/><span>Memory</span><span>Kind</span><span>Agent / session</span><span>State</span><span>Updated</span></div>{data.memories.map(m=><div class="tr" onDblClick={()=>open(m.id)}><input type="checkbox" checked={selected.has(m.id)} onChange={()=>toggle(m.id)}/><button class="memory-copy" onClick={()=>open(m.id)}><b>{m.contentPreview}</b><small>{m.metadata?.category||"uncategorized"} · {m.sourceType}</small></button><Badge tone={m.kind==="task"?"gold":m.kind==="fact"?"sea":"blue"}>{m.kind}</Badge><span class="identity"><b>{m.agentId||"Unattributed"}</b><small>{m.sessionId||"No session"}</small></span><Badge tone={m.lifecycleStatus==="needs_review"?"coral":"slate"}>{m.lifecycleStatus}</Badge><time>{when(m.updatedAt)}</time></div>)}</div>:<Empty title="No memories match" body="Broaden the filters or add the first memory for this view."/>}
      <div class="pager"><button disabled={data.page<=1} onClick={()=>load(data.page-1)}>← Previous</button><span>Page {data.page} of {Math.max(1,Math.ceil(data.total/40))}</span><button disabled={data.page*40>=data.total} onClick={()=>load(data.page+1)}>Next →</button></div>
    </div>
    {detail&&<div class="drawer-scrim" onClick={e=>e.target===e.currentTarget&&setDetail(null)}><aside class="drawer wide-drawer"><header><div><Badge tone="gold">{detail.create?"NEW MEMORY":`VERSION ${detail.memory.currentVersion}`}</Badge><h2>{detail.create?"Add a memory":"Memory record"}</h2></div><button class="icon" onClick={()=>setDetail(null)}>×</button></header>{!detail.create&&<nav class="tabs">{["content","history","provenance","lifecycle"].map(x=><button class={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</nav>}
      {(tab==="content"||detail.create)&&<div class="drawer-body"><label>Memory content<textarea id="memory-content" rows="12" defaultValue={detail.memory.content}/></label><div class="form-grid"><label>Kind<select id="memory-kind" defaultValue={detail.memory.kind}>{kinds.map(x=><option>{x}</option>)}</select></label><label>Category<input id="memory-category" defaultValue={detail.memory.metadata?.category||""}/></label></div><button class="primary" onClick={detail.create?async()=>{const category=document.querySelector("#memory-category").value.trim();await api(pathFor(project,"memories"),{method:"POST",body:JSON.stringify({content:document.querySelector("#memory-content").value,kind:document.querySelector("#memory-kind").value,metadata:category?{category}:{}})});setDetail(null);toast("Memory added");load(1)}:save}>{detail.create?"Add to ledger":"Save new version"}</button></div>}
      {tab==="history"&&<div class="timeline">{(detail.versions||[]).map(v=><article><i/><div><b>Version {v.version}</b><time>{when(v.createdAt)}</time><p>{v.changeSummary||"Imported version"}</p><pre>{v.content}</pre></div></article>)}</div>}
      {tab==="provenance"&&<div class="drawer-body definition-list">{[["Project",detail.memory.projectId],["Agent",detail.memory.agentId||"Unattributed"],["Session",detail.memory.sessionId||"None"],["Source",detail.memory.sourceType],["Created",when(detail.memory.createdAt)],["Content hash",detail.memory.contentHash]].map(([a,b])=><div><span>{a}</span><code>{b}</code></div>)}</div>}
      {tab==="lifecycle"&&<div class="drawer-body"><div class="lifecycle-state"><Badge tone="sea">{detail.memory.lifecycleStatus}</Badge><h3>Lifecycle stays with the memory</h3><p>Archive stale context, mark an older fact superseded, or restore a deleted record. The history remains visible.</p></div><div class="button-row">{["active","archived","superseded","needs_review"].map(x=><button onClick={async()=>{await api(pathFor(project,`memories/${detail.memory.id}`),{method:"PATCH",body:JSON.stringify({lifecycleStatus:x})});await open(detail.memory.id);toast(`Marked ${x}`)}}>{x.replace("_"," ")}</button>)}</div></div>}
    </aside></div>}
  </div>;
}

function Requests({ project, data, reload, openMemory }) {
  const rows=data?.requests||[]; const summary=data?.summary||{};
  return <div class="stack"><div class="section-title"><div><Badge tone="blue">REQUEST TELEMETRY</Badge><h1>Every read and write, explained</h1><p>Trace MCP, API, dashboard, and Copilot operations back to the project and memories they touched.</p></div><button onClick={reload}>↻ Refresh</button></div>
    <div class="metrics-strip compact"><Metric label="Total requests" value={fmt(summary.total)} detail="selected period"/><Metric label="Success rate" value={summary.successRate==null?"Collecting":`${summary.successRate}%`} detail={`${fmt(summary.errors)} errors`} tone="sea"/><Metric label="Median latency" value={summary.p50Ms==null?"—":`${summary.p50Ms} ms`} detail="p50 response time" tone="blue"/><Metric label="Empty searches" value={fmt(summary.emptySearches)} detail="retrievals with no result" tone="coral"/></div>
    <div class="filter-deck"><select><option>All operations</option><option>search</option><option>write</option><option>fetch</option><option>update</option><option>delete</option><option>summarize</option></select><select><option>All protocols</option><option>MCP</option><option>REST API</option><option>Dashboard</option><option>GraphQL</option></select><select><option>Any status</option><option>Success</option><option>Error</option></select><input type="date"/><input type="date"/><button class="primary" onClick={reload}>Apply filters</button></div>
    <div class="table-shell">{rows.length?<div class="request-table"><div class="rr rh"><span>Time</span><span>Operation</span><span>Origin</span><span>Status</span><span>Latency</span><span>Memories</span></div>{rows.map(r=><div class="rr"><time>{when(r.createdAt||r.created_at)}</time><Badge tone={r.operation==="search"?"blue":r.operation==="delete"?"coral":"sea"}>{r.operation}</Badge><span class="identity"><b>{r.appId||r.app_id||r.protocol}</b><small>{r.agentId||r.agent_id||"Unattributed"}</small></span><Badge tone={Number(r.status)<400?"sea":"coral"}>{r.status}</Badge><span>{fmt(r.durationMs||r.duration_ms)} ms</span><button class="linklike" onClick={()=>r.memoryIds?.[0]&&openMemory?.(r.memoryIds[0])}>{r.memoryIds?.length||r.memory_count||0} linked</button></div>)}</div>:<Empty title="Telemetry begins with this release" body="New MCP, API, dashboard, and Copilot operations will appear here with status, latency, and memory links."/>}</div>
  </div>;
}

function Projects({ projects, selected, setSelected, meta, profile }) {
  return <div class="stack"><div class="section-title"><div><Badge tone="sea">IDENTITY MAP</Badge><h1>Projects & Agents</h1><p>The Desktop folder slug is canonical. Display names and related data folders make the map human-readable.</p></div></div>
    <div class="project-grid">{projects.map((p,i)=><button class={`project-card ${p.id===selected.id?"active":""}`} onClick={()=>setSelected(p)}><div class="project-mark" style={{background:COLORS[i%COLORS.length]}}>{(p.name||p.id).slice(0,2).toUpperCase()}</div><div><h3>{p.display_name||p.name}</h3><code>{p.id}</code><p>{fmt(p.memory_count)} memories · {fmt(p.agent_count)} agents · {fmt(p.session_count)} sessions</p></div><span>→</span></button>)}</div>
    <div class="two-col"><Panel title="Project definition" subtitle="Used to classify imports and future agent writes"><div class="definition-list"><div><span>Canonical folder / repo</span><code>{profile?.canonicalFolder||selected.id}</code></div><div><span>Display name</span><b>{profile?.displayName||selected.name}</b></div><div><span>Aliases</span><p>{(profile?.aliases||[]).join(", ")||"No aliases yet"}</p></div><div><span>Related sources</span><p>{(profile?.relatedSources||[]).join(", ")||"No related data folders"}</p></div></div><button>Edit project definition</button></Panel>
      <Panel title="Agent activity" subtitle="Who has written context into this project"><div class="agent-list">{(meta?.agents||[]).length?(meta.agents||[]).map((a,i)=><div><span class="avatar" style={{background:COLORS[i%COLORS.length]}}>{(a.name||a.id)[0]?.toUpperCase()}</span><span><b>{a.name||a.id}</b><small>{fmt(a.memory_count)} memories</small></span><time>{when(a.updated_at)}</time></div>):<Empty title="No attributed agents" body="Imported records remain visible while their identities are reconciled."/>}</div></Panel></div>
  </div>;
}

function Analytics({ analytics, requests }) {
  const bar = useMemo(()=>({tooltip:{trigger:"axis",axisPointer:{type:"shadow"},formatter:p=>`<b>${p[0]?.axisValue}</b><br/>${fmt(p[0]?.value)} memories`},grid:{left:90,right:16,top:12,bottom:24},xAxis:{type:"value",axisLabel:{color:"#78959d"},splitLine:{lineStyle:{color:"#153943"}}},yAxis:{type:"category",data:(analytics?.byAgent||[]).slice(0,8).reverse().map(x=>x.label),axisLabel:{color:"#98b2b8",width:76,overflow:"truncate"}},series:[{type:"bar",data:(analytics?.byAgent||[]).slice(0,8).reverse().map((x,i)=>({value:x.count,itemStyle:{color:COLORS[i%COLORS.length],borderRadius:[0,4,4,0]}})),barWidth:12}]}),[analytics]);
  const life = useMemo(()=>({tooltip:{trigger:"item",formatter:p=>`<b>${p.name}</b><br/>${fmt(p.value)} · ${p.percent}%`},legend:{bottom:0,textStyle:{color:"#8faab0"}},series:[{type:"pie",radius:["32%","70%"],center:["50%","43%"],roseType:"radius",label:{color:"#9fb6bb",formatter:"{b}\n{d}%"},data:(analytics?.byLifecycle||[]).map((x,i)=>({name:x.status,value:x.count,itemStyle:{color:COLORS[i%COLORS.length]}}))}]}),[analytics]);
  return <div class="stack"><div class="section-title"><div><Badge tone="gold">INSIGHTS</Badge><h1>How memory is evolving</h1><p>Every visualization is calculated from ledger and request data and can be traced back to its records.</p></div><select><option>Last 30 days</option><option>Last 7 days</option><option>Last 90 days</option><option>All time</option></select></div>
    <div class="two-col"><Panel title="Agent contribution" subtitle="Attributed memories by agent"><Chart option={bar}/></Panel><Panel title="Memory lifecycle" subtitle="Current state of all records"><Chart option={life}/></Panel></div>
    <div class="insight-grid"><article><b>{fmt(analytics?.summary?.checkpoints)}</b><span>Resumable checkpoints</span><p>Project states ready for a handoff.</p></article><article><b>{analytics?.summary?.averageAgeDays||0}d</b><span>Average memory age</span><p>Useful when choosing summary windows.</p></article><article><b>{fmt(requests?.summary?.searches)}</b><span>Searches observed</span><p>Retrieval demand across clients.</p></article><article><b>{fmt(analytics?.provenance?.complete)}</b><span>Fully attributed</span><p>Records with agent and session identity.</p></article></div>
  </div>;
}

function Keys({ project, toast }) {
  const [keys,setKeys]=useState([]); const [issued,setIssued]=useState(null); const [show,setShow]=useState(false); const [issueOpen,setIssueOpen]=useState(false); const [label,setLabel]=useState("");
  const load=()=>api(pathFor(project,"api-keys")).then(x=>setKeys(x.keys||[])); useEffect(()=>{load();setIssued(null)},[project.id]);
  const create=async e=>{e.preventDefault();if(!label.trim())return;const x=await api(pathFor(project,"api-keys"),{method:"POST",body:JSON.stringify({label:label.trim()})});setIssued(x);setIssueOpen(false);setLabel("");toast("Key issued. Copy it now; it will not be shown again.");load()};
  return <div class="stack"><div class="section-title"><div><Badge tone="gold">ACCESS CONTROL</Badge><h1>API Keys</h1><p>Issue project keys for narrow access. Goldfish stores only a secure hash and shows the token once.</p></div><button class="primary" onClick={()=>setIssueOpen(true)}>+ Issue key</button></div>
    {issued&&<div class="secret-reveal"><div><Badge tone="coral">SHOWN ONCE</Badge><h3>{issued.label}</h3><code>{show?issued.token:"gf_live_••••••••••••••••••••••••••••••••"}</code></div><button onClick={()=>setShow(!show)}>{show?"Hide":"Reveal"}</button><button onClick={()=>navigator.clipboard.writeText(issued.token)}>Copy</button><button class="icon" onClick={()=>setIssued(null)}>×</button></div>}
    <div class="key-grid">{keys.map(k=><article class="key-card"><div><span class={`status-dot ${k.revokedAt?"off":""}`}/><Badge tone={k.revokedAt?"slate":"sea"}>{k.revokedAt?"Revoked":"Active"}</Badge></div><h3>{k.label||"Unnamed key"}</h3><code>{k.keyPrefix}••••••••</code><dl><div><dt>Scope</dt><dd>{k.accessScope||"project"}</dd></div><div><dt>Created</dt><dd>{when(k.createdAt)}</dd></div><div><dt>Last used</dt><dd>{when(k.lastUsedAt)}</dd></div><div><dt>Requests</dt><dd>{fmt(k.requestCount)}</dd></div></dl>{!k.revokedAt&&<button class="danger" onClick={async()=>{await api(pathFor(project,`api-keys/${k.id}`),{method:"DELETE"});toast("Key revoked");load()}}>Revoke key</button>}</article>)}</div>
    {issueOpen&&<div class="drawer-scrim" onClick={e=>e.target===e.currentTarget&&setIssueOpen(false)}><aside class="drawer"><header><div><Badge tone="gold">NEW CREDENTIAL</Badge><h2>Issue an API key</h2></div><button class="icon" onClick={()=>setIssueOpen(false)}>×</button></header><form class="drawer-body" onSubmit={create}><label>Key label<input autoFocus value={label} onInput={e=>setLabel(e.currentTarget.value)} placeholder="Codex Desktop"/></label><div class="lifecycle-state"><b>Project scope</b><p>This key can read and write only <code>{project.id}</code>. The full token is shown once.</p></div><button class="primary">Issue project key</button></form></aside></div>}
  </div>;
}

function Settings({ project, toast }) {
  const [settings,setSettings]=useState(null); const [docs,setDocs]=useState([]);
  useEffect(()=>{api(pathFor(project,"settings")).then(setSettings);api(pathFor(project,"workflow-documents")).then(x=>setDocs(x.documents||[])).catch(()=>setDocs([]))},[project.id]);
  if(!settings)return <div class="loading">Loading settings…</div>;
  const save=async()=>{await api(pathFor(project,"settings"),{method:"PATCH",body:JSON.stringify({projectInstructions:settings.curationPolicy?.projectInstructions||"",agentInstructions:settings.curationPolicy?.agentInstructions||"",multilingual:settings.multilingual,decay:settings.decay})});toast("Settings saved")};
  return <div class="stack"><div class="section-title"><div><Badge tone="sea">MEMORY RULES</Badge><h1>Settings</h1><p>Plain controls for what Goldfish keeps, how it cleans, and how local agents stay in sync.</p></div><button class="primary" onClick={save}>Save settings</button></div>
    <div class="settings-layout"><nav class="settings-nav"><button class="active">Project details</button><button>Memory rules</button><button>Categories</button><button>Search & relevance</button><button>Automation</button><button>Integrations</button><button>Agent instructions</button></nav><div class="settings-main">
      <Panel title="Project memory rules" subtitle="Instructions used by cleanup, summaries, and Goldfish Copilot"><label>Project context<textarea rows="7" value={settings.curationPolicy?.projectInstructions||""} onInput={e=>setSettings({...settings,curationPolicy:{...settings.curationPolicy,projectInstructions:e.currentTarget.value}})}/></label><label>Agent rules<textarea rows="7" value={settings.curationPolicy?.agentInstructions||""} onInput={e=>setSettings({...settings,curationPolicy:{...settings.curationPolicy,agentInstructions:e.currentTarget.value}})}/></label><div class="toggle-row"><label><input type="checkbox" checked={settings.multilingual} onChange={e=>setSettings({...settings,multilingual:e.currentTarget.checked})}/><span>Multilingual memory</span><small>Preserve the user’s language.</small></label><label><input type="checkbox" checked={settings.decay} onChange={e=>setSettings({...settings,decay:e.currentTarget.checked})}/><span>Relevance decay</span><small>Lower stale facts in retrieval without deleting them.</small></label></div></Panel>
      <Panel title="Agent instruction sync" subtitle="Canonical cloud copies and the status of local AGENTS.md, CLAUDE.md, and GEMINI.md">{docs.length?<div class="doc-list">{docs.map(d=><div><Badge tone={d.syncStatus==="synced"?"sea":"coral"}>{d.syncStatus||"pending"}</Badge><b>{d.client}</b><code>{d.pathHint}</code><time>{when(d.updatedAt)}</time><button>View diff</button></div>)}</div>:<Empty title="Local companion has not synced yet" body="Run the Goldfish workflow sync command on this computer to publish hashes and compare the three global instruction files."/>}</Panel>
    </div></div>
  </div>;
}

function Copilot({ project, open, setOpen, toast }) {
  const [messages,setMessages]=useState([{role:"assistant",content:"Ask me to find context, explain a metric, compare project activity, or prepare a cleanup proposal."}]); const [text,setText]=useState(""); const [conversation,setConversation]=useState(null); const [busy,setBusy]=useState(false);
  const send=async e=>{e.preventDefault();if(!text.trim()||busy)return;const value=text.trim();setText("");setMessages(m=>[...m,{role:"user",content:value}]);setBusy(true);try{const x=await api(pathFor(project,"copilot"),{method:"POST",body:JSON.stringify({message:value,conversationId:conversation||undefined})});setConversation(x.conversationId);setMessages(m=>[...m,{role:"assistant",content:x.reply,proposals:x.proposals||[]}])}catch(e){toast(e.message,"error")}finally{setBusy(false)}};
  const applyProposal=async p=>{await api(pathFor(project,`copilot/${conversation}/proposals/${p.id}/apply`),{method:"POST"});toast("Copilot proposal applied");setMessages(m=>[...m,{role:"assistant",content:`Applied: ${p.summary}`}])};
  return <aside class={`copilot ${open?"open":""}`}><header><img src="/goldfish-logo.png"/><div><b>Goldfish Copilot</b><span>Project-aware memory operator</span></div><button class="icon" onClick={()=>setOpen(false)}>×</button></header><div class="copilot-log">{messages.map(m=><div class={`bubble ${m.role}`}><p>{m.content}</p>{m.proposals?.map(p=><button class="proposal" onClick={()=>applyProposal(p)}>Review and apply: {p.summary}</button>)}</div>)}{busy&&<div class="thinking"><i/><i/><i/></div>}</div><form onSubmit={send}><textarea rows="2" value={text} onInput={e=>setText(e.currentTarget.value)} placeholder="Ask about this project…"/><button class="primary">Send</button></form></aside>;
}

function App() {
  const [nav,setNav]=useState("overview"),[projects,setProjects]=useState([]),[project,setProject]=useState(null),[analytics,setAnalytics]=useState(null),[meta,setMeta]=useState(null),[requests,setRequests]=useState(null),[profile,setProfile]=useState(null),[copilot,setCopilot]=useState(false),[notice,setNotice]=useState(null),[mobile,setMobile]=useState(false);
  const toast=(message,tone="ok")=>{setNotice({message,tone});setTimeout(()=>setNotice(null),4000)};
  useEffect(()=>{api("/admin/api/projects").then(x=>{setProjects(x.projects||[]);setProject((x.projects||[])[0]||null)}).catch(e=>toast(e.message,"error"))},[]);
  const reload=async()=>{if(!project)return;const [a,m,r,p]=await Promise.all([api(pathFor(project,"analytics?range=30d")),api(pathFor(project,"meta")),api(pathFor(project,"requests?range=30d")).catch(()=>({requests:[],summary:{}})),api(pathFor(project,"profile")).catch(()=>({profile:null}))]);setAnalytics(a);setMeta(m);setRequests(r);setProfile(p.profile)};
  useEffect(()=>{reload().catch(e=>toast(e.message,"error"))},[project?.id]);
  if(!project)return <main class="boot"><img src="/goldfish-logo.png"/><h1>Preparing the aquarium…</h1></main>;
  const page={overview:<Overview project={project} analytics={analytics} requests={requests} onNavigate={setNav}/>,memories:<Memories project={project} meta={meta} toast={toast}/>,requests:<Requests project={project} data={requests} reload={reload}/>,projects:<Projects projects={projects} selected={project} setSelected={setProject} meta={meta} profile={profile}/>,analytics:<Analytics analytics={analytics} requests={requests}/>,keys:<Keys project={project} toast={toast}/>,settings:<Settings project={project} toast={toast}/>}[nav];
  return <div class="shell">
    <aside class={`rail ${mobile?"open":""}`}><a class="brand"><span class="brand-mark"><img src="/goldfish-logo.png"/></span><span><b>GOLDFISH</b><small>Memory Aquarium</small></span></a><nav>{NAV.map(([id,label])=><button class={nav===id?"active":""} onClick={()=>{setNav(id);setMobile(false)}}><span>{({overview:"⌂",memories:"◫",requests:"⇄",projects:"◎",analytics:"⌁",keys:"◇",settings:"⚙"})[id]}</span>{label}{id==="requests"&&requests?.summary?.errors>0&&<i>{requests.summary.errors}</i>}</button>)}</nav><div class="rail-bottom"><button onClick={()=>setCopilot(true)} class="copilot-launch"><img src="/goldfish-logo.png"/><span><b>Ask Goldfish</b><small>Search, explain, improve</small></span></button><div class="privacy"><i/>Private Cloudflare workspace</div><button class="logout" onClick={async()=>{await api("/admin/logout",{method:"POST"});location.reload()}}>Sign out</button></div></aside>
    <main class="workspace"><header class="topbar"><button class="menu" onClick={()=>setMobile(!mobile)}>☰</button><div class="crumb"><span>Memory Aquarium</span><b>/</b><strong>{NAV.find(x=>x[0]===nav)?.[1]}</strong></div><div class="top-actions"><label class="project-select"><span>Project</span><select value={project.id} onChange={e=>setProject(projects.find(p=>p.id===e.currentTarget.value))}>{projects.map(p=><option value={p.id}>{p.display_name||p.name}</option>)}</select></label><button class="icon" title="Refresh data" onClick={reload}>↻</button><button class="fish-button" onClick={()=>setCopilot(true)}><img src="/goldfish-logo.png"/>Copilot</button></div></header><div class="content">{page}</div></main>
    <Copilot project={project} open={copilot} setOpen={setCopilot} toast={toast}/>{copilot&&<div class="copilot-scrim" onClick={()=>setCopilot(false)}/>} {notice&&<div class={`toast ${notice.tone}`}>{notice.message}</div>}
  </div>;
}

render(<App/>, document.getElementById("app"));
