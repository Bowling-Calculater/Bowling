import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTION_NAME, MY_TEAM } from "./config.js?v=18";
import { scoreNight, thruGame, norm } from "./scoring.js?v=18";
import { SEASON } from "./season.js?v=18";

const $ = (s) => document.querySelector(s);
// ---------- stale-cache guard: GitHub Pages caches files ~10 min, phones can hold them longer ----------
export const APP_VERSION = "18";
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

const S = { code: DEMO ? "demo" : localStorage.getItem("teamCode"), night: today(), mode: "tonight", game: null, view: null, page: "night", pick: null, rows: [], uploads: [], chan: null, loaded: false, base: null, flash: {}, vt: {}, showFinal: false, popGone: false };

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
  S.code = $("#code").value.trim().toLowerCase().replace(/\s+/g, " ");
  try { await call({ action: "check" }); localStorage.setItem("teamCode", S.code); show(); }
  catch (err) { $("#gateErr").textContent = cap(err.message); S.code = null; }
};
$("#logout").onclick = () => { if (!DEMO) localStorage.removeItem("teamCode"); S.code = null; location.href = location.pathname; };

// ---------- menu extras: League Rules, Season Stats, Photo Tips, Share Link ----------
const SITE_URL = "https://bowling-calculater.github.io/Bowling/"; // never add the team code here
function sheet(title, html) { $("#sheetTitle").textContent = title; $("#sheetBody").innerHTML = html; $("#sheet").hidden = false; $("#sheetBody").scrollTop = 0; }
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

