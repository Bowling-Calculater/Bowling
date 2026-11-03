// Pot of Gold league scoring. Pure functions, no DOM; used by the site (app.js) and Node tests.
// Rules: rules.txt (Lucky Strike, Fall 2026/27) + Tanner's house rules (ties split, pair by lineup spot).

export const PTS = { game: 1, series: 2, teamGame: 2, teamSeries: 4, night: 35 };
export const VACANCY = { scratch: 100, hcp: 121 };   // rules.txt: "100 and 121 handicap"
export const ABSENT_MINUS = 10, ABSENT_MAX = 235;      // absentee = average - 10, max 235 (scratch)
const NUM_FIELDS = ["scratch", "hcp", "hcp_game"];

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Handicap = 90% of (235 - average), fractions dropped. Invert it: return the unique
// average that produces this handicap, or null when hcp is missing / ambiguous (e.g. 0).
export function averageFromHcp(hcp) {
  if (hcp == null || hcp <= 0) return null;
  const hits = [];
  for (let a = 0; a <= 300; a++) if (Math.floor((9 * (235 - a)) / 10) === hcp) hits.push(a);
  return hits.length === 1 ? hits[0] : null;
}

// Effective numbers for one bowler row, applying absentee / vacancy rules where the screen is blank.
export function bowlerScore(b) {
  const status = b?.status ?? "bowled";
  let { scratch = null, hcp = null, hcp_game: game = null } = b ?? {};
  const notes = [];
  if (status === "vacant") {
    scratch ??= VACANCY.scratch; hcp ??= VACANCY.hcp; game ??= scratch + hcp;
  } else if (game == null && scratch != null && hcp != null) {
    game = scratch + hcp;
  } else if (game == null && status === "absent") {
    const avg = averageFromHcp(hcp);
    if (avg != null) {
      scratch = Math.min(avg - ABSENT_MINUS, ABSENT_MAX); game = scratch + hcp;
      notes.push(`absentee score estimated: avg ${avg} (from hcp ${hcp}) - 10 = ${scratch}; check vs recap`);
    } else notes.push("absent bowler with no score on screen: enter average - 10 (max 235) as scratch");
  }
  return { name: b?.name ?? "", status, scratch, hcp, game, notes };
}

// Consistency / confidence flags for one screen read. path is "team_scratch" or "bowlers.2.scratch".
export function checkRead(d) {
  const f = [];
  const add = (path, msg, level = "bad") => f.push({ path, msg, level });
  const bs = d?.bowlers ?? [];
  if (bs.length !== 5) add("bowlers", `${bs.length} bowlers read (expected 5)`);
  const sum = { scratch: 0, hcp: 0, hcp_game: 0 }, missing = { scratch: 0, hcp: 0, hcp_game: 0 };
  bs.forEach((b, i) => {
    const p = `bowlers.${i}`;
    for (const k of NUM_FIELDS) b[k] == null ? missing[k]++ : (sum[k] += b[k]);
    if (b.status === "bowled") for (const k of NUM_FIELDS) if (b[k] == null) add(`${p}.${k}`, `${b.name || "bowler " + (i + 1)}: ${k} missing`);
    if (b.scratch != null && (b.scratch < 0 || b.scratch > 300)) add(`${p}.scratch`, `scratch ${b.scratch} is impossible`);
    if (b.hcp != null && (b.hcp < 0 || b.hcp > 235)) add(`${p}.hcp`, `handicap ${b.hcp} looks wrong`);
    if (b.scratch != null && b.hcp != null && b.hcp_game != null && b.scratch + b.hcp !== b.hcp_game)
      add(`${p}.hcp_game`, `${b.name}: ${b.scratch} + ${b.hcp} = ${b.scratch + b.hcp}, screen says ${b.hcp_game}`);
    if (b.status === "absent" || b.status === "vacant") add(`${p}.status`, `${b.name || "spot " + (i + 1)} marked ${b.status}`, "info");
    for (const n of bowlerScore(b).notes) add(`${p}.scratch`, n, "unsure");
    if (b.unsure) for (const k of NUM_FIELDS) add(`${p}.${k}`, `${b.name}: reader unsure`, "unsure");
  });
  const tot = (k, label, val) => {
    if (val == null || missing[k]) return;
    if (sum[k] !== val) add(k === "scratch" ? "team_scratch" : k === "hcp" ? "team_hcp" : "team_hcp_total",
      `bowler ${label} add up to ${sum[k]}, team total says ${val}`);
  };
  tot("scratch", "scratch scores", d?.team_scratch);
  tot("hcp", "handicaps", d?.team_hcp);
  tot("hcp_game", "handicap games", d?.team_hcp_total);
  if (d?.team_scratch != null && d?.team_hcp != null && d?.team_hcp_total != null && d.team_scratch + d.team_hcp !== d.team_hcp_total)
    add("team_hcp_total", `team ${d.team_scratch} + ${d.team_hcp} != ${d.team_hcp_total}`);
  for (const raw of d?.unsure_fields ?? []) {
    const path = String(raw).replace(/\[(\d+)\]/g, ".$1");
    if (!f.some((x) => x.path === path && x.level === "unsure")) add(path, `reader unsure about ${path}`, "unsure");
  }
  return f;
}

