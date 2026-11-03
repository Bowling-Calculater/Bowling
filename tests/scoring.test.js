import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreNight, scoreGame, checkRead, bowlerScore, averageFromHcp, paperText } from "../scoring.js";
import { validate } from "../supabase/functions/_shared/read-schema.js";

const KEY_PATH = process.env.ANSWER_KEY ?? new URL("../../2026-11-02-bowling-test/answer_key.json", import.meta.url);
const key = JSON.parse(readFileSync(KEY_PATH, "utf8"));

// Turn the answer key into the rows the site gets from Supabase (what a perfect Gemini read returns).
const toData = (l) => ({
  lane: l.lane, team_name: l.team,
  bowlers: l.bowlers.map((b, i) => ({ spot: i + 1, name: b.name, status: "bowled", scratch: b.scratch, hcp: b.hcp, hcp_game: b.hcp_score, unsure: false })),
  team_scratch: l.team_scratch, team_hcp: null, team_hcp_total: l.team_hcp_total, unsure_fields: [], notes: "",
});
let t = 0;
const rows = (order = ["3", "4"]) => key.games.flatMap((g) => order.map((ln) => ({
  id: `g${g.game}-l${ln}`, game_no: g.game, status: "done", discarded: false,
  created_at: `2026-11-03T0${g.game}:00:${String(t++ % 60).padStart(2, "0")}Z`, data: toData(g.lanes[ln]),
})));
const A = "Texas Strangers", B = "Mel's Marauders";

test("answer-key reads are valid against the Gemini JSON schema and raise no flags", () => {
  for (const r of rows()) {
    assert.deepEqual(validate(r.data), [], r.id);
    assert.deepEqual(checkRead(r.data).filter((f) => f.level !== "info"), [], r.id);
  }
});

for (const g of key.games) test(`game ${g.game} matches answer key`, () => {
  const n = scoreNight(rows(), { myTeam: A });
  const r = n.games[g.game].result;
  assert.deepEqual(n.sides.map((s) => s.name), [A, B]);
  assert.deepEqual(r.spots.map((s) => s.pts), g.individual_points);
  assert.deepEqual(r.teamPts, g.team_game_points);
  assert.deepEqual(r.teams, [g.lanes["3"].team_hcp_total, g.lanes["4"].team_hcp_total]);
  assert.deepEqual(r.pts, [g.points[A], g.points[B]]);
  assert.deepEqual(r.flags, []);
});