const TIPS_ART = `<svg class="tips-art" viewBox="0 0 200 92" aria-hidden="true"><rect x="38" y="10" width="124" height="66" rx="6" fill="#2c4a78"/><rect x="45" y="17" width="110" height="52" rx="3" fill="#eef2f7"/>
  ${[0, 1, 2, 3, 4].map((i) => `<rect x="51" y="${22 + i * 9}" width="${46 - (i % 2) * 8}" height="4" rx="2" fill="#b9d6ec"/><rect x="124" y="${22 + i * 9}" width="24" height="4" rx="2" fill="#3567a8"/>`).join("")}
  <path d="M92 76h16l4 10H88z" fill="#2c4a78"/><g transform="translate(150 44) rotate(-12)"><rect x="-17" y="-28" width="34" height="58" rx="7" fill="#fff" stroke="#3567a8" stroke-width="2.4"/><rect x="-12" y="-21" width="24" height="40" rx="2" fill="#eef2f7"/><circle cy="24" r="2.2" fill="#3567a8"/></g>
  <path d="M176 10l2.4 5 5 2.4-5 2.4-2.4 5-2.4-5-5-2.4 5-2.4z" fill="#4a83c4"/></svg>`;
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
  const bowler = (name) => (P[norm(name)] ??= { name: titleCase(name), g: 0, pins: 0, hg: 0, hs: 0, hgH: 0, hsH: 0, extra: 0, g200: 0, s700: 0 });
  const add = (name, games, hcpGames, isExtra) => {
    const p = bowler(name), gs = games.filter((x) => x != null);
    if (!gs.length) return;
    p.g += gs.length; p.pins += gs.reduce((t, x) => t + x, 0); p.hg = Math.max(p.hg, ...gs); if (isExtra) p.extra += gs.length;
    p.g200 += gs.filter((x) => x >= 200).length; // scratch only, never handicap
    const hs = hcpGames.filter((x) => x != null);
    if (hs.length) p.hgH = Math.max(p.hgH, ...hs);
    if (gs.length === 3) { const ser = gs[0] + gs[1] + gs[2]; p.hs = Math.max(p.hs, ser); if (ser >= 700) p.s700++; if (hs.length === 3) p.hsH = Math.max(p.hsH, hs[0] + hs[1] + hs[2]); }
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
  const t200 = bowlers.reduce((t, b) => t + b.g200, 0), t700 = bowlers.reduce((t, b) => t + b.s700, 0);
  return `<div class="st-tiles"><div><small>Points</small><b>${numTxt(team.pf)}–${numTxt(team.pa)}</b></div>${ptsWonTile(team.pf, team.pa)}<div><small>Standing</small><b>${ord(SEASON.standing.position)}</b><small>After Week ${SEASON.standing.after_week}</small></div></div>
    <div class="st-tiles two"><div><small>Team 200 Games</small><b id="t200">${t200}</b><small class="sub">Scratch</small></div><div><small>Team 700 Series</small><b id="t700">${t700}</b><small class="sub">Scratch</small></div></div>
    <h4 class="st-h">Bowlers <small>Scratch, No Handicap</small></h4>
    <div class="stats-wrap"><table class="stats-t" data-sort="bowlers"><colgroup><col><col style="width:30px"><col style="width:32px"><col style="width:36px"><col style="width:38px"><col style="width:32px"><col style="width:32px"></colgroup>
    <tr>${sth("Bowler", "l")}${sth("Gms")}${sth("Avg")}${sth("High Gm")}${sth("High Ser")}${sth("200s", "cnt")}${sth("700s", "cnt")}</tr>
    ${bowlers.map((b) => `<tr><td class="l" data-v="${esc(b.name)}">${nm(b.name)}</td><td data-v="${sv(b.g)}">${b.g}</td><td data-v="${sv(b.avg)}"><b>${b.avg}</b></td><td data-v="${sv(b.hg)}">${b.hg || "–"}</td><td data-v="${sv(b.hs)}">${b.hs || "–"}</td><td data-c="200" data-v="${sv(b.g200, true)}">${b.g200}</td><td data-c="700" data-v="${sv(b.s700, true)}">${b.s700}</td></tr>`).join("")}</table></div>
    <h4 class="st-h">Highs With Handicap</h4>
    <div class="stats-wrap"><table class="stats-t" data-sort="hcp"><colgroup><col><col style="width:70px"><col style="width:70px"></colgroup>
    <tr>${sth("Bowler", "l")}${sth("High Game")}${sth("High Series")}</tr>
    ${bowlers.map((b) => `<tr><td class="l" data-v="${esc(b.name)}">${nm(b.name)}</td><td data-v="${sv(b.hgH)}">${b.hgH || "–"}</td><td data-v="${sv(b.hsH)}">${b.hsH || "–"}</td></tr>`).join("")}
    <tr class="tot"><td class="l"><b>Team</b></td><td>${team.hg || "–"}</td><td>${team.hs || "–"}</td></tr></table></div>
    <p class="fine">Weeks 1–${SEASON.weeks.length} come from LeaguePals${team.extraNights ? `, plus ${team.extraNights} later ${team.extraNights === 1 ? "night" : "nights"} scored here` : ""}. Test nights aren't counted.${entering.length ? ` ${entering.map((b) => b.name.split(" ")[0]).join(" and ")} ${entering.length === 1 ? "shows" : "show"} the average LeaguePals lists (entering average) until more games are bowled.` : ""}</p>`;
}
async function loadStats() {
  $("#stats").innerHTML = `<div class="glass pad muted">Loading Season Stats…</div>`;
  const byNight = {};
  if (!DEMO) {
    const { data, error } = await sb.from("reads").select("id,night_date,game_no,status,discarded,created_at,data").eq("status", "done").gt("night_date", LP_LAST).order("created_at").limit(5000);
    if (S.page !== "stats") return;
    if (error) return ($("#stats").innerHTML = `<div class="banner warn">Couldn't Load Stats: ${esc(error.message)}</div>`);
    for (const r of data) if (!r.discarded) (byNight[r.night_date] ??= []).push(r);
  }
  if (S.page === "stats") { $("#stats").innerHTML = `<div class="glass pad stats-card">${statsHtml(seasonStats(byNight))}</div>`; $("#stats").querySelectorAll("table[data-sort]").forEach(sortTable); }
}
// Stats table sorting: tap a header to sort (numbers high→low, names A→Z), tap again to reverse.
// Blank values always sort last; the Team row stays pinned at the bottom. Choice is kept on this phone.
const sth = (label, cls = "") => `<th class="${cls}"><button type="button" class="sort-h">${label}<i class="sa" aria-hidden="true"></i></button></th>`;
const sv = (x, zeroOk) => (x == null || Number.isNaN(x) || (!zeroOk && !x) ? "" : String(x));
const getSorts = () => { try { return JSON.parse(localStorage.getItem("statsSort") || "{}") || {}; } catch { return {}; } };
function sortTable(t) {
  const st = getSorts()[t.dataset.sort], hr = t.rows[0], ths = [...hr.cells];
  ths.forEach((th, i) => { const on = st && st.col === i; th.classList.toggle("on", !!on); th.setAttribute("aria-sort", on ? (st.dir > 0 ? "ascending" : "descending") : "none"); th.querySelector(".sa").textContent = on ? (st.dir > 0 ? "▲" : "▼") : ""; });
  const body = [...t.rows].slice(1), tot = body.filter((r) => r.classList.contains("tot")), rows = body.filter((r) => !r.classList.contains("tot"));
  rows.forEach((r, i) => (r.dataset.o ??= i)); // original (default) order, used for ties and when no sort is chosen
  const val = (r) => r.cells[st?.col]?.dataset.v ?? "";
  rows.sort((a, b) => {
    if (!st || !ths[st.col]) return a.dataset.o - b.dataset.o;
    const x = val(a), y = val(b);
    if (x === "" || y === "") return (x === "") - (y === "") || a.dataset.o - b.dataset.o;
    const c = st.col === 0 ? x.localeCompare(y) : +x - +y;
    return c * st.dir || a.dataset.o - b.dataset.o;
  });
  const parent = hr.parentNode;
  for (const r of [...rows, ...tot]) parent.appendChild(r);
}
$("#stats").addEventListener("click", (e) => {
  const th = e.target.closest(".stats-t[data-sort] th"); if (!th) return;
  const t = th.closest("table"), col = th.cellIndex, all = getSorts(), cur = all[t.dataset.sort];
  all[t.dataset.sort] = { col, dir: cur && cur.col === col ? -cur.dir : col === 0 ? 1 : -1 };
  try { localStorage.setItem("statsSort", JSON.stringify(all)); } catch {}
  sortTable(t);
});

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

// Demo: ?demo=1 shows the sample night (all 3 games); &upto=N starts with N games and "Next Game" simulates a live read arriving.
let demoUpto = Math.max(0, Math.min(3, +(Q.get("upto") ?? 3)));
let DEMO_ROWS = [], DEMO_PAST = {};
function demoRows() { S.rows = structuredClone(DEMO_ROWS.filter((r) => r.game_no <= demoUpto)); S.loaded = true; $("#demoNext").hidden = demoUpto >= 3; render(); }
const demoStep = () => { if (demoUpto < 3) { demoUpto++; demoRows(); } };

