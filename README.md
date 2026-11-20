# FORECASTRA — Quantum Minds

Environmental intelligence dashboard built by Quantum Minds.

## Hosting and architecture

- **GitHub Pages** publishes the static website from the `FORECASTRA_GitHub_Pages_Ready/docs/` directory.
- **Supabase** provides authentication and the server-side Edge Function used by Research AI.
- **Groq** powers Research AI. Its API key must be stored only as a Supabase Edge Function secret named `GROQ_API_KEY`.
- **Open-Meteo** provides browser-accessible forecast, geocoding, elevation and historical archive data.

Cloudflare is not used by this deployment. GitHub Pages remains the frontend host; Supabase Edge Functions handle private AI requests.

## Supabase setup

The deployed site reads its browser-safe Supabase project URL and publishable key from:

`FORECASTRA_GitHub_Pages_Ready/docs/config.js`

The Research AI function is named `forecastra-ai` and is deployed to the connected Supabase project. Research AI is publicly accessible without account sign-in. The Edge Function keeps the Groq key server-side and applies request limits.

In the Supabase Dashboard, open **Edge Functions → Secrets** and add:

- Name: `GROQ_API_KEY`
- Value: your newly generated Groq API key

Never commit Groq keys, Supabase secret keys, service-role keys, passwords, or `.env` files to GitHub. If a key has been pasted into a chat or public source, revoke it and generate a replacement before using it.

## GitHub Pages deployment

The static dashboard is published from the `docs/` directory using the repository's GitHub Pages workflow.

After the workflow succeeds, the site is available at:

https://muhamadroshan07-coder.github.io/FORECASTRA/

## Current limitations

- GitHub Pages serves static assets; it does not run private backend code.
- Research AI is served by the Supabase Edge Function, not by GitHub Pages.
- Optional secondary weather-provider proxies and Visual Crossing history are not connected in the GitHub + Supabase deployment.
- Supabase Row Level Security policies must be configured correctly for any exposed user-data tables.

Never place private provider credentials in `docs/config.js` or any browser JavaScript file.
