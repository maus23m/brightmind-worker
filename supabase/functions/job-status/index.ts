// BrightMind V2 — job-status
// Client polls this to check if generation is complete
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { jobId } = await req.json();
    if (!jobId)
      return new Response(JSON.stringify({ error: "Missing jobId" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey)
      return new Response(JSON.stringify({ error: "Server config error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

    const res = await fetch(
      `${url}/rest/v1/generation_jobs?id=eq.${jobId}&select=id,status,questions,error,source,bank_supplied,question_count`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) throw new Error(`Query failed: ${res.status}`);
    const rows = await res.json();
    if (!rows.length)
      return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const job = rows[0];

    if (job.status === "complete") {
      return new Response(
        JSON.stringify({
          status: "complete",
          questions: job.questions,
          source: job.source,
          count: job.questions?.length || 0,
          bankSupplied: job.bank_supplied || 0,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (job.status === "failed") {
      return new Response(
        JSON.stringify({ status: "failed", error: job.error || "Generation failed" }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ status: job.status }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("Error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});