# BrightMind Worker

GCP Cloud Run service that runs the BrightMind question generation pipeline.

## Architecture
- Supabase Edge Function writes a job to `generation_jobs` table
- Edge Function triggers this worker via HTTP
- Worker runs 5-stage pipeline (Bank → Generate → Verify → Audit → Child Agent)
- Worker writes results back to `generation_jobs` table
- Client polls `job-status` Edge Function until complete

## Environment Variables (set in Cloud Run)
- `ANTHROPIC_API_KEY` — Anthropic API key for Claude
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key

## Deployment
Automated via GitHub → Cloud Run continuous deployment.
Push to `main` → Cloud Run builds and deploys automatically.
