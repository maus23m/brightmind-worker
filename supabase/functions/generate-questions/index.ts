// BrightMind V2 — generate-questions (async dispatcher)
// Writes job to generation_jobs table, returns job ID immediately.
// GCP Cloud Function picks up the job and runs the full pipeline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { subject, year, topics, difficulty, count, previousIds = [], childId = null, subtopics = null } = await req.json();
    if (!subject || !year || !topics?.length || !difficulty || !count)
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    // Extract parent ID from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let parentId: string | null = null;

    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        parentId = payload.sub || null;
      } catch (e) {}
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey)
      return new Response(JSON.stringify({ error: "Server config error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    const jobData = {
      subject,
      year_group: year,
      topics,
      difficulty,
      question_count: count,
      child_id: childId || null,
      parent_id: parentId,
      previous_ids: previousIds,
      subtopics: subtopics || null,
      status: "pending",
    };

    const insertRes = await fetch(`${url}/rest/v1/generation_jobs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(jobData),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      throw new Error(`Job insert failed: ${err}`);
    }

    const [job] = await insertRes.json();

    // Trigger GCP Cloud Function
    const gcpUrl = Deno.env.get("GCP_WORKER_URL");
    if (gcpUrl) {
      fetch(gcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      }).catch((e) => console.error("GCP trigger failed:", e.message));
    }

    return new Response(
      JSON.stringify({ jobId: job.id, status: "pending" }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("Error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
