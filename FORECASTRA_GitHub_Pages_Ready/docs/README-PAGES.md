# FORECASTRA GitHub Pages frontend

This directory is the static website published by GitHub Pages. It includes the public browser interface only.

## Important
GitHub Pages does not execute `server.js` or provide Node.js API routes. Open-Meteo and RainViewer browser-side features can work directly, but Groq AI and Visual Crossing require a separately hosted backend.

Before enabling a backend, edit `config.js` and set `apiBaseUrl` to the backend origin. The backend must allow CORS from `https://muhamadroshan07-coder.github.io` and must keep private secrets in its own environment variables.

Only use a Supabase publishable/anon key with Row Level Security correctly configured. Use a read-only Cesium token restricted to this site domain. Never add Groq, Visual Crossing, Supabase service-role, or other private secrets here.
