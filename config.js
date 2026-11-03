// Public values only. The anon / publishable key is safe in browser code because
// RLS only allows reads; every write goes through the Edge Function (team code checked there).
// NEVER put the Gemini key or the service-role key here.
export const SUPABASE_URL = "https://jhqzromleqpwfvhstzlg.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_0a4Cv-JU4Ea8lI1h1eLA6Q_rgzp-w9G";
export const FUNCTION_NAME = "read-screen";
// Your team is shown in the left column. Matched loosely against the name on the lane screen.
export const MY_TEAM = "Texas Strangers";
