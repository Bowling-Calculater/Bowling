import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTION_NAME, MY_TEAM } from "./config.js?v=8";
import { scoreNight, norm } from "./scoring.js?v=8";
import { SEASON } from "./season.js?v=8";

const $ = (s) => document.querySelector(s);
// ---------- stale-cache guard: GitHub Pages caches files ~10 min, phones can hold them longer ----------
export const APP_VERSION = "8";
async function checkVersion() {
  try {
    const j = await (await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" })).json();
    if (j.v && j.v !== APP_VERSION && sessionStorage.getItem("reloadedFor") !== j.v) {
      sessionStorage.setItem("reloadedFor", j.v);
      const u = new URL(location.href); u.searchParams.set("v", j.v); location.replace(u.toString());
    }
  } catch {}
}
checkVersion();
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s) => { s = String(s ?? ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const FN = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // league night date, YYYY-MM-DD (Central)
const Q = new URLSearchParams(location.search);
const DEMO = Q.get("demo") === "1"; // local-only sample night, never touches Supabase

const S = { code: DEMO ? "demo" : localStorage.getItem("teamCode"), night: today(), mode: "tonight", game: null, view: null, rows: [], uploads: [], chan: null, loaded: false, base: null, flash: {} };

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
// ---------- menu extras: League Rules, Season Stats, Photo Tips, Share Link ----------
const SITE_URL = "https://bowling-calculater.github.io/Bowling/"; // never add the team code here
function sheet(title, html) { menu(false); $("#sheetTitle").textContent = title; $("#sheetBody").innerHTML = html; $("#sheet").hidden = false; $("#sheetBody").scrollTop = 0; }
$("#sheetClose").onclick = () => ($("#sheet").hidden = true);
$("#sheet").onclick = (e) => { if (e.target.id === "sheet") $("#sheet").hidden = true; };
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }

// Only what scoring.js implements (see README "Scoring rules implemented").
const RULES_HTML = `<p class="lead">Every night is worth <b>35 points</b>. Pairings are by lineup spot: spot 1 bowls against spot 1, and so on.</p>
  <table class="rules-t"><tr><th class="l">What</th><th>Each</th><th>Night</th></tr>
  <tr><td class="l">Bowler Handicap Game<small>5 spots × 3 games</small></td><td>1</td><td>15</td></tr>
  <tr><td class="l">Bowler Handicap Series<small>3-game total, 5 spots</small></td><td>2</td><td>10</td></tr>
  <tr><td class="l">Team Handicap Game<small>Team total, 3 games</small></td><td>2</td><td>6</td></tr>
  <tr><td class="l">Team Handicap Series<small>3-game team total</small></td><td>4</td><td>4</td></tr>
  <tr class="tot"><td class="l">Total</td><td></td><td>35</td></tr></table>
  <p class="lead">Scores include each bowler's handicap.</p>
  <h4>Ties</h4><p>Ties split the points: 0.5 – 0.5, 1 – 1 or 2 – 2.</p>
  <h4>Absent and Vacant Bowlers</h4>
  <ul><li>Absent and vacant bowlers are flagged so you can check them against the recap.</li>
  <li>Absent (blind): the screen's score is used. If the screen is blank, the app estimates average − 10 (max 235 scratch) and marks it to check.</li>
  <li>Vacancy: 100 scratch + 121 handicap = 221.</li>
  <li>A blind or vacant bowler can't win points. Against a vacancy, the bowler must bowl within 10 of their average (30 for the series) to take the point.</li>
  <li>A team of only blind or vacant bowlers can't win team points.</li></ul>
  <h4>Checked by Hand</h4><p>Forfeits, illegal lineups and averages that change mid-night aren't scored automatically. The app flags them instead.</p>`;
$("#mRules").onclick = () => sheet("League Rules", RULES_HTML);

const TIPS_ART = `<svg class="tips-art" viewBox="0 0 200 92" aria-hidden="true"><rect x="38" y="10" width="124" height="66" rx="6" fill="#2c4a78"/><rect x="45" y="17" width="110" height="52" rx="3" fill="#e6f0fb"/>
  ${[0, 1, 2, 3, 4].map((i) => `<rect x="51" y="${22 + i * 9}" width="${46 - (i % 2) * 8}" height="4" rx="2" fill="#9bb6d8"/><rect x="124" y="${22 + i * 9}" width="24" height="4" rx="2" fill="#3567a8"/>`).join("")}
  <path d="M92 76h16l4 10H88z" fill="#2c4a78"/><g transform="translate(150 44) rotate(-12)"><rect x="-17" y="-28" width="34" height="58" rx="7" fill="#fff" stroke="#3567a8" stroke-width="2.4"/><rect x="-12" y="-21" width="24" height="40" rx="2" fill="#e6f0fb"/><circle cy="24" r="2.2" fill="#3567a8"/></g>
  <path d="M176 10l2.4 5 5 2.4-5 2.4-2.4 5-2.4-5-5-2.4 5-2.4z" fill="#f2c230"/></svg>`;
const TIPS = [
  ["Snap After the Last Frame", "Wait until game totals show on the screen."],
  ["Shoot Straight On", "Stand square to the screen, not off to the side."],
  ["Fill the Frame", "Get the whole score table, edge to edge."],
  ["Avoid Glare", "Tilt a little if lights or reflections cover numbers."],
  ["Hold Still", "Tap to focus and keep steady so numbers aren't blurry."],
  ["Get Both Lanes", "One photo of each lane's screen, every game."],
];
$("#mTips").onclick = () => sheet("Photo Tips", `${TIPS_ART}<ol class="tips">${TIPS.map(([h, t]) => `<li><b>${h}</b><span>${t}</span></li>`).join("")}</ol>`);

$("#mShare").onclick = async () => {
  menu(false);
  if (navigator.share) { try { await navigator.share({ title: "Pot of Gold Scorer", text: "Live league night scores for Texas Strangers", url: SITE_URL }); } catch {} return; }
  try { await navigator.clipboard.writeText(SITE_URL); }
  catch { const t = document.createElement("textarea"); t.value = SITE_URL; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  toast("Link Copied");
};

// ---------- season: LeaguePals Weeks 1–10 (bundled, authoritative) + nights scored here after that ----------
// Test nights stay visible in Past Weeks (tagged Test) but never count toward the season.
const TEST_NIGHTS = new Set(["2026-01-01", "2026-11-02"]);
const LP_DATES = new Set(SEASON.weeks.map((w) => w.date));
const LP_LAST = SEASON.weeks.at(-1).date;
const isTestNight = (d) => TEST_NIGHTS.has(d) || d < SEASON.weeks[0].date; // anything before Week 1 was setup testing
const countsForSeason = (d) => !isTestNight(d) && !LP_DATES.has(d) && d > LP_LAST;
const titleCase = (n) => String(n ?? "").toLowerCase().replace(/(^|[\s'\-.])\p{L}/gu, (m) => m.toUpperCase()).trim();
const isOurs = (name) => { const a = norm(name), b = norm(MY_TEAM); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

// Each bowler: games, scratch pins, highs (scratch + with handicap). Weeks 1–10 from LeaguePals weekly rows
// (they add up exactly to the LeaguePals roster totals); later nights from photo reads on this site.
// Points Won: share of all points played for (for ÷ (for + against)); callers pass season-only totals (no test/demo nights).
const ptsWonTile = (pf, pa) => pf + pa > 0 ? `<div class="pw-pct"><small>Points Won</small><b>${Math.round((pf / (pf + pa)) * 100)}%</b><small class="sub">${numTxt(pf)} of ${numTxt(pf + pa)}</small></div>` : `<div class="pw-pct"><small>Points Won</small><b>–</b></div>`;

function seasonStats(byNight) {
  const P = {};
  const bowler = (name) => (P[norm(name)] ??= { name: titleCase(name), g: 0, pins: 0, hg: 0, hs: 0, hgH: 0, hsH: 0, extra: 0 });
  const add = (name, games, hcpGames, isExtra) => {
    const p = bowler(name), gs = games.filter((x) => x != null);
    if (!gs.length) return;
    p.g += gs.length; p.pins += gs.reduce((t, x) => t + x, 0); p.hg = Math.max(p.hg, ...gs); if (isExtra) p.extra += gs.length;
    const hs = hcpGames.filter((x) => x != null);
    if (hs.length) p.hgH = Math.max(p.hgH, ...hs);
    if (gs.length === 3) { p.hs = Math.max(p.hs, gs[0] + gs[1] + gs[2]); if (hs.length === 3) p.hsH = Math.max(p.hsH, hs[0] + hs[1] + hs[2]); }
  };
  const team = { pf: 0, pa: 0, w: 0, l: 0, t: 0, weeks: 0, hg: 0, hs: 0, extraNights: 0 };
  for (const w of SEASON.weeks) {
    for (const b of w.bowlers) add(b.name, b.games, b.games.map((x) => (x == null ? null : x + b.hcp)), false);
    const [a, o] = w.points; team.pf += a; team.pa += o; team.weeks++; a > o ? team.w++ : a < o ? team.l++ : team.t++;
    team.hg = Math.max(team.hg, ...w.ours.slice(0, 3)); team.hs = Math.max(team.hs, w.ours[3]);
  }
  for (const [d, rows] of Object.entries(byNight)) {
    if (!countsForSeason(d)) continue;
    const n = scoreNight(rows, { myTeam: MY_TEAM }), k = n.sides.findIndex((x) => isOurs(x.name));
    if (k < 0) continue;
    const per = {};
    for (const g of [1, 2, 3]) for (const b of n.games[g].reads[k]?.data.bowlers ?? []) {
      if (b.status !== "bowled" || b.scratch == null || !norm(b.name)) continue;
      const e = (per[norm(b.name)] ??= { name: b.name, s: [null, null, null], h: [null, null, null] });
      e.s[g - 1] = b.scratch; e.h[g - 1] = b.hcp_game ?? null;
    }
    for (const e of Object.values(per)) add(e.name, e.s, e.h, true);
    if (n.up === 0) { const a = n.totals[k], o = n.totals[1 - k]; team.pf += a; team.pa += o; team.weeks++; a > o ? team.w++ : a < o ? team.l++ : team.t++; }
    team.extraNights++;
  }
  // LeaguePals' own average wins while a bowler has no newer games (it shows an entering average for new bowlers).
  const lp = Object.fromEntries(SEASON.roster.map((r) => [norm(r.name), r]));
  for (const [k, p] of Object.entries(P)) p.avg = !p.extra && lp[k] ? lp[k].avg : Math.floor(p.pins / p.g);
  return { bowlers: Object.values(P).sort((a, b) => (b.g >= 9) - (a.g >= 9) || b.avg - a.avg || b.g - a.g || a.name.localeCompare(b.name)), team, lp };
}
function statsHtml({ bowlers, team, lp }) {
  const nm = (n) => { const [f, ...l] = n.split(" "); return `<b>${esc(f)}</b> ${esc(l.join(" "))}`; };
  const entering = bowlers.filter((b) => !b.extra && lp[norm(b.name)] && lp[norm(b.name)].avg !== Math.floor(b.pins / b.g));
  return `<div class="st-tiles"><div><small>Points</small><b>${numTxt(team.pf)}–${numTxt(team.pa)}</b></div>${ptsWonTile(team.pf, team.pa)}<div><small>Standing</small><b>${ord(SEASON.standing.position)}</b><small>After Week ${SEASON.standing.after_week}</small></div></div>
    <h4 class="st-h">Bowlers <small>Scratch, No Handicap</small></h4>
    <div class="stats-wrap"><table class="stats-t"><colgroup><col><col style="width:46px"><col style="width:40px"><col style="width:48px"><col style="width:52px"></colgroup>
    <tr><th class="l">Bowler</th><th>Games</th><th>Avg</th><th>High Game</th><th>High Series</th></tr>
    ${bowlers.map((b) => `<tr><td class="l">${nm(b.name)}</td><td>${b.g}</td><td><b>${b.avg}</b></td><td>${b.hg || "–"}</td><td>${b.hs || "–"}</td></tr>`).join("")}</table></div>
    <h4 class="st-h">Highs With Handicap</h4>
    <div class="stats-wrap"><table class="stats-t"><colgroup><col><col style="width:70px"><col style="width:70px"></colgroup>
    <tr><th class="l">Bowler</th><th>High Game</th><th>High Series</th></tr>
    ${bowlers.map((b) => `<tr><td class="l">${nm(b.name)}</td><td>${b.hgH || "–"}</td><td>${b.hsH || "–"}</td></tr>`).join("")}
    <tr class="tot"><td class="l"><b>Team</b></td><td>${team.hg || "–"}</td><td>${team.hs || "–"}</td></tr></table></div>
    <p class="fine">Weeks 1–${SEASON.weeks.length} come from LeaguePals${team.extraNights ? `, plus ${team.extraNights} later ${team.extraNights === 1 ? "night" : "nights"} scored here` : ""}. Test nights aren't counted.${entering.length ? ` ${entering.map((b) => b.name.split(" ")[0]).join(" and ")} ${entering.length === 1 ? "shows" : "show"} the average LeaguePals lists (entering average) until more games are bowled.` : ""}</p>`;
}
$("#mStats").onclick = async () => {
  sheet("Season Stats", `<p class="muted">Loading Season Stats…</p>`);
  const byNight = {};
  if (!DEMO) {
    const { data, error } = await sb.from("reads").select("id,night_date,game_no,status,discarded,created_at,data").eq("status", "done").gt("night_date", LP_LAST).order("created_at").limit(5000);
    if (error) return ($("#sheetBody").innerHTML = `<div class="banner warn">Couldn't load stats: ${esc(error.message)}</div>`);
    for (const r of data) if (!r.discarded) (byNight[r.night_date] ??= []).push(r);
  }
  $("#sheetBody").innerHTML = statsHtml(seasonStats(byNight));
};

const menu = (open) => { $("#menu").hidden = !open; $("#menuBtn").setAttribute("aria-expanded", String(open)); };
$("#menuBtn").onclick = (e) => { e.stopPropagation(); menu($("#menu").hidden); };
document.addEventListener("click", (e) => { if (!$("#menu").hidden && !e.target.closest("#menu")) menu(false); });

// ---------- data + realtime ----------
async function load() {
  if (DEMO) return;
  const night = S.night;
  const { data, error } = await sb.from("reads").select("*").eq("night_date", night).order("created_at");
  if (!error && night === S.night && S.mode !== "past") { S.rows = data; S.loaded = true; render(); }
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
let DEMO_ROWS = [], DEMO_PAST = {};
function demoRows() { S.rows = structuredClone(DEMO_ROWS.filter((r) => r.game_no <= demoUpto)); S.loaded = true; $("#demoNext").hidden = demoUpto >= 3; render(); }

// ---------- views: Tonight (always today, Central time) / Past Weeks list / one past night ----------
const shortDate = (d, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(d + "T12:00:00").toLocaleDateString("en-US", opts);
function layout() {
  const m = S.mode;
  $("#seg").hidden = m === "night"; $("#pastBar").hidden = m !== "night";
  document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("#tonightLbl").textContent = DEMO ? "Demo" : shortDate(S.night, { month: "short", day: "numeric" });
  $("#nightView").hidden = m === "past"; $("#past").hidden = m !== "past";
  $("#uploadCtl").hidden = m !== "tonight"; $("#resetNight").hidden = m !== "tonight"; $("#clearBox").hidden = m !== "tonight";
  $("#demoBar").hidden = !DEMO || m !== "tonight";
  if (m === "night") $("#pastLbl").textContent = shortDate(S.night, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function openNight(d) {
  S.night = d; S.rows = []; S.game = null; S.view = null; S.base = null; S.flash = {}; S.loaded = false; S.openedScreens = false;
  layout();
  if (DEMO) { if (S.mode === "tonight") return demoRows(); S.rows = structuredClone(DEMO_PAST[d] ?? []); S.loaded = true; return render(); }
  subscribe(); render();
}
const goTonight = () => { S.mode = "tonight"; openNight(today()); scrollTo(0, 0); };
async function goPast() {
  S.mode = "past"; layout();
  if (S.chan) { sb.removeChannel(S.chan); S.chan = null; }
  $("#past").innerHTML = `<div class="card card-b muted">Loading Past Weeks…</div>`;
  let byNight = {};
  if (DEMO) byNight = DEMO_PAST;
  else {
    const { data, error } = await sb.from("reads").select("id,night_date,game_no,status,discarded,created_at,edits,photo_path,data").lt("night_date", today()).order("night_date", { ascending: false }).limit(5000);
    if (error) { $("#past").innerHTML = `<div class="banner warn">Couldn't load past weeks: ${esc(error.message)}</div>`; return; }
    for (const r of data) (byNight[r.night_date] ??= []).push(r);
  }
  if (S.mode === "past") renderPast(byNight);
}
const lpHtml = (w) => {
  const T = SEASON.team, [us, them] = w.points, wonG = (i) => (w.ours[i] > w.opp[i] ? 0 : w.ours[i] < w.opp[i] ? 1 : -1);
  const tcell = (v, i, side) => `<td class="${wonG(i) === side ? "w" : ""}">${v}</td>`;
  const bow = w.bowlers.map((b) => `<tr><td class="l">${esc(b.name.split(" ")[0])} <span class="dim">${esc(b.name.split(" ").slice(1).join(" "))}</span></td>${b.games.map((x) => `<td>${x ?? "–"}</td>`).join("")}<td><b>${b.games.every((x) => x != null) ? b.games.reduce((t, x) => t + x, 0) : "–"}</b></td></tr>`).join("");
  const missing = [0, 1, 2].map((i) => w.ours[i] - w.bowlers.reduce((t, b) => t + (b.games[i] ?? 0) + b.hcp, 0));
  const note = w.bowlers.length < 5 && missing.every((x) => x > 0) ? `<p class="fine">One lineup spot isn't on LeaguePals bowler pages (likely a blind score). It's in the team totals.</p>` : "";
  return `<div class="lp-body">
    <table class="lp-t">${cols(0, 46, 46, 46, 54)}<tr><th class="l">Team</th><th>G1</th><th>G2</th><th>G3</th><th>Series</th></tr>
    <tr><td class="l"><b>${esc(T)}</b></td>${w.ours.map((v, i) => tcell(v, i, 0)).join("")}</tr>
    <tr><td class="l">${esc(w.opponent)}</td>${w.opp.map((v, i) => tcell(v, i, 1)).join("")}</tr></table>
    <p class="fine">Team scores include handicap. Points: ${numTxt(us)} – ${numTxt(them)}.</p>
    <table class="lp-t">${cols(0, 46, 46, 46, 54)}<tr><th class="l">Our Bowlers</th><th>G1</th><th>G2</th><th>G3</th><th>Series</th></tr>${bow}</table>
    <p class="fine">Bowler scores are scratch (no handicap).</p>${note}</div>`;
};
function renderPast(byNight) {
  const items = [];
  for (const w of SEASON.weeks) items.push({ d: w.date, lp: w });
  for (const d of Object.keys(byNight)) {
    if (LP_DATES.has(d)) continue; // LeaguePals is the record for Weeks 1–10
    const n = scoreNight(byNight[d], { myTeam: MY_TEAM });
    if (n.sides.length >= 2 && [1, 2, 3].some((g) => n.games[g].result)) items.push({ d, n, test: !DEMO && isTestNight(d), demo: DEMO });
  }
  items.sort((x, y) => (x.d < y.d ? 1 : -1));
  let pf = 0, pa = 0, w = 0, l = 0, t = 0, cnt = 0;
  const tally = (a, b, done, counts) => { if (!counts) return; pf += a; pa += b; cnt++; if (done) a > b ? w++ : a < b ? l++ : t++; };
  const row = (it) => {
    if (it.lp) {
      const L = it.lp, [a, b] = L.points, res = a > b ? "won" : a < b ? "lost" : "tied";
      tally(a, b, true, true);
      return `<details class="pw-lp"><summary class="pw-row ${res}"><span class="pw-badge">${{ won: "W", lost: "L", tied: "T" }[res]}</span><span class="pw-main"><span class="pw-date">Week ${L.week} · ${shortDate(L.date, { month: "short", day: "numeric" })}<span class="src">From LeaguePals</span></span>
        <span class="pw-score"><b>${numTxt(a)} – ${numTxt(b)}</b><span>vs ${esc(L.opponent)}</span></span></span><span class="pw-go">›</span></summary>${lpHtml(L)}</details>`;
    }
    const { d, n } = it, k = Math.max(0, n.sides.findIndex((x) => isOurs(x.name))), [a, b] = [n.totals[k], n.totals[1 - k]], done = n.up === 0;
    const res = !done ? "open" : a > b ? "won" : a < b ? "lost" : "tied";
    tally(a, b, done, !it.test && !it.demo && countsForSeason(d)); // demo nights are samples, never counted
    return `<button class="pw-row ${res}" data-night="${d}"><span class="pw-badge">${{ won: "W", lost: "L", tied: "T", open: "–" }[res]}</span><span class="pw-main"><span class="pw-date">${shortDate(d)}${it.test ? `<span class="src test">Test</span>` : it.demo ? `<span class="src demo">Demo</span>` : ""}${done ? "" : `<small>${n.up} of 35 Not Scored</small>`}</span>
      <span class="pw-score"><b>${numTxt(a)} – ${numTxt(b)}</b><span>vs ${esc(n.sides[1 - k].name)}</span></span></span><span class="pw-go">›</span></button>`;
  };
  const html = items.map(row).join("");
  $("#past").innerHTML = `<div class="card pw"><div class="card-h">Past Weeks</div>
    <div class="pw-season">${ptsWonTile(pf, pa)}<div><small>Points For</small><b>${numTxt(pf)}</b></div><div><small>Points Against</small><b>${numTxt(pa)}</b></div><div><small>Weeks</small><b>${cnt}</b></div></div>
    ${html}</div>${items.some((x) => x.test) ? `<p class="fine pw-fine">Test nights are shown for reference and don't count toward the season.</p>` : ""}`;
}
$("#seg").onclick = (e) => { const m = e.target.closest("button")?.dataset.m; if (m === "tonight") goTonight(); else if (m === "past") goPast(); };
$("#past").onclick = (e) => { const d = e.target.closest("[data-night]")?.dataset.night; if (d) { S.mode = "night"; openNight(d); scrollTo(0, 0); } };
$("#backTonight").onclick = goTonight;

let started = false;
async function start() {
  if (started) return; started = true;
  if (DEMO) {
    ({ DEMO_ROWS, DEMO_PAST } = await import("./demo.js?v=8"));
    $("#demoNext").onclick = () => { if (demoUpto < 3) { demoUpto++; demoRows(); } };
    S.mode = Q.get("view") === "past" ? "past" : "tonight";
    if (S.mode === "past") return goPast();
    return openNight(today());
  }
  openNight(today());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (S.mode === "tonight" && S.night !== today()) openNight(today()); else if (S.mode !== "past") load();
  });
}
$("#gamePick").onclick = (e) => { const g = e.target.closest("button")?.dataset.g; if (!g) return; if (g === "S") S.view = "S"; else { S.game = +g; S.view = +g; } render(); };

// ---------- confirm dialog + Redo Game / Reset Tonight (soft discard, recoverable via Screens & Fixes → Use Again) ----------
function askConfirm(title, body, ok) {
  return new Promise((done) => {
    $("#mTitle").textContent = title; $("#mBody").textContent = body; $("#mOk").textContent = ok;
    $("#modal").hidden = false; $("#mOk").focus();
    const close = (v) => { $("#modal").hidden = true; done(v); };
    $("#mOk").onclick = () => close(true); $("#mCancel").onclick = () => close(false);
    $("#modal").onclick = (e) => { if (e.target.id === "modal") close(false); };
  });
}
async function discardAll(rows) {
  if (!rows.length) return;
  if (DEMO) { for (const r of rows) r.discarded = true; return render(); }
  const res = await Promise.allSettled(rows.map((r) => call({ action: "discard", read_id: r.id, discarded: true })));
  const bad = res.filter((x) => x.status === "rejected");
  await load(); // realtime also pushes each change to every other phone
  if (bad.length) alert(`${bad.length} of ${rows.length} photos couldn't be cleared: ${bad[0].reason?.message ?? ""}`);
}
async function redoGame(g) {
  const rows = S.rows.filter((r) => r.game_no === g && !r.discarded);
  if (!rows.length) return;
  if (!(await askConfirm(`Redo Game ${g}?`, `Clear Game ${g} photos and scores (${rows.length} ${rows.length === 1 ? "photo" : "photos"})? You can snap them again.`, `Clear Game ${g}`))) return;
  await discardAll(rows);
  S.game = g; S.view = g; render();
}
async function resetTonight() {
  menu(false);
  if (S.mode !== "tonight") return;
  const rows = S.rows.filter((r) => !r.discarded);
  if (!rows.length) return askConfirm("Nothing to Clear", "There are no photos for tonight yet.", "OK");
  if (!(await askConfirm("Clear the Whole Night?", `This removes all photos and scores for tonight (${rows.length} ${rows.length === 1 ? "photo" : "photos"}, every game). You can snap them again.`, "Clear Night"))) return;
  await discardAll(rows);
  S.game = null; S.view = null; render();
}
$("#resetNight").onclick = resetTonight;
$("#clearNight").onclick = resetTonight;
document.addEventListener("click", (e) => { const b = e.target.closest("[data-redo]"); if (b) redoGame(+b.dataset.redo); });

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
  if (S.mode !== "tonight") return;
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
    if (DEMO) { if (t.dataset.act === "discard") { row.discarded = !row.discarded; render(); } return; }
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
  return `${tag}${hcpKnown ? `${x.scratch ?? "?"} + ${x.hcp ?? "?"} Handicap` : `Scratch ${x.scratch ?? "?"}`}`;
};
// Running handicap total through game g (Game 2 tab: G1+G2, Game 3 tab: G1+G2+G3). null when any game is missing: never guessed.
const runSpot = (g, i, k) => { let t = 0; for (let j = 1; j <= g; j++) { const x = N.games[j].result?.spots[i]?.[k]; if (x?.game == null) return null; t += x.game; } return t; };
const runTeam = (g, k) => { let t = 0; for (let j = 1; j <= g; j++) { const x = N.games[j].result?.teams[k]; if (x == null) return null; t += x; } return t; };
function runLine(ta, tb, g) {
  const lab = `Games 1–${g}`;
  const c = (i) => { const [x, y] = i ? [tb, ta] : [ta, tb]; return x == null || y == null ? "" : x > y ? "w" : x < y ? "lo" : "tie"; };
  const v = (x) => (x == null ? "–" : x);
  return `<div class="run-lbl l">${lab}</div><div class="run ${c(0)}">${v(ta)}</div><div></div><div class="run ${c(1)}">${v(tb)}</div><div class="run-lbl r">${lab}</div>`;
}
// Our side (left) minus theirs. null when either number is missing: never invent a margin.
const diff = (x, y) => (x == null || y == null ? null : x - y);
const sgn = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "Even");
const mcls = (d) => (d > 0 ? "up" : d < 0 ? "dn" : "even");
const marginWord = (d) => (d > 0 ? `Up ${d}` : d < 0 ? `Down ${-d}` : "Even");
const pinsWord = (d) => (d > 0 ? `Up ${d} ${d === 1 ? "Pin" : "Pins"}` : d < 0 ? `Down ${-d} ${d === -1 ? "Pin" : "Pins"}` : "Even");
const gameWord = (g, d) => (d > 0 ? `Won Game ${g} By ${d}` : d < 0 ? `Lost Game ${g} By ${-d}` : `Tied Game ${g}`);
// Running margin over every game available up to g (both lanes in). Label names the range, e.g. "Through Game 2" or "In Games 1 + 3".
function runAvail(g, pair) {
  let d = 0; const got = [];
  for (let j = 1; j <= g; j++) { const v = pair(j); if (v && v[0] != null && v[1] != null) { d += v[0] - v[1]; got.push(j); } }
  if (!got.length) return null;
  return { d, games: got, label: got.length === g ? `Through Game ${g}` : `In Games ${got.join(" + ")}` };
}
const spotPair = (i) => (j) => { const x = N.games[j].result?.spots[i]; return x ? [x.a.game, x.b.game] : null; };
const teamPair = (j) => N.games[j].result?.teams ?? null;
// Running pill (the star) + this game's margin (small, only when it differs from the running range).
function runMargin(g, run, gd) {
  if (!run && gd == null) return "";
  const pill = run ? `<span class="mpill ${mcls(run.d)}">${pinsWord(run.d)}<small>${run.label}</small></span>` : "";
  const small = gd != null ? `<span class="gm ${mcls(gd)}">${gameWord(g, gd)}</span>` : "";
  return `<div class="mline">${pill}${small}</div>`;
}
const muRow = (spot, a, b, sa, sb2, p, cls2 = "", run = "") =>
  `<div class="mu-row ${cls2}">${spot !== "" ? `<span class="spot" title="Lineup Spot ${spot}">${spot}</span>` : ""}${a}${scoreBlock(sa, p, 0)}<div class="mu-mid"></div>${scoreBlock(sb2, p, 1)}${b}${run}</div>`;

// Redo Game N: shown when this game has any live (not hidden) photo tonight.
const liveReads = (g) => S.rows.filter((r) => r.game_no === g && !r.discarded);
const redoBtn = (g) => (S.mode === "tonight" && g !== "S" && liveReads(g).length ? `<div class="redo"><button class="btn-danger-o" data-redo="${g}">↺ Redo Game ${g}</button></div>` : "");

// ---------- cartoon art (hand-drawn inline SVG, no external images) ----------
const PIN = (x, y, s = 1, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0-30c-4 0-6 3.4-6 7 0 2.7 1.2 4.7 2 6.5-.7 1.6-2 3.1-3.4 5.6C-9.9-7.3-10.6-3.7-10.6 0c0 7 3.4 12.8 5.6 16h10c2.2-3.2 5.6-9 5.6-16 0-3.7-.7-7.3-3.2-10.9-1.4-2.5-2.7-4-3.4-5.6.8-1.8 2-3.8 2-6.5 0-3.6-2-7-6-7z" fill="#fff" stroke="#c9d3df" stroke-width="1.2"/><path d="M-4.6-14.4h9.2M-5.4-11h10.8" stroke="#3567a8" stroke-width="1.8" stroke-linecap="round"/></g>`;
const BALL = (x, y, r = 14) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="url(#ballG)"/><circle cx="${-r * .28}" cy="${-r * .36}" r="${r * .13}" fill="#1c3155"/><circle cx="${r * .1}" cy="${-r * .44}" r="${r * .13}" fill="#1c3155"/><circle cx="${-r * .05}" cy="${-r * .05}" r="${r * .15}" fill="#1c3155"/><ellipse cx="${-r * .45}" cy="${r * .35}" rx="${r * .32}" ry="${r * .16}" fill="#fff" opacity=".25" transform="rotate(-30)"/></g>`;
const DEFS = `<defs><radialGradient id="ballG" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#5f97d6"/><stop offset=".6" stop-color="#3567a8"/><stop offset="1" stop-color="#22406d"/></radialGradient></defs>`;
const ART_EMPTY = `<svg class="art-empty" viewBox="0 0 220 70" aria-hidden="true">${DEFS}<path d="M6 62h208" stroke="#c9d6e4" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/><g class="roll">${BALL(40, 48, 13)}<path d="M14 42h-8M18 50h-12M14 58h-6" stroke="#e8b931" stroke-width="2.4" stroke-linecap="round"/></g>${PIN(160, 46, .9)}${PIN(178, 44, .95)}${PIN(196, 46, .9)}</svg>`;
// Short celebration when our team wins a freshly scored game (skipped for reduced motion).
function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div"); box.className = "confetti"; box.setAttribute("aria-hidden", "true");
  const cols = ["#f2c230", "#3567a8", "#4a83c4", "#ffffff", "#e8b931"];
  box.innerHTML = Array.from({ length: 22 }, (_, i) => {
    const left = 4 + ((i * 37) % 92), d = (i % 5) * 0.08, rot = (i * 47) % 360;
    return i % 4 === 0 ? `<i class="cf pin" style="left:${left}%;animation-delay:${d}s"><svg viewBox="-12 -32 24 50">${PIN(0, 0, 1, rot % 40 - 20)}</svg></i>`
      : `<i class="cf" style="left:${left}%;background:${cols[i % cols.length]};animation-delay:${d}s;transform:rotate(${rot}deg)"></i>`;
  }).join("");
  document.body.appendChild(box); setTimeout(() => box.remove(), 1700);
}

function gameCard(g) {
  const { reads, result: r } = N.games[g];
  const [A, B] = N.sides;
  if (!r) {
    const have = reads.filter(Boolean).map((x) => x.data.team_name);
    const reading = S.rows.some((x) => x.game_no === g && x.status === "reading");
    return `<div class="card"><div class="card-h">Game ${g}</div><div class="card-b muted">${reading ? "Reading Scores…" : have.length ? `Have ${esc(have.join(", "))}. Snap the other lane.` : "No photos yet. Snap both lane screens after this game."}</div>${redoBtn(g)}</div>`;
  }
  const rows = r.spots.map((s, i) => muRow(s.spot,
    nameBlock(s.a.name, detail(s.a), "l"), nameBlock(s.b.name, detail(s.b), "r"),
    fixSpan(reads[0], `bowlers.${i}.hcp_game`, s.a.game, `${s.a.name} Handicap Game`),
    fixSpan(reads[1], `bowlers.${i}.hcp_game`, s.b.game, `${s.b.name} Handicap Game`), s.pts, "",
    (g > 1 ? runLine(runSpot(g, i, "a"), runSpot(g, i, "b"), g) : "") + runMargin(g, runAvail(g, spotPair(i)), diff(s.a.game, s.b.game)))).join("");
  const team = muRow("", nameBlock("Team", `Scratch ${reads[0]?.data.team_scratch ?? "?"}`, "l"), nameBlock("Team", `Scratch ${reads[1]?.data.team_scratch ?? "?"}`, "r"),
    fixSpan(reads[0], "team_hcp_total", r.teams[0], "Team Handicap Total (Screen)"), fixSpan(reads[1], "team_hcp_total", r.teams[1], "Team Handicap Total (Screen)"), r.teamPts, "team",
    (g > 1 ? runLine(runTeam(g, 0), runTeam(g, 1), g) : "") + runMargin(g, runAvail(g, teamPair), diff(r.teams[0], r.teams[1])));
  return `<div class="card mu"><div class="card-h">Game ${g} Matchups<span class="score-chip">${pts(r.pts)}</span></div>${g > 1 ? `<div class="mu-key">Big Number = Game ${g} Score · <b>Games 1–${g}</b> = Added Up So Far (Blue Leads)</div>` : `<div class="mu-key">Big Number = Game 1 Score · Pill = Pins Up or Down So Far</div>`}${rows}${team}
    <div class="mu-foot">Game ${g}: <b>${esc(A.name)} ${numTxt(r.pts[0])}</b> – <b>${numTxt(r.pts[1])} ${esc(B.name)}</b></div>${flagList(r.flags)}${redoBtn(g)}</div>`;
}

function seriesCard() {
  const s = N.series, [A, B] = N.sides;
  if (!s) return `<div class="card"><div class="card-h">Series</div><div class="card-b muted">The 3-game series is scored once all three games are in.</div></div>`;
  const rows = s.spots.map((x) => muRow(x.spot, nameBlock(x.a.name, detail(x.a, false), "l"), nameBlock(x.b.name, detail(x.b, false), "r"),
    `<span>${x.a.game ?? "?"}</span>`, `<span>${x.b.game ?? "?"}</span>`, x.pts, "", runMargin("S", x.a.game == null || x.b.game == null ? null : { d: x.a.game - x.b.game, label: "For the Series" }, null))).join("");
  const team = muRow("", nameBlock("Team", "3-Game Total", "l"), nameBlock("Team", "3-Game Total", "r"), `<span>${s.teams[0] ?? "?"}</span>`, `<span>${s.teams[1] ?? "?"}</span>`, s.teamPts, "team", runMargin("S", s.teams[0] == null || s.teams[1] == null ? null : { d: s.teams[0] - s.teams[1], label: "Team, For the Series" }, null));
  return `<div class="card mu"><div class="card-h">Series Matchups <small>3-Game Total</small><span class="score-chip">${pts(s.pts)}</span></div>${rows}${team}
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

// Snapshot of every score on the board, used to auto-switch to a newly scored game and flash what changed.
const snap = () => ({ 1: N.games[1].result && pts(N.games[1].result.pts), 2: N.games[2].result && pts(N.games[2].result.pts), 3: N.games[3].result && pts(N.games[3].result.pts), S: N.series && pts(N.series.pts), N: pts(N.totals) });
function track() {
  if (!S.loaded) return;
  const now = snap();
  if (!S.base) { S.base = now; return; }
  const t = Date.now() + 1600;
  for (const k of Object.keys(now)) if (now[k] !== S.base[k]) {
    S.flash[k] = t;
    if (k !== "N" && k !== "S" && now[k] && !S.base[k]) { // a new game just got scored: show it
      S.view = +k; S.game = null;
      const p = N.games[k].result.pts; if (p[0] > p[1]) setTimeout(celebrate, 50);
    }
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
  const tp = two ? runAvail(3, teamPair) : null; // team running hdcp pins over every scored game tonight
  const tpLbl = tp ? (tp.games.length === tp.games.at(-1) ? `Through Game ${tp.games.at(-1)}` : `In Games ${tp.games.join(" + ")}`) : "";
  const bigN = (p, i) => (p && p[i] > p[1 - i] ? big(p, i).replace("</b>", `<span class="lead-pill">Leading</span></b>`) : big(p, i)); // "Leading" pill under the night leader (nothing when tied)
  return `<div class="sb-teams"><span>${esc(A)}</span><span>${esc(B)}</span></div>
    <div class="sb-row${fl(v)}">${big(r?.pts, 0)}<div class="sb-lbl">${v === "S" ? "Series" : `Game ${v}`}${r ? "" : `<small>${v === "S" ? "After Game 3" : "Not In Yet"}</small>`}</div>${big(r?.pts, 1)}</div>
    <div class="sb-row night${fl("N")}">${bigN(T, 0)}<div class="sb-lbl">Night Total<small>${N.up} of 35 Still Up</small></div>${bigN(T, 1)}</div>
    ${tp ? `<div class="sb-pins ${mcls(tp.d)}${fl("N")}"><span>Team</span> <b>${pinsWord(tp.d)}</b> <small>${tpLbl}</small></div>` : ""}`;
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
  $("#snapLbl").textContent = `Snap Game ${g} Photo`;
  $("#uploads").innerHTML = S.uploads.slice(-6).map((u) => `<li>${esc(u.label)}: ${esc(u.state)}</li>`).join("");
  const flagged = Object.values(N.readFlags).flat().filter((f) => f.level !== "info").length;
  if (flagged && !S.openedScreens) { $("#screensBox").open = true; S.openedScreens = true; }
  if (N.sides.length < 2) {
    $("#board").innerHTML = S.mode === "tonight"
      ? `<div class="card empty">${ART_EMPTY}<b>Snap Game ${g} when you're ready.</b><span>Scores appear once both lanes' photos for a game are in.</span>${redoBtn(g)}</div>`
      : `<div class="banner">No scores were saved for this night.</div>`;
    $("#screens").innerHTML = screensHtml(); return;
  }
  const sumRow = (i) => `<tr><td class="l">${esc(N.sides[i].name)}</td>${[1, 2, 3].map((k) => `<td>${N.games[k].result ? numTxt(N.games[k].result.pts[i]) : "–"}</td>`).join("")}<td>${N.series ? numTxt(N.series.pts[i]) : "–"}</td><td class="${N.totals[i] > N.totals[1 - i] ? "w" : ""}"><b>${numTxt(N.totals[i])}</b></td></tr>`;
  $("#board").innerHTML = `
    ${flagged ? `<div class="banner warn">⚠ ${flagged} ${flagged === 1 ? "number" : "numbers"} to check. Tap a highlighted number to fix it.</div>` : ""}
    ${N.notes.map((n) => `<div class="banner">${esc(cap(n))}</div>`).join("")}
    ${v === "S" ? seriesCard() : gameCard(v)}
    <div class="card"><div class="card-h">${S.mode === "tonight" ? "Points Tonight" : "Points This Night"}</div><table>${cols(0, 36, 36, 36, 54, 50)}<tr><th class="l">Team</th><th>G1</th><th>G2</th><th>G3</th><th>Ser</th><th>Total</th></tr>${sumRow(0)}${sumRow(1)}</table></div>`;
  $("#screens").innerHTML = screensHtml();
  const next = Math.min(...Object.values(S.flash).filter((t) => t > Date.now()));
  if (Number.isFinite(next)) { clearTimeout(S.flashT); S.flashT = setTimeout(render, next - Date.now() + 20); }
}

if (SUPABASE_URL.includes("YOUR-PROJECT")) document.body.insertAdjacentHTML("afterbegin", `<p class="err" style="padding:12px">Fill in config.js (SUPABASE_URL, SUPABASE_ANON_KEY) first.</p>`);
show();
