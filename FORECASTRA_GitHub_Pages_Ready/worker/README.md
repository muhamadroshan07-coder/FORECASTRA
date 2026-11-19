# FORECASTRA Cloudflare API Worker

This Worker is the private API layer for the static GitHub Pages frontend. It keeps provider API credentials on Cloudflare and exposes only the endpoints required by the app.

## Endpoints

- `GET /api/health` — reports service status and which integrations are configured (never returns credential values).
- `GET /api/config` — returns browser-safe Supabase URL/anon key and restricted Cesium token, plus configured-status flags for provider APIs.
- `GET /api/vc` — Visual Crossing historical weather proxy.
- `GET /api/groq-models` — available Groq models.
- `POST /api/ai` — FORECASTRA research assistant.
- `GET /api/weather/2?lat=<latitude>&lon=<longitude>` — WeatherAPI.com current conditions and forecast.
- `GET /api/weather/3?lat=<latitude>&lon=<longitude>` — OpenWeatherMap current conditions and five-day forecast.

## Required GitHub Actions secrets

Add these two repository secrets before the Worker can be deployed:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers Scripts Edit permission.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.

The deployment workflow is configured to sync provider secrets only when they are present. The following are optional until you enable each integration:

- `GROQ_API_KEY` — enables Research AI.
- `WEATHER_API_2_KEY` — a key issued by WeatherAPI.com.
- `WEATHER_API_3_KEY` — a key issued by OpenWeatherMap.
- `VISUAL_CROSSING_KEY` — enables historical weather queries.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` — enables Supabase authentication and private data storage. Use the anon/publishable key, never the service-role key.
- `CESIUM_ION_TOKEN` — restricted read-only token for the published GitHub Pages origin.

Open **GitHub → Settings → Secrets and variables → Actions → New repository secret**. Add each value there; never commit it to `docs/config.js` or any other public file.

The deployment workflow runs when files under `FORECASTRA_GitHub_Pages_Ready/worker/` change, or when you manually run **Deploy FORECASTRA API to Cloudflare Workers** under the Actions tab. After adding the secrets, manually run the workflow once.

## Weather provider defaults

The Worker expects these providers by default:

- Slot 2: `WEATHER_API_2_PROVIDER=weatherapi`
- Slot 3: `WEATHER_API_3_PROVIDER=openweathermap`

Only use API keys created by those exact services. Keys from other weather vendors will not work with these adapters without implementing that vendor's API endpoint first.

## After first deployment

Cloudflare assigns a Worker URL similar to:

`https://forecastra-api.<your-workers-subdomain>.workers.dev`

Open that URL with `/api/health` to check the service. Then put the exact Worker origin in `FORECASTRA_GitHub_Pages_Ready/docs/config.js` as `apiBaseUrl` and push the change. The frontend cannot reach Groq, Visual Crossing, or the additional weather adapters until this URL is configured.

## Supabase data tables

The schema file at `FORECASTRA_GitHub_Pages_Ready/supabase/schema.sql` creates:

- `saved_locations` — user-owned map locations.
- `research_conversations` and `research_messages` — saved Research AI history.
- `dataset_analyses` — uploaded file name, dimensions, and descriptive-statistics summary. Raw files are not uploaded.

Run the schema once in your Supabase project's SQL Editor after you authorize/connect the project. Row Level Security policies restrict rows to the signed-in user.

## Security notes

- Never commit `.env`, an API key, Cloudflare Access credentials, a Supabase service-role key, or a password.
- Supabase anon/publishable keys are intended for browser use but must always be paired with Row Level Security.
- CORS is not authentication. Add rate limits for `/api/ai` and `/api/vc` before a public release to reduce abuse and provider charges.
- Rotate any provider credentials previously pasted into chat or committed publicly.