const split = (x, y, p) => (x > y ? [p, 0] : x < y ? [0, p] : [p / 2, p / 2]);

// Award p points between sides a and b ({game, status, scratch, avg}). Blind (absent) / vacant
// sides cannot win points; beating a vacancy needs scratch >= own average - `within`.
function award(a, b, p, within, flags, label) {
  if (a.game == null || b.game == null) return null;
  const r = split(a.game, b.game, p);
  const nb = [a.status !== "bowled", b.status !== "bowled"];
  if (nb[0] && nb[1]) return r;
  [a, b].forEach((s, i) => {
    if (!nb[i]) return;
    if (r[i]) flags.push(`${label}: ${s.status} side can't win, ${r[i]} pt not awarded`);
    r[i] = 0;
    const o = i ? a : b, j = 1 - i;
    if (s.status === "vacant" && r[j]) {
      if (o.avg == null || o.scratch == null) flags.push(`${label}: vs vacancy, opponent must bowl within ${within} of average; check by hand`);
      else if (o.scratch < o.avg - within) { flags.push(`${label}: ${o.scratch} not within ${within} of avg ${o.avg} vs vacancy, no point`); r[j] = 0; }
    }
  });
  return r;
}

const side = (b) => { const s = bowlerScore(b); return { ...s, avg: averageFromHcp(s.hcp) }; };
const teamNB = (bs) => bs.length > 0 && bs.every((b) => (b?.status ?? "bowled") !== "bowled");

// Score one game between two reads (data objects). Lineup spot i faces spot i.
export function scoreGame(A, B) {
  const flags = [], ba = A?.bowlers ?? [], bb = B?.bowlers ?? [];
  const n = Math.max(ba.length, bb.length), spots = [];
  const pts = [0, 0];
  for (let i = 0; i < n; i++) {
    const a = side(ba[i]), b = side(bb[i]);
    const r = award(a, b, PTS.game, 10, flags, `Spot ${i + 1}`);
    if (!r) flags.push(`Spot ${i + 1}: missing score`);
    else { pts[0] += r[0]; pts[1] += r[1]; }
    spots.push({ spot: i + 1, a, b, pts: r });
  }
  const total = (bs) => bs.reduce((t, b) => { const g = side(b).game; return t == null || g == null ? null : t + g; }, 0);
  const teams = [total(ba), total(bb)];
  const ta = { game: teams[0], status: teamNB(ba) ? "vacant" : "bowled" }, tb = { game: teams[1], status: teamNB(bb) ? "vacant" : "bowled" };
  const teamPts = award(ta, tb, PTS.teamGame, 50, flags, "Team game");
  if (teamPts) { pts[0] += teamPts[0]; pts[1] += teamPts[1]; } else flags.push("Team game: a team total is missing");
  return { spots, teams, teamPts, pts, flags };
}

