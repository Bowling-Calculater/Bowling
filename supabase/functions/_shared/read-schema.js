// JSON Schema for one lane-screen read. Sent to Gemini as generationConfig.responseJsonSchema,
// and used to validate every model reply and every manual fix. Plain JS so Deno and Node share it.
const int = (description, min, max) => ({ type: ["integer", "null"], minimum: min, maximum: max, description });

export const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lane: int("Lane number shown on the screen (big number at top / first header cell), null if not visible", 1, 99),
    team_name: { type: "string", description: "Team name in the team-total row under the bowlers" },
    bowlers: {
      type: "array", minItems: 1, maxItems: 6,
      description: "Bowler rows top to bottom = lineup order",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          spot: { type: "integer", minimum: 1, maximum: 6, description: "Row number, 1 = top" },
          name: { type: "string", description: "Bowler name exactly as shown (join two-line names with a space)" },
          status: { type: "string", enum: ["bowled", "absent", "vacant"], description: "absent if the row is marked blind/absent/ABS, vacant if VACANT/VAC" },
          scratch: int("Scratch game = cumulative score under the 10th frame", 0, 300),
          hcp: int("Small handicap number in the corner of the last (handicap) column", 0, 235),
          hcp_game: int("Big number in the last column (often headed 1/3, 2/3, 3/3) = scratch + handicap", 0, 600),
          unsure: { type: "boolean", description: "true if any number in this row was hard to read" },
        },
        required: ["spot", "name", "status", "scratch", "hcp", "hcp_game", "unsure"],
      },
    },
    team_scratch: int("Team row, 10th-frame column: team scratch total", 0, 1800),
    team_hcp: int("Team handicap total if shown anywhere, else null", 0, 1500),
    team_hcp_total: int("Team row, last column: team handicap game total", 0, 3600),
    unsure_fields: { type: "array", items: { type: "string" }, description: "Paths of hard-to-read numbers, e.g. bowlers[2].scratch or team_scratch" },
    notes: { type: "string", description: "Anything odd: glare, pop-up covering cells, cut-off rows. Empty string if none" },
  },
  required: ["lane", "team_name", "bowlers", "team_scratch", "team_hcp", "team_hcp_total", "unsure_fields", "notes"],
};

export const READ_PROMPT = `You are reading a photo of a bowling-alley lane TV scoreboard (one team, one game).
Layout: a header row with the lane number then frame numbers 1-10 then a last column (labelled like "1/3").
One row per bowler, top to bottom in lineup order. Each frame cell has marks (X, /, -, digits) on top and a
running total below. The running total under frame 10 is the bowler's SCRATCH game. The last column has a
small number in its top-right corner (the HANDICAP) and a big number (the HANDICAP GAME = scratch + handicap).
Below the bowlers is a team row: team name on the left, then team scratch through frame 9, team scratch
(under frame 10), and team handicap game total (last column). There may be a pop-up covering some frames;
only the 10th-frame and last-column numbers matter.
Rules:
- Copy numbers exactly as displayed; never compute or "fix" a number to make totals add up.
- If a number is hidden, cut off, or unreadable, use null and list its path in unsure_fields.
- Mark a bowler's row unsure=true if any of its three numbers was hard to read (glare, blur, angle).
- Names: join two-line names with a single space. Ignore speed readouts like "13.3 mph".
- team_hcp is usually not shown; return null unless a team handicap number is explicitly displayed.
- Return only JSON matching the schema.`;

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

// Minimal validator for exactly the keywords used above. Returns [] when valid, else error strings.
export function validate(value, schema = READ_SCHEMA, path = "$") {
  const errs = [], types = [].concat(schema.type ?? []), t = typeOf(value);
  if (types.length && !types.includes(t) && !(t === "integer" && types.includes("number"))) return [`${path}: expected ${types.join("|")}, got ${t}`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in ${schema.enum.join(",")}`);
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: ${value} < ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errs.push(`${path}: ${value} > ${schema.maximum}`);
  }
  if (t === "array") {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)));
  }
  if (t === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errs.push(...validate(v, schema.properties[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected ${k}`);
    }
  }
  return errs;
}
