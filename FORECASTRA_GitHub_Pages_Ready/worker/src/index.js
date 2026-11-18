const ALLOWED_ORIGINS = (env) => String(env.CORS_ORIGIN || "https://muhamadroshan07-coder.github.io")
  .split(",").map((value) => value.trim()).filter(Boolean);

function responseHeaders(request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS(env).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(request, env) });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function readLimitedJSON(request, maxBytes = 96 * 1024) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) throw new Error("Request body is too large.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) throw new Error("Request body is too large.");
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("Invalid JSON request."); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      const headers = responseHeaders(request, env);
      return new Response(null, { status: 204, headers });
    }

    if (method === "GET" && url.pathname === "/api/health") {
      return json(request, env, {
        service: "FORECASTRA",
        version: "2.1.0",
        status: "online",
        runtime: "cloudflare-workers",
        configured: {
          groq: Boolean(env.GROQ_API_KEY),
          visualCrossing: Boolean(env.VISUAL_CROSSING_KEY),
          supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
          cesiumIon: Boolean(env.CESIUM_ION_TOKEN)
        }
      });
    }

    if (method === "GET" && url.pathname === "/api/config") {
      // These are browser-facing values only. Supabase must have RLS enabled;
      // the Cesium token must be restricted to the GitHub Pages origin.
      return json(request, env, {
        supabaseUrl: env.SUPABASE_URL || "",
        supabaseAnonKey: env.SUPABASE_ANON_KEY || "",
        cesiumToken: env.CESIUM_ION_TOKEN || "",
        groqConfigured: Boolean(env.GROQ_API_KEY),
        groqModel: env.GROQ_MODEL || "openai/gpt-oss-120b",
        visualCrossingConfigured: Boolean(env.VISUAL_CROSSING_KEY)
      });
    }

    if (method === "GET" && url.pathname === "/api/vc") {
      if (!env.VISUAL_CROSSING_KEY) {
        return json(request, env, { error: "Visual Crossing is not configured. Add VISUAL_CROSSING_KEY as a Worker secret." }, 503);
      }
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return json(request, env, { error: "Valid latitude and longitude are required." }, 400);
      }
      const start = String(url.searchParams.get("start") || "last30days");
      const end = String(url.searchParams.get("end") || "");
      if (!(start === "last30days" || validDate(start)) || (end && !validDate(end))) {
        return json(request, env, { error: "Use start=last30days or a YYYY-MM-DD date, and an optional YYYY-MM-DD end date." }, 400);
      }
      const path = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${start}${end ? `/${end}` : ""}`;
      const upstreamUrl = new URL(path);
      upstreamUrl.search = new URLSearchParams({
        unitGroup: "metric",
        include: "days,current",
        elements: "datetime,tempmax,tempmin,temp,precip,precipprob,windspeed,winddir,conditions",
        contentType: "json",
        key: env.VISUAL_CROSSING_KEY
      }).toString();
      try {
        const upstream = await fetch(upstreamUrl.toString(), { headers: { "User-Agent": "FORECASTRA-QuantumMinds/2.1" } });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          return json(request, env, { error: data.message || `Visual Crossing returned HTTP ${upstream.status}.` }, 502);
        }
        return json(request, env, data);
      } catch {
        return json(request, env, { error: "Visual Crossing could not be reached. Try again shortly." }, 502);
      }
    }

    if (method === "GET" && url.pathname === "/api/groq-models") {
      if (!env.GROQ_API_KEY) return json(request, env, { error: "GROQ_API_KEY is not configured." }, 503);
      try {
        const upstream = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }
        });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) return json(request, env, { error: data.error?.message || `Groq returned HTTP ${upstream.status}.` }, 502);
        return json(request, env, {
          models: (data.data || []).filter((model) => model.active !== false).map((model) => ({
            id: model.id, owned_by: model.owned_by
          }))
        });
      } catch {
        return json(request, env, { error: "Groq could not be reached. Try again shortly." }, 502);
      }
    }

    if (method === "POST" && url.pathname === "/api/ai") {
      if (!env.GROQ_API_KEY) return json(request, env, { error: "FORECASTRA AI is not configured yet." }, 503);
      let body;
      try { body = await readLimitedJSON(request); }
      catch (error) { return json(request, env, { error: error.message }, error.message.includes("too large") ? 413 : 400); }

      const question = String(body?.question || "").trim();
      if (!question) return json(request, env, { error: "Enter a question first." }, 400);
      if (question.length > 12000) return json(request, env, { error: "That message is too long. Please shorten it." }, 413);

      const context = body?.context && typeof body.context === "object" ? body.context : {};
      const system = [
        "You are FORECASTRA AI, an environmental data and research assistant created by Quantum Minds.",
        "Be clear, analytical and helpful. Explain weather, rainfall, climate datasets, flood-screening indicators and uploaded tabular data.",
        "Use only the supplied environmental context for claims about current conditions. Never invent observations, station measurements, official alerts, cyclone tracks, or model accuracy.",
        "Always distinguish observed values, forecasts, historical values and estimates.",
        "A hazard score is a screening heuristic, not a calibrated probability or validated warning. Explain data gaps and uncertainty.",
        "For emergencies, advise checking official government meteorological and disaster-management agencies. Do not present this app as an emergency-alert authority."
      ].join(" ");

      const model = env.GROQ_MODEL || "openai/gpt-oss-120b";
      try {
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_completion_tokens: 1400,
            messages: [
              { role: "system", content: system },
              { role: "user", content: `ENVIRONMENTAL CONTEXT (may be incomplete):\n${JSON.stringify(context).slice(0, 18000)}\n\nQUESTION:\n${question}` }
            ]
          })
        });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) return json(request, env, { error: data.error?.message || `Groq returned HTTP ${upstream.status}.` }, 502);
        return json(request, env, {
          answer: data.choices?.[0]?.message?.content || "I could not produce a response. Please try again.",
          model
        });
      } catch {
        return json(request, env, { error: "Groq could not be reached. Try again shortly." }, 502);
      }
    }

    if (!url.pathname.startsWith("/api/")) {
      return json(request, env, { service: "FORECASTRA API", status: "online", docs: "Use /api/health for status." });
    }
    return json(request, env, { error: "API endpoint not found." }, 404);
  }
};
