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
          cesiumIon: Boolean(env.CESIUM_ION_TOKEN),
          weatherApi2: Boolean(env.WEATHER_API_2_KEY),
          weatherApi3: Boolean(env.WEATHER_API_3_KEY),
          weatherApi2Provider: env.WEATHER_API_2_PROVIDER || "weatherapi",
          weatherApi3Provider: env.WEATHER_API_3_PROVIDER || "openweathermap"
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
        visualCrossingConfigured: Boolean(env.VISUAL_CROSSING_KEY),
        weatherApi2Configured: Boolean(env.WEATHER_API_2_KEY),
        weatherApi3Configured: Boolean(env.WEATHER_API_3_KEY),
        weatherApi2Provider: env.WEATHER_API_2_PROVIDER || "weatherapi",
        weatherApi3Provider: env.WEATHER_API_3_PROVIDER || "openweathermap"
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

    if (method === "GET" && (url.pathname === "/api/weather/2" || url.pathname === "/api/weather/3")) {
      const slot = url.pathname.endsWith("/2") ? "2" : "3";
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return json(request, env, { error: "Valid latitude and longitude are required." }, 400);
      }

      if (slot === "2") {
        if (!env.WEATHER_API_2_KEY) return json(request, env, { error: "Weather API 2 is not configured." }, 503);
        const provider = String(env.WEATHER_API_2_PROVIDER || "weatherapi").toLowerCase();
        if (provider !== "weatherapi") return json(request, env, { error: "Weather API 2 provider is unsupported. Set WEATHER_API_2_PROVIDER=weatherapi." }, 501);
        const upstreamUrl = new URL("https://api.weatherapi.com/v1/forecast.json");
        upstreamUrl.search = new URLSearchParams({
          key: env.WEATHER_API_2_KEY,
          q: `${lat},${lon}`,
          days: "7",
          aqi: "no",
          alerts: "yes"
        }).toString();
        try {
          const upstream = await fetch(upstreamUrl.toString());
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) return json(request, env, { error: data.error?.message || `Weather API 2 returned HTTP ${upstream.status}.` }, 502);
          return json(request, env, {
            provider: "WeatherAPI.com",
            location: data.location || null,
            current: data.current || null,
            forecast: data.forecast || null,
            alerts: data.alerts || null
          });
        } catch {
          return json(request, env, { error: "Weather API 2 could not be reached." }, 502);
        }
      }

      if (!env.WEATHER_API_3_KEY) return json(request, env, { error: "Weather API 3 is not configured." }, 503);
      const provider = String(env.WEATHER_API_3_PROVIDER || "openweathermap").toLowerCase();
      if (provider !== "openweathermap") return json(request, env, { error: "Weather API 3 provider is unsupported. Set WEATHER_API_3_PROVIDER=openweathermap." }, 501);
      const currentUrl = new URL("https://api.openweathermap.org/data/2.5/weather");
      currentUrl.search = new URLSearchParams({ lat: String(lat), lon: String(lon), appid: env.WEATHER_API_3_KEY, units: "metric" }).toString();
      const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
      forecastUrl.search = currentUrl.search;
      try {
        const [currentResponse, forecastResponse] = await Promise.all([fetch(currentUrl), fetch(forecastUrl)]);
        const [current, forecast] = await Promise.all([
          currentResponse.json().catch(() => ({})),
          forecastResponse.json().catch(() => ({}))
        ]);
        if (!currentResponse.ok) return json(request, env, { error: current.message || `Weather API 3 returned HTTP ${currentResponse.status}.` }, 502);
        if (!forecastResponse.ok) return json(request, env, { error: forecast.message || `Weather API 3 forecast returned HTTP ${forecastResponse.status}.` }, 502);
        return json(request, env, { provider: "OpenWeatherMap", current, forecast });
      } catch {
        return json(request, env, { error: "Weather API 3 could not be reached." }, 502);
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
        "You are FORECASTRA AI, a rigorous environmental intelligence analyst and research assistant created by Quantum Minds.",
        "Specialise in weather interpretation, climate trend analysis, rainfall and flood-screening research, historical records, scientific writing and uploaded tabular-data analysis.",
        "Use the supplied selected location, current weather, forecast, historical records and dataset summary. If a value is absent, say it is unavailable rather than guessing.",
        "Label every datum as current/observed, forecast, historical/reanalysis or estimate. Include units and date ranges. Never invent stations, measurements, official alerts, cyclone tracks, sources or model skill.",
        "Calculate useful totals, averages, ranges, changes, anomalies and comparisons from supplied values when possible. Briefly explain the method and identify missing values and sample-size limitations.",
        "For substantial answers, provide key finding, evidence, interpretation, uncertainty and next steps. Use compact tables for comparisons. Avoid generic filler and do not simply repeat the question.",
        "For historical analysis, distinguish short-term weather variability from long-term climate change; do not infer a climate trend from a short period. Explain data-source and reanalysis limitations.",
        "Hazard scores are screening heuristics, not calibrated probabilities or validated warnings. Never describe them as official alerts. For emergencies, direct users to official government meteorological and disaster-management agencies.",
        "If asked for a graph, recommend variables and axes supported by the supplied data; never claim a chart has been generated unless the app displays it."
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
            max_completion_tokens: 2400,
            messages: [
              { role: "system", content: system },
              { role: "user", content: `RECENT CONVERSATION:\n${JSON.stringify(Array.isArray(body?.history) ? body.history.slice(-8) : []).slice(0, 7000)}\n\nENVIRONMENTAL CONTEXT (may be incomplete):\n${JSON.stringify(context).slice(0, 22000)}\n\nQUESTION:\n${question}` }
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
