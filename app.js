import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTION_NAME, MY_TEAM } from "./config.js";
import { scoreNight, paperText } from "./scoring.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const FN = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the phone's time zone

const S = { code: localStorage.getItem("teamCode"), night: localStorage.getItem("night") || today(), game: null, rows: [], uploads: [], chan: null };

async function call(body) {
  const isForm = body instanceof FormData;
  if (!isForm) body = JSON.stringify({ ...body, code: S.code });
  else body.set("code", S.code);
  const res = await fetch(FN, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, ...(isForm ? {} : { "Content-Type": "application/json" }) }, body });
  const out = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status === 401) { localStorage.removeItem("teamCode"); S.code = null; show(); }
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
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
  catch (err) { $("#gateErr").textContent = err.message; S.code = null; }
};
$("#logout").onclick = () => { localStorage.removeItem("teamCode"); S.code = null; location.reload(); };

// ---------- data + realtime ----------
async function load() {
  const { data, error } = await sb.from("reads").select("*").eq("night_date", S.night).order("created_at");
  if (!error) { S.rows = data; render(); }
}
function subscribe() {
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
let started = false;
function start() {
  if (started) return; started = true;
  $("#night").value = S.night;
  subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
$("#night").onchange = (e) => { S.night = e.target.value || today(); localStorage.setItem("night", S.night); S.rows = []; S.game = null; subscribe(); render(); };
$("#gamePick").onclick = (e) => { const g = +e.target.dataset.g; if (g) { S.game = g; render(); } };

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
  const game = curGame();
  for (const f of files) {
    const u = { label: `Game ${game} photo ${S.uploads.length + 1}`, state: "uploading…" };
    S.uploads.push(u); render();
    (async () => {
      try {
        const fd = new FormData();
        fd.set("night_date", S.night); fd.set("game", game);
        fd.set("photo", await shrink(f), "screen.jpg");
        u.state = "reading numbers…"; render();
        const r = await call(fd);
        u.state = r.status === "done" ? `✓ ${r.data.team_name}` : `✗ ${r.error}`;
      } catch (e) { u.state = `✗ ${e.message}`; }
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
    if (t.dataset.act === "discard" && !confirm("Hide this photo from scoring?")) return;
    try { await call({ action: t.dataset.act, read_id: row.id, discarded: !row.discarded }); } catch (err) { alert(err.message); }
    return load();
  }
  const path = t.dataset.path, keys = path.split(".");
  const cur = keys.reduce((o, k) => o?.[k], row.data);
  const isNum = !["name", "team_name", "status"].includes(keys.at(-1));
  let v = prompt(`${t.dataset.label || path}${keys.at(-1) === "status" ? " (bowled / absent / vacant)" : ""}`, cur ?? "");
  if (v === null) return;
  v = v.trim();
  if (isNum) { if (v === "") v = null; else if (!/^\d+$/.test(v)) return alert("Whole number please"); else v = +v; }
  // optimistic local update so this phone re-scores instantly; Realtime pushes it to everyone else
  const prev = structuredClone(row.data);
  let o = row.data; for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = v; render();
  try { await call({ action: "fix", read_id: row.id, path, value: v }); }
  catch (err) { row.data = prev; render(); alert(err.message); }
});

// ---------- render ----------
let N = null;
const curGame = () => S.game ?? ([1, 2, 3].find((g) => !N?.games[g]?.result) ?? 3);
const flagsFor = (id) => N?.readFlags[id] ?? [];
function cls(id, path) {
  const f = flagsFor(id).filter((x) => x.path === path || (path.endsWith("hcp_game") && x.path === path.replace("hcp_game", "scratch") && x.level === "unsure"));
  return f.some((x) => x.level === "bad") ? "bad" : f.some((x) => x.level === "unsure") ? "unsure" : "";
}
const cell = (read, path, val, label, extra = "") =>
  read ? `<td class="fixable ${cls(read.id, path)} ${extra}" data-read="${read.id}" data-path="${path}" data-label="${esc(label)}">${esc(val ?? "?")}</td>` : `<td>${esc(val ?? "?")}</td>`;
const pts = (p) => (p ? p.map((x) => (Number.isInteger(x) ? x : x.toFixed(1))).join("–") : "?");
const win = (p, i) => (p && p[i] > p[1 - i] ? "w" : "");

function gameCard(g) {
  const { reads, result: r } = N.games[g];
  const [A, B] = N.sides;
  if (!r) {
    const have = reads.filter(Boolean).map((x) => x.data.team_name);
    const reading = S.rows.some((x) => x.game_no === g && x.status === "reading");
    return `<div class="card"><h2>Game ${g}</h2><p class="muted">${reading ? "Reading photo…" : have.length ? `Have ${esc(have.join(", "))}; need the other lane.` : "No photos yet."}</p></div>`;
  }
  const rows = r.spots.map((s, i) => `<tr><td>${s.spot}</td><td class="l ${win(s.pts, 0)}">${esc(s.a.name)}</td>${cell(reads[0], `bowlers.${i}.hcp_game`, s.a.game, `${s.a.name} handicap game`, win(s.pts, 0))}
    ${cell(reads[1], `bowlers.${i}.hcp_game`, s.b.game, `${s.b.name} handicap game`, win(s.pts, 1))}<td class="r ${win(s.pts, 1)}">${esc(s.b.name)}</td><td>${pts(s.pts)}</td></tr>`).join("");
  return `<div class="card"><h2>Game ${g}<span>${pts(r.pts)}</span></h2><table>
    <tr><th>#</th><th class="l">${esc(A.name)}</th><th>hdcp</th><th>hdcp</th><th class="r">${esc(B.name)}</th><th>pts</th></tr>${rows}
    <tr class="tot"><td></td><td class="l">Team</td>${cell(reads[0], "team_hcp_total", r.teams[0], "team handicap total (screen)", win(r.teamPts, 0))}${cell(reads[1], "team_hcp_total", r.teams[1], "team handicap total (screen)", win(r.teamPts, 1))}<td></td><td>${pts(r.teamPts)}</td></tr>
    <tr class="tot"><td></td><td class="l">Game ${g} points</td><td class="${win(r.pts, 0)}">${pts([r.pts[0]])}</td><td class="${win(r.pts, 1)}">${pts([r.pts[1]])}</td><td></td><td></td></tr>
  </table>${r.flags.length ? `<ul class="flags">${r.flags.map((f) => `<li class="info">${esc(f)}</li>`).join("")}</ul>` : ""}</div>`;
}

function seriesCard() {
  const s = N.series, [A, B] = N.sides;
  if (!s) return "";
  const rows = s.spots.map((x) => `<tr><td>${x.spot}</td><td class="l ${win(x.pts, 0)}">${esc(x.a.name)}</td><td class="${win(x.pts, 0)}">${x.a.game ?? "?"}</td><td class="${win(x.pts, 1)}">${x.b.game ?? "?"}</td><td class="r ${win(x.pts, 1)}">${esc(x.b.name)}</td><td>${pts(x.pts)}</td></tr>`).join("");
  return `<div class="card"><h2>Series (3-game hdcp)<span>${pts(s.pts)}</span></h2><table>
    <tr><th>#</th><th class="l">${esc(A.name)}</th><th>hdcp</th><th>hdcp</th><th class="r">${esc(B.name)}</th><th>pts</th></tr>${rows}
    <tr class="tot"><td></td><td class="l">Team</td><td class="${win(s.teamPts, 0)}">${s.teams[0] ?? "?"}</td><td class="${win(s.teamPts, 1)}">${s.teams[1] ?? "?"}</td><td></td><td>${pts(s.teamPts)}</td></tr></table>
    ${s.flags.length ? `<ul class="flags">${s.flags.map((f) => `<li class="info">${esc(f)}</li>`).join("")}</ul>` : ""}</div>`;
}

function screensHtml() {
  const rows = [...S.rows].sort((a, b) => a.game_no - b.game_no || a.created_at.localeCompare(b.created_at));
  if (!rows.length) return `<p class="muted">Snap the lane screen after each game: one photo per lane.</p>`;
  return rows.map((r) => {
    const img = sb.storage.from("screens").getPublicUrl(r.photo_path).data.publicUrl;
    const head = `<div class="shot"><a href="${esc(img)}" target="_blank"><img src="${esc(img)}" loading="lazy" alt="lane screen"></a><div>
      <b>Game ${r.game_no}</b> ${r.discarded ? "<i>(hidden)</i>" : ""}<br>`;
    const btns = `<div class="row"><button data-read="${r.id}" data-act="retry">Re-read</button><button data-read="${r.id}" data-act="discard">${r.discarded ? "Use again" : "Hide"}</button></div>`;
    if (r.status !== "done") return `<div class="card">${head}${r.status === "reading" ? "Reading…" : `<span class="err">${esc(r.error)}</span>`}</div></div>${btns}</div>`;
    const d = r.data, fl = flagsFor(r.id);
    const brows = d.bowlers.map((b, i) => `<tr>${cell(r, `bowlers.${i}.name`, b.name, "name", "l")}${cell(r, `bowlers.${i}.status`, b.status === "bowled" ? "" : b.status, "status")}${cell(r, `bowlers.${i}.scratch`, b.scratch, `${b.name} scratch`)}${cell(r, `bowlers.${i}.hcp`, b.hcp, `${b.name} handicap`)}${cell(r, `bowlers.${i}.hcp_game`, b.hcp_game, `${b.name} handicap game`)}</tr>`).join("");
    return `<div class="card">${head}<span class="fixable" data-read="${r.id}" data-path="team_name" data-label="team name">${esc(d.team_name)}</span> · lane ${d.lane ?? "?"}
      ${r.edits?.length ? `<br><small class="muted">${r.edits.length} fix(es)</small>` : ""}</div></div>
      <table><tr><th class="l">Bowler</th><th></th><th>scr</th><th>hdcp</th><th>game</th></tr>${brows}
      <tr class="tot"><td class="l">Team</td><td></td>${cell(r, "team_scratch", d.team_scratch, "team scratch")}${cell(r, "team_hcp", d.team_hcp ?? "–", "team handicap")}${cell(r, "team_hcp_total", d.team_hcp_total, "team handicap total")}</tr></table>
      ${fl.length ? `<ul class="flags">${fl.map((f) => `<li class="${f.level}">${esc(f.msg)}</li>`).join("")}</ul>` : ""}
      ${d.notes ? `<p class="muted">Reader: ${esc(d.notes)}</p>` : ""}${btns}</div>`;
  }).join("");
}

function render() {
  N = scoreNight(S.rows, { myTeam: MY_TEAM });
  const g = curGame();
  document.querySelectorAll("#gamePick button").forEach((b) => b.classList.toggle("on", +b.dataset.g === g));
  $("#uploads").innerHTML = S.uploads.slice(-6).map((u) => `<li>${esc(u.label)}: ${esc(u.state)}</li>`).join("");
  if (N.sides.length < 2) { $("#board").innerHTML = `<div class="card muted">Scores appear when both lanes' photos for a game are in.</div>`; $("#screens").innerHTML = screensHtml(); return; }
  const [A, B] = N.sides;
  const sumRow = (i) => `<tr><td class="l">${esc(N.sides[i].name)}</td>${[1, 2, 3].map((k) => `<td>${N.games[k].result ? pts([N.games[k].result.pts[i]]) : "–"}</td>`).join("")}<td>${N.series ? pts([N.series.pts[i]]) : "–"}</td><td class="w">${pts([N.totals[i]])}</td></tr>`;
  const flagged = Object.values(N.readFlags).flat().filter((f) => f.level !== "info").length;
  $("#board").innerHTML = `
    <div class="card head"><div><b>${pts([N.totals[0]])}</b><small>${esc(A.name)}</small></div><div class="muted">${N.up} of 35<br>still up</div><div><b>${pts([N.totals[1]])}</b><small>${esc(B.name)}</small></div></div>
    ${flagged ? `<div class="card err">⚠ ${flagged} number(s) to check — highlighted below. Tap to fix.</div>` : ""}
    ${N.notes.map((n) => `<p class="muted">${esc(n)}</p>`).join("")}
    ${[1, 2, 3].map(gameCard).join("")}${seriesCard()}
    <div class="card"><h2>Points tonight</h2><table><tr><th class="l">Team</th><th>G1</th><th>G2</th><th>G3</th><th>Series</th><th>Total</th></tr>${sumRow(0)}${sumRow(1)}</table></div>
    <div class="card"><h2>For the paper sheet <button class="link" id="copy">copy</button></h2><pre id="paper">${esc(paperText(N))}</pre></div>`;
  $("#copy").onclick = () => navigator.clipboard?.writeText($("#paper").textContent);
  $("#screens").innerHTML = screensHtml();
}

if (SUPABASE_URL.includes("YOUR-PROJECT")) document.body.insertAdjacentHTML("afterbegin", `<p class="err" style="padding:12px">Fill in config.js (SUPABASE_URL, SUPABASE_ANON_KEY) first.</p>`);
show();