// ---------- opponent name: typed before Game 1, kept on this phone only (localStorage, per night; no database column) ----------
const oppKey = (d = S.night) => `oppName:${DEMO ? "demo:" : ""}${d}`;
const getOpp = (d) => (localStorage.getItem(oppKey(d)) || "").trim();
const setOpp = (v) => { v = String(v ?? "").trim().slice(0, 40); v ? localStorage.setItem(oppKey(), v) : localStorage.removeItem(oppKey()); };
function startBtn() { const ok = !!getOpp(); $("#startAdd").disabled = !ok; $("#startAdd").classList.toggle("off", !ok); }
$("#oppName").addEventListener("input", (e) => { setOpp(e.target.value); startBtn(); });
$("#oppName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
// Long names shrink to their last word in tight spots ("Mel's Marauders" -> "Marauders").
const shortName = (n) => { n = String(n ?? "").trim(); const w = n.split(/\s+/); return n.length <= 11 || w.length < 2 ? n : w.at(-1); };

// ---------- pages: Tonight (always today, Central time) / one past night / Past Weeks / Stats / More ----------
const shortDate = (d, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(d + "T12:00:00").toLocaleDateString("en-US", opts);
function setHeader(h1, sub = "", act = "", strip = "") {
  $("#h1").textContent = h1; $("#sub").innerHTML = sub; $("#act").innerHTML = act;
  $("#strip").innerHTML = strip; $("#strip").hidden = !strip;
  $("#live").hidden = DEMO || S.page !== "night" || S.mode !== "tonight";
}
function setPage(p) {
  S.page = p;
  for (const id of ["night", "past", "stats", "more"]) $(id === "night" ? "#nightView" : `#${id}`).hidden = p !== id;
  const t = p === "night" ? (S.mode === "night" ? "past" : "tonight") : p;
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  if (p === "past") setHeader("Past Weeks", `${esc(MY_TEAM)} · ${esc(SEASON.league ?? "Pot of Gold")}`);
  if (p === "stats") setHeader("Season Stats", `${esc(MY_TEAM)} · ${esc(SEASON.league ?? "Pot of Gold")}`);
  if (p === "more") setHeader("More", esc(MY_TEAM));
  scrollTo(0, 0);
}
function openNight(d) {
  S.night = d; S.rows = []; S.game = null; S.pick = null; S.base = null; S.flash = {}; S.loaded = false; S.openedScreens = false;
  $("#oppName").value = getOpp();
  const t = S.mode === "tonight";
  $("#clearBox").hidden = !t; $("#demoBar").hidden = !DEMO || !t;
  if (DEMO) { if (t) return demoRows(); S.rows = structuredClone(DEMO_PAST[d] ?? []); S.loaded = true; return render(); }
  subscribe(); render();
}
const goTonight = () => { S.mode = "tonight"; setPage("night"); openNight(today()); };
async function goPast() {
  S.mode = "past"; setPage("past");
  if (S.chan) { sb.removeChannel(S.chan); S.chan = null; }
  $("#past").innerHTML = `<div class="glass pad muted">Loading Past Weeks…</div>`;
  let byNight = {};
  if (DEMO) byNight = DEMO_PAST;
  else {
    const { data, error } = await sb.from("reads").select("id,night_date,game_no,status,discarded,created_at,edits,photo_path,data").lt("night_date", today()).order("night_date", { ascending: false }).limit(5000);
    if (error) { $("#past").innerHTML = `<div class="banner warn">Couldn't Load Past Weeks: ${esc(error.message)}</div>`; return; }
    for (const r of data) (byNight[r.night_date] ??= []).push(r);
  }
  if (S.mode === "past" && S.page === "past") renderPast(byNight);
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
  $("#past").innerHTML = `<div class="glass pw">
    <div class="pw-season">${ptsWonTile(pf, pa)}<div><small>Points For</small><b>${numTxt(pf)}</b></div><div><small>Points Against</small><b>${numTxt(pa)}</b></div><div><small>Weeks</small><b>${cnt}</b></div></div>
    ${html}</div>${items.some((x) => x.test) ? `<p class="fine pw-fine">Test nights are shown for reference and don't count toward the season.</p>` : ""}`;
}
$("#past").onclick = (e) => { const d = e.target.closest("[data-night]")?.dataset.night; if (d) { S.mode = "night"; setPage("night"); openNight(d); } };
$("#tabbar").onclick = (e) => {
  const t = e.target.closest("button")?.dataset.t;
  if (t === "tonight") { if (S.mode === "tonight" && S.night === today()) { setPage("night"); render(); } else goTonight(); }
  else if (t === "past") goPast();
  else if (t === "stats") { setPage("stats"); loadStats(); }
  else if (t === "more") setPage("more");
};
$("#ver").textContent = `Pot of Gold Scorer · Version ${APP_VERSION}`;

let started = false;
async function start() {
  if (started) return; started = true;
  if (DEMO) {
    ({ DEMO_ROWS, DEMO_PAST } = await import("./demo.js?v=18"));
    $("#demoNext").onclick = demoStep;
    if (Q.get("view") === "past") return goPast();
    return goTonight();
  }
  goTonight();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (S.mode === "tonight" && S.night !== today()) openNight(today()); else if (S.mode !== "past") load();
  });
}

// ---------- confirm dialog + Redo Game / Clear Whole Night (soft discard, recoverable via Screens & Fixes → Use Again) ----------
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
  if (!(await askConfirm(`Redo Game ${g}?`, `Clear Game ${g} photos and scores (${rows.length} ${rows.length === 1 ? "photo" : "photos"})? You can add them again.`, `Clear Game ${g}`))) return;
  await discardAll(rows);
  S.game = g; render();
}
async function resetTonight() {
  if (S.mode !== "tonight") return;
  const rows = S.rows.filter((r) => !r.discarded);
  if (!rows.length) return askConfirm("Nothing To Clear", "There are no photos for tonight yet.", "OK");
  if (!(await askConfirm("Clear The Whole Night?", `This removes all photos and scores for tonight (${rows.length} ${rows.length === 1 ? "photo" : "photos"}, every game). You can add them again.`, "Clear Night"))) return;
  await discardAll(rows);
  S.game = null; render();
}
$("#clearNight").onclick = resetTonight;
// From More: jump to Tonight first so the night being cleared is on screen behind the confirm.
$("#resetNight").onclick = async () => {
  if (S.mode === "tonight" && S.night === today()) { setPage("night"); render(); }
  else { goTonight(); await load(); }
  resetTonight();
};