function similar(a, b) { // Dice coefficient on bigrams of normalized names, 0..1
  a = norm(a); b = norm(b);
  if (a === b) return 1;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const x = bg(a), y = bg(b); let hit = 0, tot = 0;
  for (const [g, c] of x) { hit += Math.min(c, y.get(g) || 0); tot += c; }
  for (const c of y.values()) tot += c;
  return tot ? (2 * hit) / tot : 0;
}

// rows: [{id, game_no, created_at, status, discarded, data}] for one night.
// Returns everything the UI needs: sides, per-game results, series, totals and per-read flags.
export function scoreNight(rows, { myTeam = "" } = {}) {
  const usable = rows.filter((r) => r.status === "done" && r.data && !r.discarded)
    .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  const sides = [], notes = [], readFlags = {};
  for (const r of usable) {
    const nm = r.data.team_name, lane = r.data.lane ?? null;
    let s = sides.find((s) => similar(s.name, nm) >= 0.75) ?? sides.find((s) => lane != null && s.lane === lane);
    if (!s && sides.length < 2) { s = { name: nm, lane }; sides.push(s); }
    if (!s) { notes.push(`Ignored screen "${nm}" (not one of the two teams tonight)`); continue; }
    r._side = s;
  }
  sides.sort((x, y) => (similar(y.name, myTeam) >= 0.75) - (similar(x.name, myTeam) >= 0.75) || (x.lane ?? 99) - (y.lane ?? 99));
  const games = {}, totals = [0, 0];
  let up = PTS.night;
  for (const g of [1, 2, 3]) {
    const pick = sides.map((s) => {
      const rs = usable.filter((r) => r.game_no === g && r._side === s);
      if (rs.length > 1) notes.push(`Game ${g}: ${rs.length} photos of ${s.name}, using the newest`);
      return rs.at(-1) ?? null;
    });
    const res = pick[0] && pick[1] ? scoreGame(pick[0].data, pick[1].data) : null;
    if (res) { totals[0] += res.pts[0]; totals[1] += res.pts[1]; up -= 7; }
    games[g] = { reads: pick, result: res };
  }
  // Cross-game checks: handicap is fixed for the night, lineup spots should keep the same bowler.
  for (const s of sides) {
    const rs = [1, 2, 3].map((g) => games[g].reads[sides.indexOf(s)]).filter(Boolean);
    rs.slice(1).forEach((r) => (r.data.bowlers ?? []).forEach((b, i) => {
      const f = rs[0].data.bowlers?.[i];
      if (!f) return;
      if (f.hcp != null && b.hcp != null && f.hcp !== b.hcp) (readFlags[r.id] ??= []).push({ path: `bowlers.${i}.hcp`, msg: `${b.name}: hcp ${b.hcp} here but ${f.hcp} in an earlier game`, level: "bad" });
      if (norm(f.name) !== norm(b.name)) (readFlags[r.id] ??= []).push({ path: `bowlers.${i}.name`, msg: `spot ${i + 1} is ${b.name} here but ${f.name} earlier; series is scored by spot`, level: "info" });
    }));
  }
  let series = null;
  if ([1, 2, 3].every((g) => games[g].result)) {
    const flags = [], spots = [], pts = [0, 0], R = [1, 2, 3].map((g) => games[g].result);
    for (let i = 0; i < R[0].spots.length; i++) {
      const mk = (k) => {
        const ss = R.map((r) => r.spots[i]?.[k]);
        const game = ss.some((x) => x?.game == null) ? null : ss.reduce((t, x) => t + x.game, 0);
        const scratch = ss.some((x) => x?.scratch == null) ? null : ss.reduce((t, x) => t + x.scratch, 0);
        const avg = ss[0]?.avg == null ? null : ss[0].avg * 3;
        return { name: ss[0]?.name, game, scratch, avg, status: ss.every((x) => x?.status !== "bowled") ? ss[0]?.status : "bowled" };
      };
      const a = mk("a"), b = mk("b");
      const r = award(a, b, PTS.series, 30, flags, `Series spot ${i + 1}`);
      if (r) { pts[0] += r[0]; pts[1] += r[1]; }
      spots.push({ spot: i + 1, a, b, pts: r });
    }
    const teams = [0, 1].map((k) => R.reduce((t, r) => (t == null || r.teams[k] == null ? null : t + r.teams[k]), 0));
    const nb = [0, 1].map((k) => R.every((r) => r.spots.every((s) => s[k ? "b" : "a"].status !== "bowled")) ? "vacant" : "bowled");
    const teamPts = award({ game: teams[0], status: nb[0] }, { game: teams[1], status: nb[1] }, PTS.teamSeries, 150, flags, "Team series");
    if (teamPts) { pts[0] += teamPts[0]; pts[1] += teamPts[1]; }
    totals[0] += pts[0]; totals[1] += pts[1]; up -= 14;
    series = { spots, teams, teamPts, pts, flags };
  }
  for (const r of usable) readFlags[r.id] = [...checkRead(r.data), ...(readFlags[r.id] ?? [])];
  return { sides, games, series, totals, up, notes, readFlags };
}