test("series and night total match answer key (11.5 - 23.5)", () => {
  const n = scoreNight(rows(), { myTeam: A });
  const s = n.series;
  assert.deepEqual(s.spots.map((x) => [x.a.game, x.b.game]), key.series.bowlers.map((b) => [b.lane3_series_hcp, b.lane4_series_hcp]));
  assert.deepEqual(s.spots.map((x) => x.pts), key.series.bowlers.map((b) => b.points));
  assert.deepEqual(s.teams, [key.series.team_series_hcp[A], key.series.team_series_hcp[B]]);
  assert.deepEqual(s.teamPts, key.series.team_series_points);
  assert.deepEqual(s.pts, [key.series.series_points[A], key.series.series_points[B]]);
  assert.deepEqual(n.totals, [11.5, 23.5]);
  assert.deepEqual(n.totals, [key.night_total[A], key.night_total[B]]);
  assert.equal(n.totals[0] + n.totals[1] + n.up, 35);
  assert.equal(n.up, 0);
  assert.match(paperText(n), /NIGHT Texas Strangers 11.5 - 23.5 Mel's Marauders/);
});

test("upload order and lane order don't matter; MY_TEAM goes left", () => {
  const n = scoreNight(rows(["4", "3"]).reverse(), { myTeam: B });
  assert.deepEqual(n.sides.map((s) => s.name), [B, A]);
  assert.deepEqual(n.totals, [23.5, 11.5]);
});

test("partial night: running total and points still up", () => {
  const n = scoreNight(rows().filter((r) => r.game_no === 1 || r.id === "g2-l3"), { myTeam: A });
  assert.deepEqual(n.totals, [4, 3]);
  assert.equal(n.up, 28);
  assert.equal(n.games[2].result, null);
  assert.equal(n.series, null);
});

test("newest photo of the same team/game wins; discarded and failed reads ignored", () => {
  const rs = rows();
  const fixed = structuredClone(rs.find((r) => r.id === "g3-l3"));
  fixed.id = "g3-l3-resnap"; fixed.created_at = "2026-11-03T09:00:00Z"; fixed.data.bowlers[3].hcp_game = 192; // Tanner 192 beats 191
  const bad = { ...fixed, id: "x", created_at: "2026-11-03T10:00:00Z", status: "error", data: null };
  const disc = { ...structuredClone(fixed), id: "y", created_at: "2026-11-03T11:00:00Z", discarded: true };
  disc.data.bowlers[3].hcp_game = 0;
  const n = scoreNight([...rs, fixed, bad, disc], { myTeam: A });
  assert.deepEqual(n.games[3].result.spots[3].pts, [1, 0]);
  assert.ok(n.notes.some((x) => /2 photos/.test(x)));
  assert.ok(n.readFlags["g3-l3-resnap"].some((f) => f.path === "bowlers.3.hcp_game"), "192 != 179+12 must be flagged");
});

test("fuzzy team-name match (OCR slip) still lands on the right side", () => {
  const rs = rows();
  rs.find((r) => r.id === "g2-l4").data.team_name = "Mels Marauder";
  assert.deepEqual(scoreNight(rs, { myTeam: A }).totals, [11.5, 23.5]);
});

test("inconsistent numbers are flagged on the exact cells", () => {
  const d = toData(key.games[0].lanes["3"]);
  d.bowlers[1].scratch = 197; // misread 179
  d.bowlers[2].unsure = true;
  d.unsure_fields = ["bowlers[4].hcp"];
  const paths = checkRead(d).map((f) => f.path);
  assert.ok(paths.includes("bowlers.1.hcp_game"));
  assert.ok(paths.includes("team_scratch"));
  assert.ok(paths.includes("bowlers.2.scratch"));
  assert.ok(paths.includes("bowlers.4.hcp"));
  d.team_hcp = 111;
  assert.ok(checkRead(d).some((f) => f.path === "team_hcp"));
  d.bowlers.pop();
  assert.ok(checkRead(d).some((f) => f.path === "bowlers"));
});

test("handicap change between games is flagged", () => {
  const rs = rows();
  rs.find((r) => r.id === "g2-l4").data.bowlers[0].hcp = 78;
  const n = scoreNight(rs, { myTeam: A });
  assert.ok(n.readFlags["g2-l4"].some((f) => f.path === "bowlers.0.hcp"));
});

test("ties split points", () => {
  const mk = (gs) => ({ bowlers: gs.map((g, i) => ({ spot: i + 1, name: "b" + i, status: "bowled", scratch: g, hcp: 0, hcp_game: g })) });
  const r = scoreGame(mk([200, 150]), mk([200, 160]));
  assert.deepEqual(r.spots.map((s) => s.pts), [[0.5, 0.5], [0, 1]]);
  assert.deepEqual(r.teamPts, [0, 2]);
  const t2 = scoreGame(mk([200, 160]), mk([160, 200]));
  assert.deepEqual(t2.teamPts, [1, 1]);
  assert.deepEqual(t2.pts, [2, 2]);
});

test("handicap -> average inversion (90% of 235)", () => {
  assert.equal(averageFromHcp(20), 212); // floor(0.9*23)=20
  assert.equal(averageFromHcp(77), 149);
  assert.equal(averageFromHcp(0), null);
});

test("vacancy = 100 scratch + 121 hcp and cannot win", () => {
  const v = bowlerScore({ name: "VACANT", status: "vacant", scratch: null, hcp: null, hcp_game: null });
  assert.equal(v.game, 221);
  const A = { bowlers: [{ name: "V", status: "vacant", scratch: null, hcp: null, hcp_game: null }] };
  // opponent avg 212 (hcp 20): 205 scratch is within 10 -> wins.
  // opponent avg 220 (hcp 13): 209 + 13 = 222 beats 221 but 209 is not within 10 of 220 -> no point
  const ok = scoreGame(A, { bowlers: [{ name: "x", status: "bowled", scratch: 205, hcp: 20, hcp_game: 225 }] });
  assert.deepEqual(ok.spots[0].pts, [0, 1]);
  const low = scoreGame(A, { bowlers: [{ name: "x", status: "bowled", scratch: 209, hcp: 13, hcp_game: 222 }] });
  assert.deepEqual(low.spots[0].pts, [0, 0]);
  assert.ok(low.flags.some((f) => /not within 10/.test(f)));
});

test("absentee: avg-10 (max 235) estimated from hcp when the screen is blank; blind can't win", () => {
  const ab = { name: "Scott", status: "absent", scratch: null, hcp: 20, hcp_game: null };
  const s = bowlerScore(ab);
  assert.equal(s.scratch, 202); assert.equal(s.game, 222);
  assert.ok(checkRead({ bowlers: [ab] }).some((f) => f.level === "unsure" && /estimated/.test(f.msg)));
  const r = scoreGame({ bowlers: [ab] }, { bowlers: [{ name: "Ann", status: "bowled", scratch: 140, hcp: 77, hcp_game: 217 }] });
  assert.deepEqual(r.spots[0].pts, [0, 0]); // blind 222 > 217 but blind can't win
  assert.equal(bowlerScore({ status: "absent", hcp: null }).game, null);
  // a high-average absentee is capped at 235 scratch: avg 250 has hcp 0 -> ambiguous -> null (flag)
});