// ---------- photo picker: one button (iPhone offers Take Photo or Photo Library), both lanes at once ----------
function pick(g = null) {
  if (S.mode !== "tonight") return;
  if (DEMO) { demoStep(); return toast("Demo: Sample Game Added"); }
  S.pick = g; $("#lib").click();
}
$("#startAdd").onclick = () => { if (getOpp()) pick(); };
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-add],[data-redo],[data-go],[data-editopp]");
  if (!b) return;
  if (b.dataset.redo) return redoGame(+b.dataset.redo);
  if (b.dataset.go === "past") return goPast();
  if (b.dataset.editopp != null) { const v = prompt("Opponent Team", getOpp() || N?.sides[1]?.name || ""); if (v !== null) { setOpp(v); render(); } return; }
  if (b.dataset.add != null) pick(b.dataset.add ? +b.dataset.add : null);
});

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
  if (S.mode !== "tonight" || !files.length) return;
  if (DEMO) return alert("Demo mode: uploads are off. Nothing is saved.");
  const game = S.pick ?? curGame(); S.pick = null;
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
      u.done = true; render(); load();
    })();
  }
}
$("#lib").onchange = (e) => { send([...e.target.files]); e.target.value = ""; };
$("#lib").addEventListener("cancel", () => { S.pick = null; });

// ---------- fixes ----------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-read]");
  if (!t) return;
  const row = S.rows.find((r) => r.id === t.dataset.read);
  if (!row) return;
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

// ---------- render helpers (all math comes from scoring.js) ----------
let N = null;
const curGame = () => S.game ?? ([1, 2, 3].find((g) => !N?.games[g]?.result) ?? 3); // where the next photo goes
const flagsFor = (id) => N?.readFlags[id] ?? [];
function cls(id, path) {
  const f = flagsFor(id).filter((x) => x.path === path || (path.endsWith("hcp_game") && x.path === path.replace("hcp_game", "scratch") && x.level === "unsure"));
  return f.some((x) => x.level === "bad") ? "bad" : f.some((x) => x.level === "unsure") ? "unsure" : "";
}
const cell = (read, path, val, label, extra = "") =>
  read ? `<td class="fixable ${cls(read.id, path)} ${extra}" data-read="${read.id}" data-path="${path}" data-label="${esc(label)}">${esc(val ?? "?")}</td>` : `<td class="${extra}">${esc(val ?? "?")}</td>`;
// A score in the lists: tap to fix it when it came from a photo; flagged numbers are highlighted.
// v18: card/Final scores are display-only (fixes happen only in Screens & Fixes); a flagged number keeps its warning tint.
const scoreSpan = (read, path, val, label, c, fmt = (x) => x) =>
  `<span class="sc ${c}${read && cls(read.id, path) ? ` flag ${cls(read.id, path)}` : ""}">${esc(val == null ? "?" : fmt(val))}</span>`;
const num = (x) => (x == null ? "–" : Number.isInteger(x) ? String(x) : x % 1 === 0.5 ? `${Math.floor(x) || ""}½` : x.toFixed(1));
const numTxt = (x) => (x == null ? "?" : Number.isInteger(x) ? String(x) : x.toFixed(1)); // 11.5 style for season totals
const c = (x) => (x == null ? "?" : Number(x).toLocaleString("en-US"));
const sg = (d) => (d == null ? "–" : d > 0 ? `+${c(d)}` : d < 0 ? `−${c(-d)}` : "Tied");
const tc = (d) => (d == null ? "ev" : d > 0 ? "up" : d < 0 ? "dn" : "ev");
const hi = (x, y) => (x == null || y == null ? "" : x > y ? "w" : x === y ? "t" : "");
const cols = (...w) => `<colgroup>${w.map((x) => `<col${x ? ` style="width:${x}px"` : ""}>`).join("")}</colgroup>`;
const flagList = (fl) => (fl.length ? `<ul class="flags">${fl.map((f) => `<li class="${f.level || "info"}">${esc(cap(f.msg ?? f))}</li>`).join("")}</ul>` : "");
const STATUS = { absent: "Absent", vacant: "Vacant" };
const CAM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.4" r="3.3"/></svg>`;
const addBtn = (g) => `<button class="addp" data-add>${CAM}<span>Add Game ${g}</span></button>`;

// ---------- cartoon touches (inline SVG, no external images) ----------
const PIN = (x, y, s = 1, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0-30c-4 0-6 3.4-6 7 0 2.7 1.2 4.7 2 6.5-.7 1.6-2 3.1-3.4 5.6C-9.9-7.3-10.6-3.7-10.6 0c0 7 3.4 12.8 5.6 16h10c2.2-3.2 5.6-9 5.6-16 0-3.7-.7-7.3-3.2-10.9-1.4-2.5-2.7-4-3.4-5.6.8-1.8 2-3.8 2-6.5 0-3.6-2-7-6-7z" fill="#fff" stroke="#c9d3df" stroke-width="1.2"/><path d="M-4.6-14.4h9.2M-5.4-11h10.8" stroke="#3567a8" stroke-width="1.8" stroke-linecap="round"/></g>`;
function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div"); box.className = "confetti"; box.setAttribute("aria-hidden", "true");
  const colors = ["#3567a8", "#4a83c4", "#2c4a78", "#9fbde3", "#5f97d6"];
  box.innerHTML = Array.from({ length: 22 }, (_, i) => {
    const left = 4 + ((i * 37) % 92), d = (i % 5) * 0.08, rot = (i * 47) % 360;
    return i % 4 === 0 ? `<i class="cf pin" style="left:${left}%;animation-delay:${d}s"><svg viewBox="-12 -32 24 50">${PIN(0, 0, 1, rot % 40 - 20)}</svg></i>`
      : `<i class="cf" style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${d}s;transform:rotate(${rot}deg)"></i>`;
  }).join("");
  document.body.appendChild(box); setTimeout(() => box.remove(), 1700);
}

