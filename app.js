import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTION_NAME, MY_TEAM } from "./config.js";
import { scoreNight, paperText } from "./scoring.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s) => { s = String(s ?? ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const FN = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the phone's time zone
const Q = new URLSearchParams(location.search);
const DEMO = Q.get("demo") === "1"; // local-only sample night, never touches Supabase

const S = { code: DEMO ? "demo" : localStorage.getItem("teamCode"), night: localStorage.getItem("night") || today(), game: null, view: null, rows: [], uploads: [], chan: null, loaded: false, base: null, flash: {} };

async function call(body) {
  if (DEMO) throw new Error("Demo mode: nothing is saved.");
  const isForm = body instanceof FormData;
  if (!isForm) body = JSON.stringify({ ...body, code: S.code });
  else body.set("code", S.code);
  const res = await fetch(FN, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, ...(isForm ? {} : { "Content-Type": "application/json" }) }, body });
  const out = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status === 401) { localStorage.removeItem("teamCode"); S.code = null; show(); }
  if (!res.ok) throw new Error(cap(out.error || `HTTP ${res.status}`));
  return out;
}

// ---------- team code gate ----------
function show() {
  $("#gate").hidden = !!S.code; $("#app").hidden = !S.code;
  if (S.code) start();
}
$("#gateForm").onsubmit = async (e) => {
  e.preventDefault();
  S.code = $("#code").value.trim();
  try { await call({ action: "check" }); localStorage.setItem("teamCode", S.code); show(); }
  catch (err) { $("#gateErr").textContent = cap(err.message); S.code = null; }
};
$("#logout").onclick = () => { if (!DEMO) localStorage.removeItem("teamCode"); S.code = null; location.href = location.pathname; };

// ---------- header menu (change team code lives here) ----------
const menu = (open) => { $("#menu").hidden = !open; $("#menuBtn").setAttribute("aria-expanded", String(open)); };
$("#menuBtn").onclick = (e) => { e.stopPropagation(); menu($("#menu").hidden); };
document.addEventListener("click", (e) => { if (!$("#menu").hidden && !e.target.closest("#menu")) menu(false); });

