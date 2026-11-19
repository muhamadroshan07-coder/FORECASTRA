# FORECASTRA Cloudflare API Worker

This Worker replaces the Node.js API proxy for the GitHub Pages frontend. It implements the endpoints already used by the browser application:

- `GET /api/health`
- `GET /api/config`
- `GET /api/vc`
- `GET /api/groq-models`
- `POST /api/ai`

## Deployment

The repository workflow `.github/workflows/deploy-forecastra-worker.yml` deploys this Worker on changes to this directory. Add these repository Actions secrets before running the workflow:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers Scripts Edit permission.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.
- `GROQ_API_KEY` — Groq API key.
- `VISUAL_CROSSING_KEY` — Visual Crossing API key.\n- `WEATHER_API_2_KEY` — additional weather provider key slot 2.\n- `WEATHER_API_3_KEY` — additional weather provider key slot 3.
- `SUPABASE_URL` — Supabase project URL.
- `SUPABASE_ANON_KEY` — Supabase anon/publishable key. Keep Row Level Security enabled.
- `CESIUM_ION_TOKEN` — restricted, read-only Cesium token for the GitHub Pages hostname.

The workflow sends provider values to Wrangler as Worker secrets. They are not written to source files. `CORS_ORIGIN` and `GROQ_MODEL` are non-secret Worker variables in `wrangler.jsonc`.

The two additional weather keys are stored as Worker secrets and their presence is shown in API Management. Provider-specific request adapters are not enabled until the provider names and API endpoint/documentation are identified.\n\n## After first deployment

Cloudflare will assign a URL similar to:

`https://forecastra-api.<your-workers-subdomain>.workers.dev`

Set that exact origin as `apiBaseUrl` in `../docs/config.js`. Then check `/api/health`.

## Security notes

- Never commit a `.env` file, API key, Cloudflare Access session, or service-role key.
- Do not create or store a generic "session ID token" for this app. Supabase Auth manages individual user sessions. A Cloudflare Access service token is only needed if you intentionally put the public frontend behind Access; this public GitHub Pages app does not require it.
- GitHub Actions deployment uses a Cloudflare API token. It is not a runtime API credential and must never be exposed to browser code.
- `/api/config` intentionally returns only the Supabase anon/publishable key and Cesium token to the browser. Restrict the Cesium token to `muhamadroshan07-coder.github.io`; enable Supabase Row Level Security on every exposed table.
- CORS only controls browser access; it is not authentication. Add a Cloudflare rate-limiting rule for `/api/ai` and `/api/vc` before public launch to reduce abuse and unexpected provider charges.