// A failed/stuck read is hidden once a later good read exists for the same game.
const superseded = (r, rows) => r.status !== "done" && r.status !== "reading" && rows.some((x) => x.game_no === r.game_no && x.status === "done" && x.created_at > r.created_at);
const liveReads = (g) => S.rows.filter((r) => r.game_no === g && !r.discarded);

function screensHtml() {
  const all = [...S.rows].sort((a, b) => a.game_no - b.game_no || a.created_at.localeCompare(b.created_at));
  const rows = all.filter((r) => !superseded(r, all));
  if (!rows.length) return `<p class="muted pad">No Photos Yet</p>`;
  return rows.map((r) => {
    const img = r.photo_path ? sb.storage.from("screens").getPublicUrl(r.photo_path).data.publicUrl : "";
    const head = (sub) => `<div class="shot">${img ? `<a href="${esc(img)}" target="_blank"><img src="${esc(img)}" loading="lazy" alt="Lane Screen"></a>` : `<span class="noimg">Sample</span>`}<div>
      <b>Game ${r.game_no}</b>${r.discarded ? `<span class="hidden-tag">Hidden</span>` : ""}${sub}</div></div>`;
    const btns = `<div class="row-btns"><button class="chip-btn" data-read="${r.id}" data-act="retry">Re-Read</button><button class="chip-btn" data-read="${r.id}" data-act="discard">${r.discarded ? "Use Again" : "Hide"}</button></div>`;
    if (r.status !== "done") return `<div class="shot-card">${head(r.status === "reading" ? `<span class="team muted">Reading Scores…</span>` : `<div class="err">${esc(cap(String(r.error ?? "").slice(0, 240)))}</div>`)}${btns}</div>`;
    const d = r.data, fl = flagsFor(r.id);
    const brows = d.bowlers.map((b, i) => `<tr>${cell(r, `bowlers.${i}.name`, b.name, "Name", "l")}${cell(r, `bowlers.${i}.status`, STATUS[b.status] ?? "", "Status (Bowled / Absent / Vacant)", "c")}${cell(r, `bowlers.${i}.scratch`, b.scratch, `${b.name} Scratch`)}${cell(r, `bowlers.${i}.hcp`, b.hcp, `${b.name} Handicap`)}${cell(r, `bowlers.${i}.hcp_game`, b.hcp_game, `${b.name} Handicap Game`)}</tr>`).join("");
    const nf = r.edits?.length ?? 0;
    const sub = `<span class="team"><span class="fixable" data-read="${r.id}" data-path="team_name" data-label="Team Name">${esc(d.team_name)}</span> · Lane ${d.lane ?? "?"}</span>${nf ? `<small class="muted">${nf} ${nf === 1 ? "Fix" : "Fixes"}</small>` : ""}`;
    return `<div class="shot-card">${head(sub)}
      <table class="shot-t">${cols(0, 46, 52, 64, 46)}<tr><th class="l">Bowler</th><th></th><th>Scratch</th><th>Handicap</th><th>Game</th></tr>${brows}
      <tr class="tot"><td class="l">Team</td><td></td>${cell(r, "team_scratch", d.team_scratch, "Team Scratch")}${cell(r, "team_hcp", d.team_hcp ?? "–", "Team Handicap")}${cell(r, "team_hcp_total", d.team_hcp_total, "Team Handicap Total")}</tr></table>
      ${flagList(fl)}${d.notes ? `<p class="muted reader">Reader: ${esc(cap(d.notes))}</p>` : ""}${btns}</div>`;
  }).join("");
}

// Snapshot of every score, used to flash what changed and celebrate a freshly won game.
const sig = (p) => (p ? p.join("-") : null);
const snap = () => ({ 1: sig(N.games[1].result?.pts), 2: sig(N.games[2].result?.pts), 3: sig(N.games[3].result?.pts), S: sig(N.series?.pts), N: sig(N.totals) });
function track() {
  if (!S.loaded) return;
  const now = snap();
  if (!S.base) { S.base = now; return; }
  const t = Date.now() + 1600;
  for (const k of Object.keys(now)) if (now[k] !== S.base[k]) {
    S.flash[k] = t;
    if (k !== "N" && k !== "S" && now[k] && !S.base[k]) { // a new game just got scored
      S.game = null;
      const p = N.games[k].result.pts; if (p[0] > p[1]) setTimeout(celebrate, 50);
    }
  }
  S.base = now;
}
const fl = (k) => ((S.flash[k] ?? 0) > Date.now() ? " flash" : "");