// ---------- data + realtime ----------
async function load() {
  if (DEMO) return;
  const { data, error } = await sb.from("reads").select("*").eq("night_date", S.night).order("created_at");
  if (!error) { S.rows = data; S.loaded = true; render(); }
}
function subscribe() {
  if (DEMO) return;
  if (S.chan) sb.removeChannel(S.chan);
  S.chan = sb.channel(`reads-${S.night}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "reads", filter: `night_date=eq.${S.night}` }, ({ new: row }) => {
      if (!row?.id) return;
      const i = S.rows.findIndex((r) => r.id === row.id);
      i < 0 ? S.rows.push(row) : (S.rows[i] = row);
      render();
    })
    .subscribe((st) => { $("#live").className = "live " + (st === "SUBSCRIBED" ? "on" : "off"); if (st === "SUBSCRIBED") load(); });
}

// Demo: ?demo=1 shows the sample night (all 3 games); &upto=N starts with N games and "Add Next Game" simulates a live read arriving.
let demoUpto = Math.max(0, Math.min(3, +(Q.get("upto") ?? 3)));
let DEMO_ROWS = [];
function demoRows() { S.rows = structuredClone(DEMO_ROWS.filter((r) => r.game_no <= demoUpto)); S.loaded = true; $("#demoNext").hidden = demoUpto >= 3; render(); }

let started = false;
async function start() {
  if (started) return; started = true;
  $("#night").value = S.night;
  if (DEMO) {
    ({ DEMO_ROWS } = await import("./demo.js"));
    $("#demoBar").hidden = false;
    $("#demoNext").onclick = () => { if (demoUpto < 3) { demoUpto++; demoRows(); } };
    demoRows(); return;
  }
  render();
  subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
function setNight(v) {
  S.night = v || today(); $("#night").value = S.night; localStorage.setItem("night", S.night);
  S.game = null; S.view = null; S.base = null; S.flash = {};
  if (DEMO) return render();
  S.rows = []; S.loaded = false; subscribe(); render();
}
$("#night").onchange = (e) => setNight(e.target.value);
const shiftNight = (days) => { const d = new Date(S.night + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); setNight(d.toISOString().slice(0, 10)); };
$("#prevNight").onclick = () => shiftNight(-7);
$("#nextNight").onclick = () => shiftNight(7);
$("#gamePick").onclick = (e) => { const g = e.target.closest("button")?.dataset.g; if (!g) return; if (g === "S") S.view = "S"; else { S.game = +g; S.view = +g; } render(); };

// ---------- photo upload ----------
async function shrink(file, max = 2048) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.88));
  } catch { return file; }
}
async function send(files) {
  if (DEMO) return alert("Demo mode: uploads are off. Nothing is saved.");
  const game = curGame();
  for (const f of files) {
    const u = { label: `Game ${game} Photo ${S.uploads.length + 1}`, state: "Uploading…" };
    S.uploads.push(u); render();
    (async () => {
      try {
        const fd = new FormData();
        fd.set("night_date", S.night); fd.set("game", game);
        fd.set("photo", await shrink(f), "screen.jpg");
        u.state = "Reading Scores…"; render();
        const r = await call(fd);
        u.state = r.status === "done" ? `✓ ${r.data.team_name}` : `✗ ${cap(r.error)}`;
      } catch (e) { u.state = `✗ ${cap(e.message)}`; }
      render(); load();
    })();
  }
}
for (const id of ["#cam", "#lib"]) $(id).onchange = (e) => { send([...e.target.files]); e.target.value = ""; };

// ---------- fixes ----------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-read]");
  if (!t) return;
  const row = S.rows.find((r) => r.id === t.dataset.read);
  if (t.dataset.act) {
    if (DEMO) return alert("Demo mode: nothing is saved.");
    if (t.dataset.act === "discard" && !confirm("Hide this photo from scoring?")) return;
    try { await call({ action: t.dataset.act, read_id: row.id, discarded: !row.discarded }); } catch (err) { alert(err.message); }
    return load();
  }
  const path = t.dataset.path, keys = path.split(".");
  const cur = keys.reduce((o, k) => o?.[k], row.data);
  const last = keys.at(-1);
  const isNum = !["name", "team_name", "status"].includes(last);
  let v = prompt(t.dataset.label || path, last === "status" ? cap(cur ?? "") : cur ?? "");
  if (v === null) return;
  v = v.trim();
  if (last === "status") v = v.toLowerCase();
  if (isNum) { if (v === "") v = null; else if (!/^\d+$/.test(v)) return alert("Please enter a whole number."); else v = +v; }
  // optimistic local update so this phone re-scores instantly; Realtime pushes it to everyone else
  const prev = structuredClone(row.data);
  let o = row.data; for (const k of keys.slice(0, -1)) o = o[k];
  o[last] = v; render();
  if (DEMO) return;
  try { await call({ action: "fix", read_id: row.id, path, value: v }); }
  catch (err) { row.data = prev; render(); alert(err.message); }
});

// ---------- render ----------
let N = null;
const scoredGames = () => [1, 2, 3].filter((g) => N?.games[g]?.result);
const curGame = () => S.game ?? ([1, 2, 3].find((g) => !N?.games[g]?.result) ?? 3); // where the next photo goes
const curView = () => S.view ?? (scoredGames().at(-1) ?? curGame()); // what the results area shows
const flagsFor = (id) => N?.readFlags[id] ?? [];
function cls(id, path) {
  const f = flagsFor(id).filter((x) => x.path === path || (path.endsWith("hcp_game") && x.path === path.replace("hcp_game", "scratch") && x.level === "unsure"));
  return f.some((x) => x.level === "bad") ? "bad" : f.some((x) => x.level === "unsure") ? "unsure" : "";
}
const cell = (read, path, val, label, extra = "") =>
  read ? `<td class="fixable ${cls(read.id, path)} ${extra}" data-read="${read.id}" data-path="${path}" data-label="${esc(label)}">${esc(val ?? "?")}</td>` : `<td class="${extra}">${esc(val ?? "?")}</td>`;
const fixSpan = (read, path, val, label) =>
  read ? `<span class="fixable ${cls(read.id, path)}" data-read="${read.id}" data-path="${path}" data-label="${esc(label)}">${esc(val ?? "?")}</span>` : `<span>${esc(val ?? "?")}</span>`;
const num = (x) => (x == null ? "?" : Number.isInteger(x) ? String(x) : x % 1 === 0.5 ? `${Math.floor(x) || ""}½` : x.toFixed(1));
const numTxt = (x) => (x == null ? "?" : Number.isInteger(x) ? String(x) : x.toFixed(1)); // 11.5 style for totals
const pts = (p) => (p ? p.map(numTxt).join("–") : "?");
const win = (p, i) => (p && p[i] > p[1 - i] ? "w" : "");
const cols = (...w) => `<colgroup>${w.map((x) => `<col${x ? ` style="width:${x}px"` : ""}>`).join("")}</colgroup>`;
const flagList = (fl) => (fl.length ? `<ul class="flags">${fl.map((f) => `<li class="${f.level || "info"}">${esc(cap(f.msg ?? f))}</li>`).join("")}</ul>` : "");
const STATUS = { absent: "Absent", vacant: "Vacant" };

function nightLabel(d) {
  if (DEMO) return "Demo Night";
  const t = new Date(d + "T12:00:00");
  const lbl = t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return d === today() ? `Tonight · ${t.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : lbl;
}

// One mirrored head-to-head row: [name + detail] [BIG score + chip]  #  [BIG score + chip] [name + detail]
function nameBlock(name, detail, side) {
  const [first, ...rest] = String(name || "?").trim().split(/\s+/);
  return `<div class="mu-p ${side}"><b>${esc(first)}</b>${rest.length ? `<span>${esc(rest.join(" "))}</span>` : ""}${detail ? `<small>${detail}</small>` : ""}</div>`;
}
function scoreBlock(inner, p, i) {
  const st = !p ? "" : p[i] > p[1 - i] ? "w" : p[i] < p[1 - i] ? "lo" : "tie";
  return `<div class="mu-s ${st}"><span class="big">${inner}</span><i class="chip">${p ? num(p[i]) : "?"}</i></div>`;
}
const detail = (x, hcpKnown = true) => {
  const tag = STATUS[x.status] ? `<em>${STATUS[x.status]}</em> · ` : "";
  return `${tag}Scr ${x.scratch ?? "?"}${hcpKnown ? ` · Hdcp ${x.hcp ?? "?"}` : ""}`;
};
const muRow = (spot, a, b, sa, sb2, p, cls2 = "") =>
  `<div class="mu-row ${cls2}">${a}${scoreBlock(sa, p, 0)}<div class="mu-mid">${spot}</div>${scoreBlock(sb2, p, 1)}${b}</div>`;

function gameCard(g) {
  const { reads, result: r } = N.games[g];
  const [A, B] = N.sides;
  if (!r) {
    const have = reads.filter(Boolean).map((x) => x.data.team_name);
    const reading = S.rows.some((x) => x.game_no === g && x.status === "reading");
    return `<div class="card"><div class="card-h">Game ${g}</div><div class="card-b muted">${reading ? "Reading Scores…" : have.length ? `Have ${esc(have.join(", "))}. Snap the other lane.` : "No photos yet. Snap both lane screens after this game."}</div></div>`;
  }
  const rows = r.spots.map((s, i) => muRow(`<span class="rank">${s.spot}</span>`,
    nameBlock(s.a.name, detail(s.a), "l"), nameBlock(s.b.name, detail(s.b), "r"),
    fixSpan(reads[0], `bowlers.${i}.hcp_game`, s.a.game, `${s.a.name} Handicap Game`),
    fixSpan(reads[1], `bowlers.${i}.hcp_game`, s.b.game, `${s.b.name} Handicap Game`), s.pts)).join("");
  const team = muRow("", nameBlock("Team", `Scr ${reads[0]?.data.team_scratch ?? "?"}`, "l"), nameBlock("Team", `Scr ${reads[1]?.data.team_scratch ?? "?"}`, "r"),
    fixSpan(reads[0], "team_hcp_total", r.teams[0], "Team Handicap Total (Screen)"), fixSpan(reads[1], "team_hcp_total", r.teams[1], "Team Handicap Total (Screen)"), r.teamPts, "team");
  return `<div class="card mu"><div class="card-h">Game ${g} Matchups<span class="score-chip">${pts(r.pts)}</span></div>${rows}${team}
    <div class="mu-foot">Game ${g}: <b>${esc(A.name)} ${numTxt(r.pts[0])}</b> – <b>${numTxt(r.pts[1])} ${esc(B.name)}</b></div>${flagList(r.flags)}</div>`;
}

function seriesCard() {
  const s = N.series, [A, B] = N.sides;
  if (!s) return `<div class="card"><div class="card-h">Series</div><div class="card-b muted">The 3-game series is scored once all three games are in.</div></div>`;
  const rows = s.spots.map((x) => muRow(`<span class="rank">${x.spot}</span>`, nameBlock(x.a.name, detail(x.a, false), "l"), nameBlock(x.b.name, detail(x.b, false), "r"),
    `<span>${x.a.game ?? "?"}</span>`, `<span>${x.b.game ?? "?"}</span>`, x.pts)).join("");
  const team = muRow("", nameBlock("Team", "3-Game Hdcp", "l"), nameBlock("Team", "3-Game Hdcp", "r"), `<span>${s.teams[0] ?? "?"}</span>`, `<span>${s.teams[1] ?? "?"}</span>`, s.teamPts, "team");
  return `<div class="card mu"><div class="card-h">Series Matchups <small>3-Game Hdcp</small><span class="score-chip">${pts(s.pts)}</span></div>${rows}${team}
    <div class="mu-foot">Series: <b>${esc(A.name)} ${numTxt(s.pts[0])}</b> – <b>${numTxt(s.pts[1])} ${esc(B.name)}</b></div>${flagList(s.flags)}</div>`;
}

// A failed/stuck read is hidden once a later good read exists for the same game.
const superseded = (r, rows) => r.status !== "done" && r.status !== "reading" && rows.some((x) => x.game_no === r.game_no && x.status === "done" && x.created_at > r.created_at);

function screensHtml() {
  const all = [...S.rows].sort((a, b) => a.game_no - b.game_no || a.created_at.localeCompare(b.created_at));
  const rows = all.filter((r) => !superseded(r, all));
  if (!rows.length) return `<p class="muted">Snap the lane screen after each game: one photo per lane.</p>`;
  return rows.map((r) => {
    const img = r.photo_path ? sb.storage.from("screens").getPublicUrl(r.photo_path).data.publicUrl : "";
    const head = (sub) => `<div class="shot">${img ? `<a href="${esc(img)}" target="_blank"><img src="${esc(img)}" loading="lazy" alt="Lane Screen"></a>` : `<span class="noimg">Sample</span>`}<div>
      <b>Game ${r.game_no}</b>${r.discarded ? `<span class="hidden-tag">Hidden</span>` : ""}${sub}</div></div>`;
    const btns = `<div class="row"><button class="btn-sm" data-read="${r.id}" data-act="retry">Re-Read</button><button class="btn-sm" data-read="${r.id}" data-act="discard">${r.discarded ? "Use Again" : "Hide"}</button></div>`;
    if (r.status !== "done") return `<div class="shot-card">${head(r.status === "reading" ? `<span class="team muted">Reading Scores…</span>` : `<div class="err">${esc(cap(String(r.error ?? "").slice(0, 240)))}</div>`)}${btns}</div>`;
    const d = r.data, fl = flagsFor(r.id);
    const brows = d.bowlers.map((b, i) => `<tr>${cell(r, `bowlers.${i}.name`, b.name, "Name", "l")}${cell(r, `bowlers.${i}.status`, STATUS[b.status] ?? "", "Status (Bowled / Absent / Vacant)", "c")}${cell(r, `bowlers.${i}.scratch`, b.scratch, `${b.name} Scratch`)}${cell(r, `bowlers.${i}.hcp`, b.hcp, `${b.name} Handicap`)}${cell(r, `bowlers.${i}.hcp_game`, b.hcp_game, `${b.name} Handicap Game`)}</tr>`).join("");
    const nf = r.edits?.length ?? 0;
    const sub = `<span class="team"><span class="fixable" data-read="${r.id}" data-path="team_name" data-label="Team Name">${esc(d.team_name)}</span> · Lane ${d.lane ?? "?"}</span>${nf ? `<small class="muted">${nf} ${nf === 1 ? "Fix" : "Fixes"}</small>` : ""}`;
    return `<div class="shot-card">${head(sub)}
      <table>${cols(0, 34, 48, 48, 54)}<tr><th class="l">Bowler</th><th></th><th>Scr</th><th>Hdcp</th><th>Game</th></tr>${brows}
      <tr class="tot"><td class="l">Team</td><td></td>${cell(r, "team_scratch", d.team_scratch, "Team Scratch")}${cell(r, "team_hcp", d.team_hcp ?? "–", "Team Handicap")}${cell(r, "team_hcp_total", d.team_hcp_total, "Team Handicap Total")}</tr></table>
      ${flagList(fl)}${d.notes ? `<p class="muted" style="margin:0;padding:8px 12px;overflow-wrap:anywhere">Reader: ${esc(cap(d.notes))}</p>` : ""}${btns}</div>`;
  }).join("");
}

// Paper-sheet text comes from scoring.js; only its wording/capitalization is polished here.
const paper = (t) => t
  .replace(/^(.*?)  vs  (.*)$/m, "$1  VS  $2")
  .replace(/: waiting for both photos/g, ": Waiting for Both Photos")
  .replace(/^NIGHT (.*?)\s+\((\S+) still up of 35\)$/m, "Night Total: $1  ($2 of 35 Still Up)");

// Snapshot of every score on the board, used to auto-switch to a newly scored game and flash what changed.
const snap = () => ({ 1: N.games[1].result && pts(N.games[1].result.pts), 2: N.games[2].result && pts(N.games[2].result.pts), 3: N.games[3].result && pts(N.games[3].result.pts), S: N.series && pts(N.series.pts), N: pts(N.totals) });
function track() {
  if (!S.loaded) return;
  const now = snap();
  if (!S.base) { S.base = now; return; }
  const t = Date.now() + 1600;
  for (const k of Object.keys(now)) if (now[k] !== S.base[k]) {
    S.flash[k] = t;
    if (k !== "N" && k !== "S" && now[k] && !S.base[k]) { S.view = +k; S.game = null; } // a new game just got scored: show it
  }
  S.base = now;
}
const fl = (k) => ((S.flash[k] ?? 0) > Date.now() ? " flash" : "");

function scoreboard(v) {
  const two = N.sides.length >= 2;
  const A = N.sides[0]?.name ?? MY_TEAM ?? "Us", B = two ? N.sides[1].name : "Opponent";
  const r = v === "S" ? N.series : N.games[v]?.result;
  const big = (p, i) => `<b class="${!p ? "none" : p[i] > p[1 - i] ? "w" : p[i] < p[1 - i] ? "lo" : "tie"}">${p ? numTxt(p[i]) : "–"}</b>`;
  const T = two && scoredGames().length ? N.totals : null;
  return `<div class="sb-teams"><span>${esc(A)}</span><span>${esc(B)}</span></div>
    <div class="sb-row${fl(v)}">${big(r?.pts, 0)}<div class="sb-lbl">${v === "S" ? "Series" : `Game ${v}`}${r ? "" : `<small>${v === "S" ? "After Game 3" : "Not In Yet"}</small>`}</div>${big(r?.pts, 1)}</div>
    <div class="sb-row night${fl("N")}">${big(T, 0)}<div class="sb-lbl">Night Total<small>${N.up} of 35 Still Up</small></div>${big(T, 1)}</div>`;
}

function render() {
  N = scoreNight(S.rows, { myTeam: MY_TEAM });
  track();
  const g = curGame(), v = curView();
  const tabScore = (k) => { const r = k === "S" ? N.series : N.games[k]?.result; return r ? pts(r.pts) : "–"; };
  document.querySelectorAll("#gamePick button").forEach((b) => {
    const k = b.dataset.g;
    b.classList.toggle("on", String(v) === k);
    b.className = b.className.replace(/\s?flash/g, "") + fl(k);
    b.querySelector(".ts").textContent = tabScore(k);
  });
  $("#sbMain").innerHTML = scoreboard(v);
  $("#nightLbl").textContent = nightLabel(S.night);
  $("#snapLbl").textContent = `Snap Game ${g} Photo`;
  $("#uploads").innerHTML = S.uploads.slice(-6).map((u) => `<li>${esc(u.label)}: ${esc(u.state)}</li>`).join("");
  const flagged = Object.values(N.readFlags).flat().filter((f) => f.level !== "info").length;
  if (flagged && !S.openedScreens) { $("#screensBox").open = true; S.openedScreens = true; }
  if (N.sides.length < 2) {
    $("#board").innerHTML = `<div class="banner">Scores appear once both lanes' photos for a game are in.</div>`;
    $("#screens").innerHTML = screensHtml(); return;
  }
  const sumRow = (i) => `<tr><td class="l">${esc(N.sides[i].name)}</td>${[1, 2, 3].map((k) => `<td>${N.games[k].result ? numTxt(N.games[k].result.pts[i]) : "–"}</td>`).join("")}<td>${N.series ? numTxt(N.series.pts[i]) : "–"}</td><td class="${N.totals[i] > N.totals[1 - i] ? "w" : ""}"><b>${numTxt(N.totals[i])}</b></td></tr>`;
  $("#board").innerHTML = `
    ${flagged ? `<div class="banner warn">⚠ ${flagged} ${flagged === 1 ? "number" : "numbers"} to check. Tap a highlighted number to fix it.</div>` : ""}
    ${N.notes.map((n) => `<div class="banner">${esc(cap(n))}</div>`).join("")}
    ${v === "S" ? seriesCard() : gameCard(v)}
    <div class="card"><div class="card-h">Points Tonight</div><table>${cols(0, 36, 36, 36, 54, 50)}<tr><th class="l">Team</th><th>G1</th><th>G2</th><th>G3</th><th>Ser</th><th>Total</th></tr>${sumRow(0)}${sumRow(1)}</table></div>
    <details class="card fold" id="paperBox"${S.paperOpen ? " open" : ""}><summary>For the Paper Sheet</summary><div class="fold-b"><button class="btn-sm" id="copy">Copy</button><pre id="paper">${esc(paper(paperText(N)))}</pre></div></details>`;
  $("#paperBox").ontoggle = (e) => { S.paperOpen = e.target.open; };
  $("#copy").onclick = () => navigator.clipboard?.writeText($("#paper").textContent).then(() => { $("#copy").textContent = "Copied"; });
  $("#screens").innerHTML = screensHtml();
  const next = Math.min(...Object.values(S.flash).filter((t) => t > Date.now()));
  if (Number.isFinite(next)) { clearTimeout(S.flashT); S.flashT = setTimeout(render, next - Date.now() + 20); }
}

if (SUPABASE_URL.includes("YOUR-PROJECT")) document.body.insertAdjacentHTML("afterbegin", `<p class="err" style="padding:12px">Fill in config.js (SUPABASE_URL, SUPABASE_ANON_KEY) first.</p>`);
show();
