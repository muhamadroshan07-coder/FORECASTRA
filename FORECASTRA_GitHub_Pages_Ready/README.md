# FORECASTRA — Environmental Intelligence
### Made by Quantum Minds

FORECASTRA is a browser-based environmental intelligence workspace. This rebuild uses a multi-page dashboard and a dark navy command-centre layout based on the supplied reference screenshot.

## Run locally on macOS, Windows or Linux

Requirements: Node.js 18 or newer. The server uses Node built-ins, so no extra server packages are required.

1. Extract the ZIP and open the `forecastra` folder in Terminal.
2. (Optional) initialise npm metadata with:

   ```bash
   npm install
   ```

3. Create your environment file:

   ```bash
   cp .env.example .env
   ```

4. Add the API keys you already use to `.env`. Do not put secret keys into `public/app.js` or commit `.env` to GitHub.
5. Start the app:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000` in Chrome or Edge.

## Navigation included

- **Operations:** Overview, Global Intelligence
- **Observation:** 3D Earth, Weather, Rainfall, Flood Intelligence, Cyclone Tracking
- **Analysis:** Climate Analytics, Disaster Monitoring, Historical Explorer
- **Research:** Research AI, Data Laboratory, Reports
- **System:** Notifications, API Management, Settings

Every item is a separate navigable workspace. The Global Intelligence page follows the reference dashboard composition: coordinate row, five summary cards, central Cesium globe, Hazard Snapshot and Coverage panels to the right, and Station Observations across the bottom.

## Features in this build

- CesiumJS interactive 3D globe with coordinate selection and location search
- Open-Meteo current conditions and forecast, location geocoding, elevation query and historical archive explorer
- Optional RainViewer radar layer
- Weather, rainfall, flood-screening, climate-summary and disaster-monitoring workspaces
- Research AI chat with a ChatGPT-style composer, microphone dictation and spoken Talk mode using browser speech APIs
- Groq chat API proxy with keys kept server-side
- CSV, Excel and JSON upload with descriptive statistics, numeric trend chart and dataset context for Research AI
- JSON and CSV report export plus print / Save as PDF
- Optional Supabase email authentication and saved locations
- API Management status panel, local Settings and responsive sidebar
- No Base44 editor badge or Base44 runtime dependency in this standalone project

## Environment variables

See `.env.example`:

- `GROQ_API_KEY` — enables Research AI
- `GROQ_MODEL` — default is `openai/gpt-oss-120b`; update it to a model listed in your Groq account if needed. If migrating an older `.env`, replace retired `llama-3.3-70b-versatile` with an active model such as `openai/gpt-oss-120b`.
- `VISUAL_CROSSING_KEY` — optional historical-weather service proxy
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` — optional sign-in and saved locations
- `CESIUM_ION_TOKEN` — optional Cesium ion access token; OSM imagery remains the fallback
- `PORT` — server port (default 3000)

If you use Supabase saved locations, run `supabase/schema.sql` in the Supabase SQL editor. The browser only receives the Supabase anon key; never put a service-role key in this project.

## Moving from the earlier FORECASTRA folder

The ZIP deliberately does not include a private `.env` file. Copy your own working values into the new `.env` file: `GROQ_API_KEY`, optional `VISUAL_CROSSING_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `CESIUM_ION_TOKEN`. Do not share the `.env` file or upload it to GitHub. Replace an old retired Groq model ID with the active default shown in `.env.example`.

## Voice mode

Use Chrome or Edge over `http://localhost` or HTTPS and grant microphone permission. The microphone button transcribes speech into the composer. Talk mode listens for a spoken question and reads the AI response aloud. Speech availability and voice quality depend on your browser and operating system.

## Important research limitations

- The Global Intelligence weather row is a selected Open-Meteo forecast-grid point, not a multi-station observation network.
- Hazard counts are basic screening indicators with simple visible cut-offs; they are not official alerts, calibrated probabilities or validated forecasts.
- Flood Intelligence is a rainfall-led baseline screening view. It does not yet include a validated Model B with drainage, land-use, road/pothole evidence or measured flood-depth targets. Model A vs Model B performance must be assessed against independent historical events before making accuracy claims.
- Cyclone Tracking provides the workspace and official-source links, but no live track feed is connected in this package. It deliberately does not invent cyclone paths or active-system counts.
- Climate Analytics summarizes the available forecast period. It is not a long-term climate-trend study.
- Earthquake, wildfire, satellite land-surface-temperature and official disaster-alert feeds are not connected in this rebuild.
- Live integrations were not tested with your private API credentials. API Management shows whether the required environment variables are configured.

## Publish the source on GitHub and deploy the live app

This project includes `server.js` and private API proxies, so it is a Node.js web service. **GitHub Pages cannot run this server.** Use GitHub to store the source code and Render to run the full application.

### 1. Push the project to GitHub

Create an empty GitHub repository named `forecastra` (do not add a README, license or `.gitignore`, because this folder already contains those files). In Terminal, open this project folder and run:

```bash
git init
git add .
git commit -m "Initial FORECASTRA release"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/forecastra.git
git push -u origin main
```

Replace `YOUR-GITHUB-USERNAME` with your GitHub username. Keep `.env` out of GitHub; `.gitignore` already excludes it. Never commit API keys, Supabase service-role keys, passwords, or other secrets.

### 2. Deploy from GitHub on Render

1. Sign in to Render and connect your GitHub account.
2. Choose **New → Blueprint** and select the `forecastra` repository. Render reads the included `render.yaml` file.
3. When prompted, enter your `GROQ_API_KEY` privately in Render. Do not put it in `render.yaml` or GitHub.
4. Create the service and wait for the first deploy to finish.
5. Open the generated `https://...onrender.com` URL. Check `https://...onrender.com/api/health` for the service status.
6. Add optional `VISUAL_CROSSING_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `CESIUM_ION_TOKEN` under the Render service's Environment settings when you need those integrations. Use only the Supabase anon/publishable key in this browser application, never the service-role key.

The Render free web-service plan sleeps after 15 minutes without incoming traffic and may take about a minute to wake when someone visits. Its local filesystem is temporary, so use Supabase or another persistent data service for saved information. This free tier is intended for testing and hobby projects, not critical production use.

### 3. Update the live site

After connecting the repository, push later code changes to the `main` branch. Render automatically redeploys when a new commit is pushed.


## Publish the static interface with GitHub Pages

This repository includes a `docs/` folder and `.github/workflows/pages.yml`. Create a **public** repository named `FORECASTRA`, push this whole folder to the `main` branch, then open **Settings → Pages** and select **GitHub Actions** as the build and deployment source. The workflow publishes `docs/` automatically.

The project URL will be `https://muhamadroshan07-coder.github.io/FORECASTRA/` once the workflow succeeds.

### GitHub Pages limitation
GitHub Pages only hosts static files. It does not run `server.js`, `/api/ai`, `/api/vc`, or `/api/config`. The site can load browser-side weather feeds, but Groq AI and Visual Crossing remain unavailable until you deploy the Node.js backend separately. Set `apiBaseUrl` in `docs/config.js` to the backend origin after deployment. The Node.js server now supports a `CORS_ORIGIN` environment variable; set it to `https://muhamadroshan07-coder.github.io` (or an explicit comma-separated allowlist) on the backend host. Keep all private API keys in the backend host's environment variables.

### Push commands

```bash
git init
git add .
git commit -m "Publish FORECASTRA source and Pages frontend"
git branch -M main
git remote add origin https://github.com/muhamadroshan07-coder/FORECASTRA.git
git push -u origin main
```