// ---------- the night: start → live (game lists, newest on top) → final results ----------
function names() {
  // Our side is N.sides[0] (scoreNight puts myTeam first). The typed opponent name wins over the photo's.
  const opp = getOpp(), read = N.sides[1]?.name;
  const full = [N.sides[0]?.name ?? MY_TEAM, opp || read || "Opponent"];
  return { full, short: full.map(shortName) };
}
let NM;
const pp = (p) => p ? `<small>${esc(NM.short[0])}</small><span class="${p[0] > p[1] ? "g" : ""}">${num(p[0])}</span><span class="dm sep">·</span><small>${esc(NM.short[1])}</small><span class="${p[1] > p[0] ? "g" : p[1] < p[0] ? "dm" : ""}">${num(p[1])}</span>` : "–";
// Running points so far for one matchup, ours first ("1–1"); the leader's number is blue (tinted pill), both plain when tied.
const ptPair = (p) => !p || p[0] == null || p[1] == null ? "–" : `<span class="${p[0] > p[1] ? "g" : ""}">${num(p[0]) || "0"}</span><span class="dm">–</span><span class="${p[1] > p[0] ? "g" : ""}">${num(p[1]) || "0"}</span>`;
const nmSpan = (x, w) => `<span class="nm ${w ? "w" : ""}">${esc(x.name || "?")}${STATUS[x.status] ? `<em>${STATUS[x.status]}</em>` : ""}</span>`;

// v17: each game card shows that game alone by default; tapping the card (Game 2/3) flips it to the running
// total through that game. State per card for this session (in memory, keyed by night + card).
const vtKey = (k, inner) => `${S.night}|${inner ? "final" : "live"}|${k}`;
const isTot = (k, inner) => k > 1 && !!S.vt[vtKey(k, inner)];
const runSum = (k, f) => { let t = 0; for (let j = 1; j <= k; j++) { const v = f(N.games[j]?.result); if (v == null) return null; t += v; } return t; };
function gameList(k, inner = false) { return `${listHtml(k, inner)}${flagList(N.games[k].result.flags)}`; }
function listHtml(k, inner = false, anim = false) {
  const { reads, result: r } = N.games[k], T = thruGame(N, k), tot = isTot(k, inner);
  const margin = (x, y) => (x == null || y == null ? null : x - y);
  const pill = k > 1 ? `<button class="vt" type="button" data-vt aria-label="Show ${tot ? "this game only" : `running total thru game ${k}`}"><i class="${tot ? "" : "on"}">Game</i><i class="${tot ? "on" : ""}">Total</i></button>` : "";
  const head = `<div class="hd grid"><span class="vts">${pill}</span><span></span><span class="span">${tot ? `Thru G${k}` : `Game ${k}`}</span><span></span><span>${tot ? "Total" : "Game"}</span><span>Pins</span><span>Pts</span></div>`;
  const plain = (v, h, fmt = (x) => x) => `<span class="sc ${h}">${esc(v == null ? "?" : fmt(v))}</span>`;
  const rows = r.spots.map((s, i) => {
    const t = T?.spots[i];
    if (tot) {
      const a = runSum(k, (g) => g?.spots[i]?.a.game), b = runSum(k, (g) => g?.spots[i]?.b.game), [pa, pb] = t?.pts ?? [null, null];
      return `<div class="row grid"><span class="no">${s.spot ?? i + 1}</span>
      <div class="names">${nmSpan(s.a, pa >= pb)}${nmSpan(s.b, pb >= pa)}</div>
      <div class="scores num">${plain(a, hi(a, b), c)}${plain(b, hi(b, a), c)}</div>
      <div class="tot num ${tc(t?.pins)}">${sg(t?.pins)}</div><div class="pt pp2 num">${ptPair(t?.pts)}</div></div>`;
    }
    const [pa, pb] = s.pts ?? [null, null], d = margin(s.a.game, s.b.game);
    return `<div class="row grid"><span class="no">${s.spot ?? i + 1}</span>
      <div class="names">${nmSpan(s.a, pa >= pb)}${nmSpan(s.b, pb >= pa)}</div>
      <div class="scores num">${scoreSpan(reads[0], `bowlers.${i}.hcp_game`, s.a.game, `${s.a.name} Handicap Game`, hi(s.a.game, s.b.game))}${scoreSpan(reads[1], `bowlers.${i}.hcp_game`, s.b.game, `${s.b.name} Handicap Game`, hi(s.b.game, s.a.game))}</div>
      <div class="tot num ${tc(d)}">${sg(d)}</div><div class="pt pp2 num">${ptPair(s.pts)}</div></div>`;
  }).join("");
  let team;
  if (tot) {
    const a = runSum(k, (g) => g?.teams[0]), b = runSum(k, (g) => g?.teams[1]), [ta, tb] = T?.team.pts ?? [null, null];
    team = `<div class="row grid team"><div class="names"><span class="nm ${ta >= tb ? "w" : ""}">${esc(NM.full[0])}</span><span class="nm ${tb >= ta ? "w" : ""}">${esc(NM.full[1])}</span></div>
    <div class="scores num">${plain(a, hi(a, b), c)}${plain(b, hi(b, a), c)}</div>
    <div class="tot num ${tc(T?.team.pins)}">${sg(T?.team.pins)}</div><div class="pt pp2 num">${ptPair(T?.team.pts)}</div></div>`;
  } else {
    const [ta, tb] = r.teamPts ?? [null, null], d = margin(r.teams[0], r.teams[1]);
    team = `<div class="row grid team"><div class="names"><span class="nm ${ta >= tb ? "w" : ""}">${esc(NM.full[0])}</span><span class="nm ${tb >= ta ? "w" : ""}">${esc(NM.full[1])}</span></div>
    <div class="scores num">${scoreSpan(reads[0], "team_hcp_total", r.teams[0], "Team Handicap Total (Screen)", hi(r.teams[0], r.teams[1]), c)}${scoreSpan(reads[1], "team_hcp_total", r.teams[1], "Team Handicap Total (Screen)", hi(r.teams[1], r.teams[0]), c)}</div>
    <div class="tot num ${tc(d)}">${sg(d)}</div><div class="pt pp2 num">${ptPair(r.teamPts)}</div></div>`;
  }
  return `<div class="list ${inner ? "inner" : "glass"}${k > 1 ? " tog" : ""}${anim ? " vfade" : ""}" data-k="${k}"${inner ? " data-inner" : ""} data-view="${tot ? "total" : "game"}">${head}${rows}${team}</div>`;
}
// Tap anywhere on a Game 2/3 card (scores included) to flip Game ⇄ Total; buttons/links/inputs keep their own behaviour.
document.addEventListener("click", (e) => {
  const L = e.target.closest(".list.tog[data-k]"); if (!L) return;
  if (!e.target.closest("[data-vt]") && e.target.closest("button,a,input,select,textarea,summary,label")) return;
  const k = +L.dataset.k, inner = L.hasAttribute("data-inner"), key = vtKey(k, inner);
  if (!N?.games?.[k]?.result) return;
  S.vt[key] = !S.vt[key];
  L.outerHTML = listHtml(k, inner, true);
});
const gameTools = (k) => (S.mode === "tonight" && liveReads(k).length ? `<div class="gtools"><button class="chip-btn" data-add="${k}">Retake Photo</button><button class="chip-btn bad" data-redo="${k}">Redo Game ${k}</button></div>` : "");
function pendingGame(k) {
  const have = N.games[k].reads.filter(Boolean).map((x) => shortName(x.data.team_name));
  const reading = S.rows.some((x) => x.game_no === k && x.status === "reading" && !x.discarded) || S.uploads.some((u) => !u.done && u.label.startsWith(`Game ${k} `));
  const msg = reading ? "Reading Scores…" : have.length ? `Got ${esc(have.join(" & "))} · Add The Other Lane` : "Photo Not Read · Retake It";
  return `<section class="sec"><div class="sh"><h2>Game ${k}</h2></div><div class="glass pend${reading ? " busy" : ""}">${msg}</div>${gameTools(k)}</section>`;
}

