# FORECASTRA — Quantum Minds

Environmental intelligence dashboard built by Quantum Minds.

## GitHub Pages deployment

The static dashboard is published from the `docs/` directory using GitHub Actions.

After the first push, open **Settings → Pages** and select **GitHub Actions** as the deployment source.

## Important architecture note

GitHub Pages serves static frontend assets only. It cannot run the Node.js backend or private API proxy routes. To enable Groq AI and Visual Crossing, deploy `server.js` to a separate Node.js host and set `apiBaseUrl` in `docs/config.js` to that backend origin.

Never commit `.env`, API secrets, Supabase service-role keys, or private tokens. Use backend environment variables for private credentials.