// Calls Claude for the app's AI features (writing feedback, chat partner, IELTS grading).
// Only signed-in users whose email is in ALLOWED_EMAILS may use it, with a daily cap per user.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ALLOWED = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "40");
const EFFORT: Record<string, "low" | "medium" | "high"> = { quick: "low", default: "medium", complex: "high" };

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the function's secrets
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "bad_request" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ code: "not_signed_in" }, 401);
  if (!ALLOWED.includes((user.email ?? "").toLowerCase())) return json({ code: "not_granted" }, 403);

  const body = await req.json().catch(() => ({}));
  if (body.ping) return json({ allowed: true, ready: !!Deno.env.get("ANTHROPIC_API_KEY") });
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ code: "unavailable" }, 503);

  const messages = Array.isArray(body.input)
    ? body.input
    : [{ role: "user", content: String(body.input ?? "") }];
  if (!messages.length || JSON.stringify(messages).length > 60000) return json({ code: "bad_request" }, 400);

  const { data: left, error } = await admin.rpc("bump_ai_usage", { p_user: user.id, p_limit: DAILY_LIMIT });
  if (error) return json({ code: "upstream_error" }, 500);
  if (left < 0) return json({ code: "rate_limited", message: "daily limit reached" }, 429);

  try {
    const response = await anthropic.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: EFFORT[body.tier] ?? "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    } as any);
    if (response.stop_reason === "refusal") return json({ code: "refused" }, 422);
    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return json({ text, remaining: left });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ code: "rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ code: "upstream_error", status: e.status }, 502);
    return json({ code: "upstream_error" }, 502);
  }
});