function finalHtml(F) {
  const s = N.series, [u, t] = F.night, res = u > t ? "Won" : u < t ? "Lost" : "Tied";
  const two = (a, b, fmt, h) => `<div class="scores num"><span class="sc ${h ? hi(a, b) : "t2"}">${a == null ? "?" : fmt(a)}</span><span class="sc ${h ? hi(b, a) : "t2"}">${b == null ? "?" : fmt(b)}</span></div>`;
  const ptsCol = ([pa, pb]) => `<div class="scores num"><span class="sc pt2 ${hi(pa, pb)}">${num(pa)}</span><span class="sc pt2 ${hi(pb, pa)}">${num(pb)}</span></div>`;
  const rows = s.spots.map((x, i) => { const [pa, pb] = F.spots[i].pts; return `<div class="row grid3"><span class="no">${x.spot ?? i + 1}</span>
    <div class="names">${nmSpan(x.a, pa >= pb)}${nmSpan(x.b, pb >= pa)}</div>${two(x.a.scratch, x.b.scratch, String, false)}${two(x.a.game, x.b.game, String, true)}${ptsCol(F.spots[i].pts)}</div>`; }).join("");
  const [ta, tb] = F.team.pts;
  const team = `<div class="row grid3 team"><div class="names"><span class="nm ${ta >= tb ? "w" : ""}">${esc(NM.full[0])}</span><span class="nm ${tb >= ta ? "w" : ""}">${esc(NM.full[1])}</span></div>
    ${two(F.team.scratch[0], F.team.scratch[1], c, false)}${two(s.teams[0], s.teams[1], c, true)}${ptsCol(F.team.pts)}</div>`;
  const games = [3, 2, 1].map((k) => `<details><summary><span>Game ${k}</span><span class="r num">${pp(N.games[k].result.pts)}</span><span class="chev">›</span></summary>${gameList(k, true)}${gameTools(k)}</details>`).join("");
  return `<section class="hero glass${fl("N")}"><div class="res">${res}</div>
    <div class="hs"><div class="${u > t ? "g" : ""}"><b class="num">${num(u)}</b><span>${esc(NM.short[0])}</span></div><i>·</i><div class="${t > u ? "g" : ""}"><b class="num">${num(t)}</b><span>${esc(NM.short[1])}</span></div></div>
    <div class="of">Of 35 Points</div></section>
    <section class="sec"><div class="list glass"><div class="hd grid3"><span></span><span>Scratch</span><span>Handicap</span><span>Pts</span></div>${rows}${team}</div>
    <p class="note">Bowlers Of 5 · Team Of 10</p>${flagList(s.flags)}</section>
    <section class="sec"><div class="list glass games">${games}</div></section>`;
}