// Running totals through game g (1..3) for the night view: per lineup spot and team, pins margin (side A minus B,
// handicap) and points won so far. null wherever any game 1..g is missing: never guessed.
// With final=true (all 3 games in) the series points are added, i.e. each matchup's whole night (bowler of 5, team of 10).
const addUp = (xs) => xs.reduce((t, x) => (t == null || x == null ? null : t + x), 0);
const margin = (x, y) => (x == null || y == null ? null : x - y);
export function thruGame(n, g, { final = false } = {}) {
  const R = [];
  for (let j = 1; j <= g; j++) { const r = n?.games?.[j]?.result; if (!r) return null; R.push(r); }
  const S = final ? n.series : null;
  if (final && !S) return null;
  const spots = R[0].spots.map((_, i) => ({
    pins: addUp(R.map((r) => margin(r.spots[i]?.a.game, r.spots[i]?.b.game))),
    pts: [0, 1].map((k) => addUp([...R.map((r) => r.spots[i]?.pts?.[k] ?? null), ...(S ? [S.spots[i]?.pts?.[k] ?? null] : [])])),
  }));
  const team = {
    pins: addUp(R.map((r) => margin(r.teams[0], r.teams[1]))),
    pts: [0, 1].map((k) => addUp([...R.map((r) => r.teamPts?.[k] ?? null), ...(S ? [S.teamPts?.[k] ?? null] : [])])),
    scratch: S ? [0, 1].map((k) => addUp(S.spots.map((x) => (k ? x.b : x.a).scratch))) : null, // series scratch, team
  };
  const night = [0, 1].map((k) => R.reduce((t, r) => t + r.pts[k], 0) + (S ? S.pts[k] : 0));
  return { g, spots, team, night };
}

// Plain-text recap that is easy to copy onto the paper sheet.
export function paperText(n) {
  const [A, B] = n.sides.map((s) => s?.name ?? "?");
  const L = [`${A}  vs  ${B}`];
  for (const g of [1, 2, 3]) {
    const r = n.games[g].result;
    if (!r) { L.push(`Game ${g}: waiting for both photos`); continue; }
    L.push(`Game ${g}`);
    for (const s of r.spots) L.push(`  ${s.spot}. ${s.a.name} ${s.a.game ?? "?"} - ${s.b.game ?? "?"} ${s.b.name}   ${s.pts ? s.pts.join("-") : "?"}`);
    L.push(`  Team ${r.teams[0] ?? "?"} - ${r.teams[1] ?? "?"}   ${r.teamPts ? r.teamPts.join("-") : "?"}`, `  Points ${r.pts.join("-")}`);
  }
  if (n.series) {
    L.push("Series");
    for (const s of n.series.spots) L.push(`  ${s.spot}. ${s.a.name} ${s.a.game} - ${s.b.game} ${s.b.name}   ${s.pts ? s.pts.join("-") : "?"}`);
    L.push(`  Team ${n.series.teams.join(" - ")}   ${n.series.teamPts ? n.series.teamPts.join("-") : "?"}`, `  Points ${n.series.pts.join("-")}`);
  }
  L.push(`NIGHT ${A} ${n.totals[0]} - ${n.totals[1]} ${B}   (${n.up} still up of 35)`);
  return L.join("\n");
}
