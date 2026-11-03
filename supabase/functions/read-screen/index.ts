// Edge Function: read-screen
// POST multipart {code, night_date, game, photo}      -> store photo, read it with Gemini, save row
// POST json {action:"check", code}                    -> {ok:true} if team code is right
// POST json {action:"fix", code, read_id, path, value} -> manual correction of one number/field
// POST json {action:"discard"|"retry", code, read_id}  -> hide a bad photo / re-read it
// Secrets: GEMINI_API_KEY and TEAM_CODE from function env (supabase secrets set) or, if unset, from Supabase Vault
// (names gemini_api_key / team_code) via public.get_app_secret(), executable by service_role only. Optional GEMINI_MODEL.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { READ_PROMPT, READ_SCHEMA, validate } from "../_shared/read-schema.js";

const BUCKET = "screens";
const MAX_BYTES = 10 * 1024 * 1024;
// gemini-2.5-flash now 404s for new keys; gemini-3.6-flash read all 6 test screens perfectly (Nov 2026).
// Next model in the list is used if one is retired (404) or overloaded (503).
const MODELS = [...new Set([Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"])];
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const secretCache: Record<string, string> = {};
async function secret(envName: string, vaultName: string): Promise<string> {
  const env = Deno.env.get(envName);
  if (env) return env;
  if (secretCache[vaultName]) return secretCache[vaultName];
  const { data, error } = await db.rpc("get_app_secret", { secret_name: vaultName });
  if (error || !data) throw new Error(`secret ${vaultName} not configured`);
  return (secretCache[vaultName] = String(data));
}

async function codeOk(given: unknown): Promise<boolean> {
  const want = await secret("TEAM_CODE", "team_code");
  const a = new TextEncoder().encode(String(given ?? "").trim()), b = new TextEncoder().encode(want);
  if (!want || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function callGemini(model: string, img: Uint8Array, mime: string, extra = "") {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": await secret("GEMINI_API_KEY", "gemini_api_key") },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: encodeBase64(img) } }, { text: READ_PROMPT + extra }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: READ_SCHEMA },
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  const out = await res.json();
  const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  return JSON.parse(text);
}

// Read the image; on schema failure retry once with the errors appended; on 404/503 move to the next model.
async function readScreen(img: Uint8Array, mime: string) {
  let mi = 0, extra = "", schemaTries = 0, busyTries = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const model = MODELS[mi];
    try {
      const data = await callGemini(model, img, mime, extra);
      const errs = validate(data);
      if (!errs.length) return { data, model };
      if (++schemaTries >= 2) throw new Error("Invalid JSON from model: " + errs.slice(0, 3).join("; "));
      extra = `\nYour previous answer failed validation: ${errs.slice(0, 5).join("; ")}. Fix it.`;
    } catch (e) {
      const st = (e as { status?: number }).status;
      if ((st === 404 || st === 503) && mi < MODELS.length - 1) { mi++; continue; }
      if (st === 429 || (st && st >= 500)) {
        if (++busyTries >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2000 * busyTries));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Gemini read failed after retries");
}

async function runRead(id: string, path: string, mime: string, img?: Uint8Array) {
  try {
    if (!img) {
      const { data: blob, error } = await db.storage.from(BUCKET).download(path);
      if (error) throw error;
      img = new Uint8Array(await blob.arrayBuffer());
    }
    const { data, model } = await readScreen(img, mime);
    await db.from("reads").update({ status: "done", data, model_data: data, model, error: null, updated_at: new Date().toISOString() }).eq("id", id);
    return { id, status: "done", data };
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 500);
    await db.from("reads").update({ status: "error", error, updated_at: new Date().toISOString() }).eq("id", id);
    return { id, status: "error", error };
  }
}

async function upload(form: FormData) {
  const night = String(form.get("night_date") ?? ""), game = Number(form.get("game"));
  const photo = form.get("photo");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return json({ error: "bad night_date" }, 400);
  if (![1, 2, 3].includes(game)) return json({ error: "game must be 1, 2 or 3" }, 400);
  if (!(photo instanceof File) || !photo.type.startsWith("image/")) return json({ error: "photo must be an image" }, 400);
  if (photo.size > MAX_BYTES) return json({ error: "photo over 10 MB" }, 413);

  await db.from("nights").upsert({ night_date: night }, { onConflict: "night_date", ignoreDuplicates: true });
  const { data: g, error: ge } = await db.from("games").upsert({ night_date: night, game_no: game }, { onConflict: "night_date,game_no" }).select("id").single();
  if (ge) return json({ error: ge.message }, 500);

  const img = new Uint8Array(await photo.arrayBuffer());
  const ext = photo.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const path = `${night}/g${game}/${crypto.randomUUID()}.${ext}`;
  const { error: se } = await db.storage.from(BUCKET).upload(path, img, { contentType: photo.type });
  if (se) return json({ error: se.message }, 500);

  // Insert first so every phone sees "reading..." right away via Realtime.
  const { data: row, error: re } = await db.from("reads").insert({ game_id: g.id, night_date: night, game_no: game, photo_path: path }).select("id").single();
  if (re) return json({ error: re.message }, 500);
  return json(await runRead(row.id, path, photo.type, img));
}

// path like "team_name", "team_scratch", "bowlers.2.hcp_game", "bowlers.2.status"
async function fix(body: { read_id?: string; path?: string; value?: unknown }) {
  const { data: row, error } = await db.from("reads").select("data, edits").eq("id", body.read_id).single();
  if (error || !row?.data) return json({ error: "read not found" }, 404);
  const keys = String(body.path ?? "").split(".");
  if (!keys[0] || keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return json({ error: "bad path" }, 400);
  const data = structuredClone(row.data);
  let obj = data;
  for (const k of keys.slice(0, -1)) { obj = obj?.[k]; if (obj == null || typeof obj !== "object") return json({ error: "bad path" }, 400); }
  const last = keys.at(-1)!, from = obj[last];
  if (!(last in obj)) return json({ error: "bad path" }, 400);
  obj[last] = body.value;
  if (keys[0] === "bowlers" && last !== "unsure") obj.unsure = false; // a human checked this row
  data.unsure_fields = (data.unsure_fields ?? []).filter((p: string) => p.replace(/\[(\d+)\]/g, ".$1") !== body.path);
  const errs = validate(data);
  if (errs.length) return json({ error: "invalid value: " + errs[0] }, 400);
  const edits = [...(row.edits ?? []), { at: new Date().toISOString(), path: body.path, from, to: body.value }];
  const { error: ue } = await db.from("reads").update({ data, edits, updated_at: new Date().toISOString() }).eq("id", body.read_id);
  return ue ? json({ error: ue.message }, 500) : json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      if (!(await codeOk(form.get("code")))) return json({ error: "wrong team code" }, 401);
      return await upload(form);
    }
    const body = await req.json();
    if (!(await codeOk(body.code))) return json({ error: "wrong team code" }, 401);
    switch (body.action) {
      case "check": return json({ ok: true });
      case "fix": return await fix(body);
      case "discard": {
        const { error } = await db.from("reads").update({ discarded: !!(body.discarded ?? true), updated_at: new Date().toISOString() }).eq("id", body.read_id);
        return error ? json({ error: error.message }, 500) : json({ ok: true });
      }
      case "retry": {
        const { data: r } = await db.from("reads").select("photo_path").eq("id", body.read_id).single();
        if (!r) return json({ error: "read not found" }, 404);
        await db.from("reads").update({ status: "reading", error: null }).eq("id", body.read_id);
        const ext = r.photo_path.split(".").pop();
        return json(await runRead(body.read_id, r.photo_path, ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"));
      }
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