// v17 "See Final Results" pop-up: floats above the tab bar (inside #nightView, so it hides with that page); once per load.
function finPop(show) {
  let el = $("#finPop");
  if (!show) { if (el) el.remove(); return; }
  if (el) return;
  $("#nightView").insertAdjacentHTML("beforeend", `<div id="finPop" class="finpop glass" role="dialog" aria-label="Game 3 is in"><div class="fp-t"><b>Game 3 Is In</b><span>Night totals are ready</span></div><button class="addp" data-final="1"><span>See Final Results</span> ›</button><button class="fp-x" data-finx aria-label="Dismiss">✕</button></div>`);
}
document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-final],[data-finx]"); if (!f) return;
  S.popGone = true;
  if (f.dataset.final != null) { S.showFinal = f.dataset.final === "1"; render(); scrollTo(0, 0); } else render();
});
function render() {
  N = scoreNight(S.rows, { myTeam: MY_TEAM }); NM = names();
  track();
  const tonight = S.mode === "tonight", g = curGame();
  const active = S.rows.some((r) => !r.discarded && (r.status === "done" || r.status === "reading")) || S.uploads.some((u) => !u.done);
  const F = N.sides.length >= 2 ? thruGame(N, 3, { final: true }) : null;
  // v17: once Game 3 is in, Tonight shows the Game 3 card first (live view) and offers Final Results via a pop-up + header button.
  const g3view = tonight && !!F && !S.showFinal;
  const state = tonight && !active ? "start" : F && !g3view ? "final" : "live";
  let thruN = 0; while (thruN < 3 && N.games[thruN + 1].result) thruN++;

  // header
  const lanes = [...new Set(S.rows.filter((r) => r.status === "done" && !r.discarded && r.data?.lane != null).map((r) => +r.data.lane))].sort((a, b) => a - b);
  const where = tonight ? (lanes.length ? `${lanes.length > 1 ? "Lanes" : "Lane"} ${lanes.join(" & ")}` : shortDate(S.night)) : shortDate(S.night, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const oppShown = getOpp() || N.sides[1]?.name;
  const sub = state === "start" ? (DEMO ? "Demo Night" : shortDate(S.night)) : `${oppShown ? (tonight ? `<button class="opp-edit" data-editopp>${esc(oppShown)}</button>` : esc(oppShown)) + " · " : ""}${where}`;
  const act = !tonight ? `<button class="chip-btn" data-go="past">‹ Past Weeks</button>` : state === "start" ? "" : state === "final" && S.game == null ? (tonight ? `<button class="chip-btn" data-final="0">‹ Game 3</button>` : `<span class="done">Night Complete</span>`) : g3view && S.game == null ? `<button class="addp fin" data-final="1"><span>See Final Results</span></button>` : addBtn(g);
  let strip = "";
  if (state === "live" && thruN >= 1 && N.sides.length >= 2) {
    const T = thruGame(N, thruN);
    strip = `<div><div class="k">Points Thru G${thruN}</div><div class="v num${(NM.short.join("") + num(T.night[0]) + num(T.night[1])).length > 21 ? " tight" : ""}${fl("N")}">${pp(T.night)}</div></div>
      <div><div class="k">Pins Thru G${thruN}</div><div class="v num ${T.team.pins > 0 ? "g" : ""}">${sg(T.team.pins)}</div></div>
      ${tonight ? `<div><div class="k">Next</div><div class="v num">${g3view && S.game == null ? "Final" : `Game ${g}`}</div></div>` : `<div><div class="k">Points Remaining</div><div class="v num">${num(N.up)}</div></div>`}`;
  }
  if (S.page === "night") setHeader(state === "final" ? "Final Results" : tonight ? "Tonight" : shortDate(S.night, { weekday: "short", month: "short", day: "numeric" }), sub, act, strip);

  // start steps (static markup so typing isn't interrupted by live updates)
  $("#startBox").hidden = state !== "start";
  if (state === "start") { $("#startLbl").textContent = `Add Game ${g}`; if (document.activeElement !== $("#oppName")) $("#oppName").value = getOpp(); startBtn(); }

  $("#uploads").innerHTML = S.uploads.slice(-6).filter((u) => !u.done || u.state.startsWith("✗")).map((u) => `<li class="${u.state.startsWith("✗") ? "bad" : ""}">${esc(u.label)}: ${esc(u.state)}</li>`).join("");
  const flagged = Object.values(N.readFlags).flat().filter((f) => f.level !== "info").length;
  if (flagged && !S.openedScreens) { $("#screensBox").open = true; S.openedScreens = true; }
  const banners = `${flagged ? `<div class="banner warn">⚠ ${flagged} ${flagged === 1 ? "Number" : "Numbers"} To Check · Fix In Screens &amp; Fixes Below</div>` : ""}${N.notes.map((n) => `<div class="banner">${esc(cap(n))}</div>`).join("")}`;

  let body = "";
  if (state === "final") body = finalHtml(F);
  else if (state === "live") {
    const ks = [3, 2, 1].filter((k) => N.games[k].result || S.rows.some((r) => r.game_no === k && !r.discarded) || S.uploads.some((u) => !u.done && u.label.startsWith(`Game ${k} `)));
    body = ks.map((k) => N.games[k].result && N.sides.length >= 2
      ? `<section class="sec"><div class="sh${fl(k)}"><h2>Game ${k}</h2><span class="r num">${pp(N.games[k].result.pts)}</span></div>${gameList(k)}${gameTools(k)}</section>`
      : pendingGame(k)).join("");
    if (!ks.length) body = `<div class="glass pad muted center">No Scores Were Saved For This Night</div>`;
    else body += `<p class="foot">7 Pts A Game · 35 A Night</p>`;
  }
  $("#board").innerHTML = state === "start" ? "" : banners + body;
  $("#screensBox").hidden = state === "start" && !S.rows.length;
  $("#screens").innerHTML = screensHtml();
  finPop(state === "live" && g3view && S.game == null && !S.popGone);
  const next = Math.min(...Object.values(S.flash).filter((t) => t > Date.now()));
  if (Number.isFinite(next)) { clearTimeout(S.flashT); S.flashT = setTimeout(render, next - Date.now() + 20); }
}

if (SUPABASE_URL.includes("YOUR-PROJECT")) document.body.insertAdjacentHTML("afterbegin", `<p class="err" style="padding:12px">Fill in config.js (SUPABASE_URL, SUPABASE_ANON_KEY) first.</p>`);
// A saved code is re-verified before the app shows (#gate and #app both start hidden), so a changed team code locks
// old phones out. 401 → call() clears it and shows the gate. Network error/timeout/server error → show the app anyway
// so league night isn't blocked offline.
async function boot() {
  if (DEMO || !S.code) return show();
  const saved = S.code;
  try { await Promise.race([call({ action: "check" }), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000))]); }
  catch {}
  if (S.code === saved) show(); // still set unless the check came back 401
}
boot();
