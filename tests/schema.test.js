import { test } from "node:test";
import assert from "node:assert/strict";
import { READ_SCHEMA, READ_PROMPT, validate } from "../supabase/functions/_shared/read-schema.js";

// Keywords Gemini's responseJsonSchema documents as supported. Anything else risks a 400 or being ignored.
const ALLOWED = new Set(["type", "properties", "required", "items", "enum", "minimum", "maximum", "minItems", "maxItems", "description", "additionalProperties"]);
function walk(s, path = "$") {
  for (const k of Object.keys(s)) assert.ok(ALLOWED.has(k), `${path}: unsupported keyword ${k}`);
  for (const t of [].concat(s.type)) assert.ok(["object", "array", "string", "integer", "number", "boolean", "null"].includes(t), `${path}: bad type ${t}`);
  if (s.type === "object") for (const r of s.required ?? []) assert.ok(s.properties[r], `${path}: required ${r} not in properties`);
  for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${path}.${k}`);
  if (s.items) walk(s.items, `${path}[]`);
}

test("schema only uses Gemini-supported JSON Schema keywords and is self-consistent", () => {
  walk(READ_SCHEMA);
  assert.ok(JSON.stringify(READ_SCHEMA).length < 8000);
  assert.match(READ_PROMPT, /never compute/i);
});

const good = { lane: 3, team_name: "T", bowlers: [{ spot: 1, name: "A", status: "bowled", scratch: 201, hcp: 20, hcp_game: 221, unsure: false }], team_scratch: 201, team_hcp: null, team_hcp_total: 221, unsure_fields: [], notes: "" };

test("validator accepts a good read (nulls allowed for unreadable numbers)", () => {
  assert.deepEqual(validate(good), []);
  const n = structuredClone(good); n.bowlers[0].scratch = null; n.lane = null;
  assert.deepEqual(validate(n), []);
});

test("validator rejects malformed model output", () => {
  const cases = [
    [(d) => delete d.team_name, /missing team_name/],
    [(d) => (d.bowlers[0].scratch = "201"), /expected integer\|null, got string/],
    [(d) => (d.bowlers[0].scratch = 301), /> 300/],
    [(d) => (d.bowlers[0].hcp_game = 221.5), /got number/],
    [(d) => (d.bowlers[0].status = "blind"), /not in/],
    [(d) => (d.extra = 1), /unexpected extra/],
    [(d) => (d.bowlers = []), /fewer than 1/],
  ];
  for (const [mut, re] of cases) { const d = structuredClone(good); mut(d); assert.match(validate(d).join("\n"), re); }
});
