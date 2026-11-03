// Completeness check: bundled season.js vs leaguepals/season.json (+ rendered Season Stats via stdin JSON if given).
import fs from "fs";
import { SEASON } from "../season.js";
const src = JSON.parse(fs.readFileSync(new URL("../leaguepals/season.json", import.meta.url)));
const bad = []; const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${what}: site ${JSON.stringify(a)} vs source ${JSON.stringify(b)}`); };
eq(SEASON.weeks.length, src.weeks.length, "week count");
let rows = 0;
for (const w of src.weeks) {
  const s = SEASON.weeks.find((x) => x.week === w.week); if (!s) { bad.push(`week ${w.week} missing`); continue; }
  eq(s.opponent, w.opponent, `W${w.week} opponent`); eq(s.points, [w.our_points, w.opp_points], `W${w.week} points`);
  eq(s.ours, [w.ours.g1, w.ours.g2, w.ours.g3, w.ours.series], `W${w.week} our games/series`);
  eq(s.opp, [w.opp.g1, w.opp.g2, w.opp.g3, w.opp.series], `W${w.week} opp games/series`);
  const srcRows = src.bowlers.texas_by_week[String(w.week)];
  eq(s.bowlers.length, srcRows.length, `W${w.week} bowler rows`);
  for (const r of srcRows) {
    const b = s.bowlers.find((x) => x.name === r.bowler); if (!b) { bad.push(`W${w.week} ${r.bowler} missing`); continue; }
    rows++; eq([b.avg, ...b.games, b.hcp], [r.avg, r.g1, r.g2, r.g3, r.hdcp_per_game], `W${w.week} ${r.bowler}`);
  }
}
const names = ["Scott Hertzog", "Paul Black", "Nick Hertzog", "Tanner Hertzog", "Joseph Wickens", "Ryan Belz", "Albert Wininger"];
for (const n of names) if (!SEASON.roster.some((r) => r.name === n)) bad.push(`roster missing ${n}`);
const srcRowCount = Object.values(src.bowlers.texas_by_week).reduce((t, r) => t + r.length, 0);
let statsChecked = 0;
if (process.argv[2]) {
  const shown = JSON.parse(fs.readFileSync(process.argv[2])); // {name:[games,avg,hg,hs,hgH,hsH]}
  for (const r of src.bowlers.texas_season) {
    const v = shown[r.bowler]; if (!v) { bad.push(`stats missing ${r.bowler}`); continue; }
    statsChecked++; eq(v, [r.total_games, r.avg, r.high_game, r.high_series, r.high_game_hdcp, r.high_series_hdcp], `Season Stats ${r.bowler}`);
  }
  eq(shown.__team, [`${src.standings_after_week10.ytd_wins}–${src.standings_after_week10.ytd_loss}`, `${src.standings_after_week10.position}th`], "Season Stats points/standing");
}
console.log(`weeks ${SEASON.weeks.length}/${src.weeks.length} · bowlers ${SEASON.roster.length}/${src.bowlers.texas_season.length} · bowler-week rows ${rows}/${srcRowCount} · stats rows checked ${statsChecked}`);
console.log(bad.length ? "MISMATCHES:\n" + bad.join("\n") : "No mismatches.");
console.log("opponent bowler names in site data:", ["Kevin Malan", "Jonathan Silva", "Derrick Williams"].filter((n) => fs.readFileSync(new URL("../season.js", import.meta.url), "utf8").includes(n)).length);
