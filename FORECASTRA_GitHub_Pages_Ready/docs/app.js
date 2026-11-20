/* FORECASTRA v2 — Quantum Minds. Client code; secret API keys remain on the server. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    page: 'Overview',
    location: { name: 'Chennai, Tamil Nadu, India', lat: 13.0827, lon: 80.2707 },
    config: {}, weather: null, archive: null, elevation: null,
    viewer: null, globeHandler: null, radarLayer: null, charts: {}, dataset: null,
    notifications: [], chat: [], recognition: null, officialAlerts: [],
    cycloneRecords: [], cycloneSources: [], cycloneFetchedAt: null, cycloneOffline: false, cycloneMode: 'current',
    hazardRecords: [], hazardSources: [], hazardFetchedAt: null, hazardOffline: false, hazardFrom: null, hazardTo: null,
    listening: false, talkMode: false, aiBusy: false,
    supabase: null, supabaseConversationId: null, alertMetrics: { red: 0, orange: 0, total: 0 },
    settings: { units: 'metric', voice: true, autoSpeak: true, forecastDays: 7 }
  };
  const DAY = 86400000;
  const runtimeConfig = window.FORECASTRA_CONFIG || {};
  const apiBaseUrl = '';
  function resolveApiUrl(url) { return url; }
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const isoDate = date => date.toISOString().slice(0, 10);
  const dateAgo = days => isoDate(new Date(Date.now() - days * DAY));
  const num = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
  const statusToast = (message, error = false) => {
    const node = document.createElement('div'); node.className = 'toast' + (error ? ' error' : ''); node.textContent = message;
    $('toastRegion').append(node); setTimeout(() => node.remove(), 4200);
  };
  async function getJSON(url, options = {}) {
    if (url === '/api/ai') {
      if (!state.supabase) throw new Error('Supabase is not configured. Check docs/config.js.');
      const body = options.body ? JSON.parse(options.body) : {};
      const { data, error } = await state.supabase.functions.invoke('forecastra-ai', { body });
      if (error) throw new Error(error.message || 'Supabase AI function request failed.');
      if (data?.error) throw new Error(data.error);
      return data;
    }
    if (url.startsWith('/api/vc?')) {
      if (!state.supabase) throw new Error('Supabase is not configured. Check docs/config.js.');
      const parsed = new URL(url, window.location.origin);
      const body = {
        lat: Number(parsed.searchParams.get('lat')),
        lon: Number(parsed.searchParams.get('lon')),
        start: parsed.searchParams.get('start') || 'last30days',
        end: parsed.searchParams.get('end') || ''
      };
      const { data, error } = await state.supabase.functions.invoke('forecastra-visual-crossing', { body });
      if (error) throw new Error(error.message || 'Visual Crossing function request failed.');
      if (data?.error) throw new Error(data.error);
      return data;
    }
    if (url.startsWith('/api/')) throw new Error('This optional provider is not connected in the GitHub + Supabase edition.');
    const response = await fetch(resolveApiUrl(url), options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.reason || `Request failed (${response.status})`);
    return data;
  }
  function weatherDescription(code) {
    const map = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Depositing rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',56:'Freezing drizzle',57:'Dense freezing drizzle',61:'Slight rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Slight snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Rain showers',82:'Violent rain showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with hail'};
    return map[code] || 'Conditions unavailable';
  }
  function currentData() { return state.weather?.current || null; }
  function computeMetrics() {
    const weather = state.weather;
    if (!weather?.hourly || !weather?.current) { state.alertMetrics = { red:0, orange:0, total:0 }; return; }
    const current = weather.current;
    const nowIndex = Math.max(0, weather.hourly.time.findIndex(time => time >= current.time));
    const pastRain = weather.hourly.precipitation?.slice(Math.max(0, nowIndex - 24), nowIndex).reduce((sum, v) => sum + (Number(v) || 0), 0) || 0;
    const nextRain = weather.hourly.precipitation?.slice(nowIndex, nowIndex + 72).reduce((sum, v) => sum + (Number(v) || 0), 0) || 0;
    const maxWind = Math.max(0, ...(weather.hourly.wind_speed_10m || []).slice(nowIndex, nowIndex + 120).map(Number).filter(Number.isFinite));
    // Transparent screening thresholds for the UI only, not official alert thresholds.
    const indicators = [];
    if (pastRain >= 100 || nextRain >= 150 || maxWind >= 90) indicators.push({ level:'red', title:'Elevated environmental indicator', detail:'Rainfall or wind screening threshold crossed.' });
    else if (pastRain >= 50 || nextRain >= 75 || maxWind >= 60) indicators.push({ level:'orange', title:'Watch-level environmental indicator', detail:'Rainfall or wind screening threshold crossed.' });
    state.alertMetrics = { red: indicators.filter(v => v.level === 'red').length, orange: indicators.filter(v => v.level === 'orange').length, total: indicators.length, pastRain, nextRain, maxWind };
    state.notifications = indicators;
    $('navAlertCount') && ($('navAlertCount').textContent = String(indicators.length));
    $('bellDot')?.parentElement?.classList.toggle('has-alert', indicators.length > 0);
  }
  async function loadConfig() {
    // Only public browser-safe values belong in config.js. Never put Groq or other private secrets here.
    state.config = {
      supabaseUrl: runtimeConfig.supabaseUrl || '',
      supabaseAnonKey: runtimeConfig.supabaseAnonKey || '',
      cesiumToken: runtimeConfig.cesiumToken || '',
      groqConfigured: false,
      groqModel: runtimeConfig.groqModel || 'openai/gpt-oss-120b',
      visualCrossingConfigured: false,
      weatherApi2Configured: false,
      weatherApi3Configured: false,
      weatherApi2Provider: 'weatherapi',
      weatherApi3Provider: 'openweathermap'
    };
    if (state.config.supabaseUrl && state.config.supabaseAnonKey && window.supabase?.createClient) {
      try {
        state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey);
        // Public FORECASTRA mode: no account or sign-in is required.
      } catch (error) { console.warn('Supabase client unavailable', error); }
    }
  }
  async function ensureSupabaseResearchConversation() {
    if (!state.supabase) return null;
    const { data: sessionData, error: sessionError } = await state.supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) return null;
    if (state.supabaseConversationId) return { id: state.supabaseConversationId, userId: user.id };
    const { data: recent, error: recentError } = await state.supabase
      .from('research_conversations').select('id').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (recentError) throw recentError;
    if (recent?.id) state.supabaseConversationId = recent.id;
    else {
      const { data: created, error } = await state.supabase.from('research_conversations')
        .insert({ title: 'FORECASTRA Research Session' }).select('id').single();
      if (error) throw error;
      state.supabaseConversationId = created.id;
    }
    return { id: state.supabaseConversationId, userId: user.id };
  }
  async function persistSupabaseResearchMessage(role, content) {
    const conversation = await ensureSupabaseResearchConversation();
    if (!conversation) return false;
    const { error } = await state.supabase.from('research_messages').insert({
      conversation_id: conversation.id, user_id: conversation.userId, role, content,
      model: role === 'assistant' ? (state.config.groqModel || null) : null
    });
    if (error) throw error;
    const { error: updateError } = await state.supabase.from('research_conversations')
      .update({ updated_at: new Date().toISOString() }).eq('id', conversation.id);
    if (updateError) throw updateError;
    return true;
  }
  async function loadSupabaseResearchHistory() {
    if (!state.supabase) return;
    try {
      const conversation = await ensureSupabaseResearchConversation();
      if (!conversation) return;
      const { data, error } = await state.supabase.from('research_messages')
        .select('role,content,created_at').eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true }).limit(100);
      if (error) throw error;
      if (Array.isArray(data) && data.length) {
        state.chat = data.map(item => ({ role: item.role, content: item.content }));
        if (state.page === 'Research AI') renderChatHistory();
      }
    } catch (error) { console.warn('Could not load saved research history:', error.message); }
  }
  async function saveSupabaseDatasetAnalysis(dataset) {
    if (!state.supabase || !dataset) return;
    const { data: sessionData, error: sessionError } = await state.supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return;
    const { error } = await state.supabase.from('dataset_analyses').insert({
      file_name: dataset.name, row_count: dataset.rows.length,
      column_count: dataset.columns.length, numeric_summary: dataset.summary
    });
    if (error) throw error;
    statusToast('Dataset summary saved to your Supabase account.');
  }
  async function loadWeather() {
    const { lat, lon } = state.location;
    const params = new URLSearchParams({
      latitude: lat, longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,relative_humidity_2m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code,sunrise,sunset',
      past_days: '2', forecast_days: String(state.settings.forecastDays || 7), timezone: 'auto'
    });
    const weather = await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`);
    state.weather = weather;
    try {
      const elevation = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
      state.elevation = elevation.elevation?.[0] ?? null;
    } catch { state.elevation = null; }
    computeMetrics();
    return weather;
  }
  async function searchLocation(query) {
    const value = query.trim(); if (!value) return;
    try {
      let loc;
      const coordinateMatch = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (coordinateMatch) {
        const lat = Number(coordinateMatch[1]), lon = Number(coordinateMatch[2]);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Coordinates are outside valid latitude/longitude ranges.');
        loc = { name:`${lat.toFixed(4)}°, ${lon.toFixed(4)}°`, lat, lon };
      } else {
        const result = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(value)}&count=5&language=en&format=json`);
        const place = result.results?.[0];
        if (!place) throw new Error('Location not found. Try a city or coordinates.');
        loc = { name:[place.name, place.admin1, place.country].filter(Boolean).join(', '), lat:place.latitude, lon:place.longitude };
      }
      state.location = loc; await refreshLocationData(true); statusToast(`Location changed to ${loc.name}`);
    } catch (error) { statusToast(error.message, true); }
  }
  async function refreshLocationData(fly = false) {
    try {
      await loadWeather(); updateTopLocation(); renderPage();
      if (state.viewer && fly) flyGlobeToLocation();
      else if (state.viewer) addLocationMarker();
    } catch (error) {
      statusToast(`Weather data could not be loaded: ${error.message}`, true);
      renderPage();
    }
  }
  function updateTopLocation() {
    $('topCoordinates').textContent = `${state.location.lat.toFixed(2)}°, ${state.location.lon.toFixed(2)}°`;
  }
  function syncSkyTheme() {
    const current = currentData(), daily = state.weather?.daily;
    const zone = state.weather?.timezone || 'Asia/Kolkata';
    const localParts = new Intl.DateTimeFormat('en-GB', { timeZone:zone, hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(new Date());
    const part = type => localParts.find(item => item.type === type)?.value || '00';
    const hour = Number(part('hour')), minute = Number(part('minute')), nowMinutes = hour * 60 + minute;
    const toMinutes = value => value && /^\\d{2}:\\d{2}$/.test(value.slice(11,16)) ? Number(value.slice(11,13))*60 + Number(value.slice(14,16)) : null;
    const sunrise = toMinutes(daily?.sunrise?.[0]), sunset = toMinutes(daily?.sunset?.[0]);
    let phase = hour >= 6 && hour < 17 ? 'day' : 'night';
    if (sunrise != null && sunset != null) {
      if (nowMinutes >= sunrise - 50 && nowMinutes < sunrise + 65) phase = 'dawn';
      else if (nowMinutes >= sunset - 70 && nowMinutes < sunset + 95) phase = 'dusk';
      else if (nowMinutes >= sunrise + 65 && nowMinutes < sunset - 70) phase = 'day';
      else phase = 'night';
    } else if (hour >= 17 && hour < 20) phase = 'dusk';
    else if (hour >= 5 && hour < 7) phase = 'dawn';
    const code = Number(current?.weather_code);
    const tone = [95,96,99].includes(code) ? 'storm' : [51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code) ? 'rain' : [45,48].includes(code) ? 'fog' : [2,3].includes(code) ? 'cloud' : 'clear';
    document.body.dataset.skyPhase = phase;
    document.body.dataset.skyWeather = tone;
    const clock = document.getElementById('skyLocalTime');
    if (clock) clock.textContent = new Intl.DateTimeFormat('en-GB', { timeZone:zone, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date());
    const date = document.getElementById('skyLocalDate');
    if (date) date.textContent = new Intl.DateTimeFormat('en-IN', { timeZone:zone, weekday:'long', day:'2-digit', month:'short' }).format(new Date()).toUpperCase();
    const label = document.getElementById('skyPhaseLabel');
    if (label) label.textContent = ({day:'DAYLIGHT',dawn:'SUNRISE',dusk:'SUNSET',night:'AFTER DARK'})[phase];
  }
  function clockTick() {
    const now = new Date();
    $('utcClock').textContent = now.toLocaleTimeString('en-GB', { timeZone:'UTC', hour12:false });
    $('utcDate').textContent = now.toLocaleDateString('en-GB', { timeZone:'UTC', day:'2-digit', month:'short', year:'numeric' }).toUpperCase() + ' · UTC';
    syncSkyTheme();
  }
  function destroyCharts() { Object.values(state.charts).forEach(chart => { try { chart.destroy(); } catch {} }); state.charts = {}; }
  function destroyGlobe() {
    if (state.globeHandler) { try { state.globeHandler.destroy(); } catch {} state.globeHandler = null; }
    if (state.viewer) { try { state.viewer.destroy(); } catch {} state.viewer = null; state.radarLayer = null; }
  }
  function createGlobe(containerId, large = false) {
    const element = $(containerId);
    if (!element || state.viewer) return;
    if (!window.Cesium) {
      element.innerHTML = '<div class="globe-fallback"><div class="fallback-earth"></div><span>3D globe library did not load · check your internet connection</span></div>';
      return;
    }
    try {
      const C = window.Cesium;
      if (state.config.cesiumToken) C.Ion.defaultAccessToken = state.config.cesiumToken;
      const options = {
        animation:false, timeline:false, geocoder:false, baseLayerPicker:false,
        homeButton:false, sceneModePicker:false, navigationHelpButton:false,
        fullscreenButton:false, infoBox:false, selectionIndicator:false,
        requestRenderMode:false, scene3DOnly:true,
        imageryProvider:new C.OpenStreetMapImageryProvider({ url:'https://tile.openstreetmap.org/' })
      };
      state.viewer = new C.Viewer(element, options);
      const viewer = state.viewer;
      const fallbackLayer = viewer.imageryLayers.get(0);
      // Prefer satellite basemap imagery; keep the existing OSM layer if the imagery service is unavailable.
      if (C.ArcGisMapServerImageryProvider?.fromUrl) {
        C.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer')
          .then(provider => {
            if (state.viewer !== viewer || viewer.isDestroyed()) return;
            if (fallbackLayer) viewer.imageryLayers.remove(fallbackLayer, true);
            viewer.imageryLayers.addImageryProvider(provider, 0);
            const foot = element.parentElement?.querySelector('.map-foot');
            if (foot) foot.textContent = 'SATELLITE IMAGERY · ESRI WORLD IMAGERY · CESIUMJS';
          })
          .catch(error => {
            console.info('Satellite basemap unavailable; keeping OpenStreetMap fallback.', error);
            const foot = element.parentElement?.querySelector('.map-foot');
            if (foot) foot.textContent = 'STREET MAP FALLBACK · OPENSTREETMAP · CESIUMJS';
          });
      }
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.backgroundColor = C.Color.BLACK;
      viewer.scene.globe.baseColor = C.Color.fromCssColorString('#071a24');
      viewer.camera.setView({ destination:C.Cartesian3.fromDegrees(state.location.lon, state.location.lat, large ? 14500000 : 9500000) });
      state.globeHandler = new C.ScreenSpaceEventHandler(viewer.canvas);
      state.globeHandler.setInputAction(event => {
        const point = viewer.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid);
        if (!point) return;
        const cartographic = C.Cartographic.fromCartesian(point);
        const lat = C.Math.toDegrees(cartographic.latitude), lon = C.Math.toDegrees(cartographic.longitude);
        state.location = { name:`Selected point ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, lat, lon };
        refreshLocationData(false);
        statusToast(`Globe selected: ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`);
      }, C.ScreenSpaceEventType.LEFT_CLICK);
      addLocationMarker();
      if(state.page==='Cyclone Tracking')drawCycloneEntities();
    } catch (error) {
      console.error('Cesium could not initialise', error);
      element.innerHTML = '<div class="globe-fallback"><div class="fallback-earth"></div><span>3D globe unavailable · check your internet connection</span></div>';
    }
  }
  function addLocationMarker() {
    if (!state.viewer || !window.Cesium) return;
    const C = window.Cesium, viewer = state.viewer;
    viewer.entities.removeAll();
    viewer.entities.add({
      position:C.Cartesian3.fromDegrees(state.location.lon, state.location.lat),
      point:{ pixelSize:10, color:C.Color.fromCssColorString('#36d8f4'), outlineColor:C.Color.WHITE, outlineWidth:2 },
      label:{ text:state.location.name, font:'12px sans-serif', fillColor:C.Color.WHITE, outlineColor:C.Color.BLACK, outlineWidth:3, style:C.LabelStyle.FILL_AND_OUTLINE, pixelOffset:new C.Cartesian2(0,-20), showBackground:true, backgroundColor:C.Color.fromCssColorString('#091827').withAlpha(.85) }
    });
  }
  function flyGlobeToLocation() {
    if (!state.viewer || !window.Cesium) return;
    state.viewer.camera.flyTo({ destination:window.Cesium.Cartesian3.fromDegrees(state.location.lon, state.location.lat, 900000) });
    addLocationMarker();
  }
  async function toggleRainRadar(enabled) {
    if (!state.viewer) return;
    if (state.radarLayer) { state.viewer.imageryLayers.remove(state.radarLayer, true); state.radarLayer = null; }
    if (!enabled) return;
    try {
      const maps = await getJSON('https://api.rainviewer.com/public/weather-maps.json');
      const frame = maps.radar?.past?.at(-1) || maps.radar?.nowcast?.[0];
      if (!frame) throw new Error('No recent radar tile frame is available.');
      const provider = new Cesium.UrlTemplateImageryProvider({ url:`${maps.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel:7, credit:'RainViewer' });
      state.radarLayer = state.viewer.imageryLayers.addImageryProvider(provider);
      state.radarLayer.alpha = .7;
    } catch (error) { statusToast(`Rain radar unavailable: ${error.message}`, true); const box = $('radarToggle'); if (box) box.checked = false; }
  }
  function kpi(label, value, unit = '', foot = '', style = '') {
    return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${style}">${value}<small>${unit}</small></div><div class="kpi-foot">${foot}</div></div>`;
  }
  function metric(label, value, unit, foot = '') {
    return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}<span style="font-size:12px;color:var(--muted);font-weight:500"> ${unit || ''}</span></div><div class="metric-foot">${foot}</div></div>`;
  }
  function panel(title, subtitle, body, extra = '') {
    return `<section class="panel ${extra}"><div class="panel-head"><div class="panel-title">${title}</div>${subtitle ? `<div class="panel-sub">${subtitle}</div>` : ''}</div>${body}</section>`;
  }
  function pageHeading(title, description, action = '') {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="right">${action}</div></div>`;
  }
  function currentOrDash(field) { return state.weather?.current?.[field] ?? '—'; }
  function globalIntelligencePage() {
    const weather = state.weather, current = weather?.current, todayMax = weather?.daily?.temperature_2m_max?.[0], todayMin = weather?.daily?.temperature_2m_min?.[0];
    const wettest = weather?.daily?.precipitation_sum?.[0];
    const metrics = state.alertMetrics;
    const stationRow = current ? `<tr><td>${escapeHTML(state.location.name)}</td><td>${escapeHTML(weatherDescription(current.weather_code))}</td><td>${num(current.temperature_2m)}</td><td>${num(todayMin)} / ${num(todayMax)}</td><td>${num(current.precipitation)}</td><td>${num(current.relative_humidity_2m,0)}</td></tr>` : '<tr><td colspan="6" class="empty-cell">Waiting for weather data…</td></tr>';
    return `
      <div class="location-line"><span class="loc-pin">⌖</span><span class="loc-name">${escapeHTML(state.location.name)}</span><span class="loc-sub">Globe selection · ${state.location.lat.toFixed(3)}°, ${state.location.lon.toFixed(3)}° · UTC</span><span class="line-spacer"></span><span class="eyebrow">LOCAL CONDITIONS · CURRENT HOUR</span><button class="small-btn" id="refreshGlobal">↻ &nbsp;Refresh</button></div>
      <div class="kpis">
        ${kpi('GRID TEMPERATURE', num(current?.temperature_2m), '°C', '1 selected forecast grid point', 'cyan')}
        ${kpi('WARMEST', num(todayMax), '°C', 'Today · daily forecast')}
        ${kpi('COOLEST', num(todayMin), '°C', 'Today · daily forecast')}
        ${kpi('WETTEST TODAY', num(wettest), 'mm', 'Forecast precipitation total')}
        ${kpi('HAZARD ALERTS', metrics.total, '', `${metrics.red} red level · screening only`, 'amber')}
      </div>
      <div class="primary-grid">
        <section class="map-card"><div id="globalGlobe" class="map-canvas"></div><div class="map-overlay"><button class="map-chip" id="layersBtn">▱ &nbsp;LAYERS</button><label class="map-chip"><input type="checkbox" id="radarToggle"> Rain radar</label></div><div class="map-overlay right"><button class="map-chip" id="openEarthBtn">⤢ &nbsp;Open 3D Earth</button></div><div class="map-foot">◉ &nbsp;SATELLITE BASEMAP LOADING &nbsp;·&nbsp; SELECTED LOCATION &nbsp;·&nbsp; CESIUMJS</div></section>
        <div class="side-stack">
          ${panel('HAZARD SNAPSHOT','Screening indicators for selected location',`
            <div class="hazard-row"><span>Total events</span><strong>—</strong></div>
            <div class="hazard-row"><span>Red level</span><strong class="red">${metrics.red}</strong></div>
            <div class="hazard-row"><span>Orange level</span><strong class="orange">${metrics.orange}</strong></div>
            <div class="hazard-row"><span>Tropical systems</span><strong>—</strong></div>
            <div class="hazard-row"><span>Earthquakes (7 d)</span><strong>—</strong></div>`)}
          ${panel('COVERAGE','',`<div class="coverage">The map supports location queries across the globe. Weather values are grid-based Open-Meteo data for the selected coordinate, not a verified multi-station catalogue. Station-by-station comparisons require an observation network to be configured. Red/orange values are local rainfall-and-wind screening indicators, not official alert levels. Global event, tropical-system and earthquake feeds are not connected yet.</div>`)}
        </div>
      </div>
      ${panel('LOCATION OBSERVATIONS','Current conditions at the selected forecast grid point',`
        <div class="station-table-wrap"><table class="station-table"><thead><tr><th>STATION / LOCATION</th><th>CONDITION</th><th>TEMP °C</th><th>MIN / MAX °C</th><th>RAIN MM</th><th>RH %</th></tr></thead><tbody>${stationRow}</tbody></table></div>
        <div class="data-note">Source: Open-Meteo forecast grid. This row represents the selected coordinate and should not be interpreted as an official weather-station observation.</div>`, 'station-panel')}`;
  }
  function weatherIconMarkup(code, size = 48) {
    const value = Number(code);
    const sun = '<circle cx="12" cy="12" r="4.1"/><path d="M12 1.8v2.4M12 19.8v2.4M4.8 4.8l1.7 1.7m11 11 1.7 1.7M1.8 12h2.4m15.6 0h2.4M4.8 19.2l1.7-1.7m11-11 1.7-1.7"/>';
    const cloud = '<path d="M6.7 18.2h10.1a4.2 4.2 0 0 0 .2-8.4 5.7 5.7 0 0 0-10.9 1.1 3.7 3.7 0 0 0 .6 7.3Z"/>';
    let shape;
    if (value === 0 || value === 1) shape = sun;
    else if (value === 2) shape = '<g><path d="M7.5 14.8a4 4 0 0 1 7.6-.9 3.6 3.6 0 0 1 1.2-.2"/><path d="M6.7 19h10.1a4.2 4.2 0 0 0 .2-8.4 5.7 5.7 0 0 0-10.9 1.1 3.7 3.7 0 0 0 .6 7.3Z"/><path d="M12 2v2m-7.1 1.1 1.4 1.4M2.5 12h2"/></g>';
    else if ([45,48].includes(value)) shape = '<path d="M4 9h16M2 13h16M5 17h14"/>';
    else if ([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(value)) shape = cloud + '<path d="m8 19-1 2m7-2-1 2m7-2-1 2"/>';
    else shape = cloud;
    return `<svg class="weather-symbol" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${escapeHTML(weatherDescription(value))}" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
  }
  function overviewPage() {
    const current = currentData(), daily = state.weather?.daily, weather = state.weather;
    const code = current?.weather_code;
    const headline = ({0:'Clear skies',1:'Mostly sunny',2:'Partly cloudy',3:'Overcast',45:'Foggy conditions',48:'Foggy conditions',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',61:'Light rain',63:'Rain showers',65:'Heavy rain',71:'Light snow',73:'Snowfall',75:'Heavy snowfall',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorms',96:'Thunderstorms',99:'Thunderstorms'})[code] || weatherDescription(code);
    const dayLabel = date => date ? new Date(date + 'T12:00:00').toLocaleDateString('en-IN',{weekday:'long'}) : '—';
    const shortDay = (date,index) => index===0 ? 'Today' : (date ? new Date(date + 'T12:00:00').toLocaleDateString('en-IN',{weekday:'short'}) : '—');
    const sunrise = daily?.sunrise?.[0] ? daily.sunrise[0].slice(11,16) : '—';
    const sunset = daily?.sunset?.[0] ? daily.sunset[0].slice(11,16) : '—';
    const forecast = (daily?.time || []).slice(0,7).map((date,index)=>`
      <article class="overview-day">
        <span class="overview-day-name">${shortDay(date,index)}</span>
        <div class="overview-day-icon">${weatherIconMarkup(daily.weather_code?.[index],30)}</div>
        <strong>${num(daily.temperature_2m_max?.[index],0)}°</strong>
        <span class="overview-day-low">${num(daily.temperature_2m_min?.[index],0)}°</span>
        <span class="overview-day-rain">${daily.precipitation_probability_max?.[index] == null ? '—' : Math.round(daily.precipitation_probability_max[index]) + '% rain'}</span>
      </article>`).join('') || '<div class="overview-no-data">Seven-day forecast is not available yet.</div>';
    const weatherStamp = current?.time ? current.time.replace('T',' ') : 'Waiting for update';
    const location = escapeHTML(state.location.name);
    const temp = num(current?.temperature_2m,0);
    const feels = num(current?.apparent_temperature,0);
    const wind = num(current?.wind_speed_10m,1);
    const humidity = num(current?.relative_humidity_2m,0);
    const rain = num(current?.precipitation,1);
    const pressure = num(current?.pressure_msl,0);
    return `
      <section class="weather-overview">
        <header class="overview-heading">
          <div><div class="overview-eyebrow">FORECASTRA / WEATHER INTELLIGENCE</div><h1>Weather overview</h1><p>Atmospheric conditions and the seven-day outlook for your selected location.</p></div>
          <div class="overview-heading-actions"><span class="overview-live"><i></i> LIVE GRID FEED</span><button class="secondary-btn" id="refreshOverview">↻ &nbsp;Refresh</button></div>
        </header>
        <section class="weather-hero">
          <div class="weather-hero-top">
            <div class="weather-place"><span class="weather-place-pin">⌖</span><div><strong>${location}</strong><span>${state.location.lat.toFixed(3)}° N / ${state.location.lon.toFixed(3)}° E</span></div></div>
            <div class="weather-source">OPEN-METEO · ${escapeHTML(weatherStamp)} LOCAL</div>
          </div>
          <div class="weather-hero-grid">
            <div class="sky-time-orb" aria-label="Live local time and sky phase">
              <span class="sky-orb-label" id="skyPhaseLabel">LOCAL TIME</span>
              <strong id="skyLocalTime">--:--</strong>
              <span class="sky-orb-date" id="skyLocalDate">LOCAL TIME</span>
            </div>
            <div class="weather-primary">
              <div class="weather-state-label">CURRENT CONDITIONS</div>
              <div class="weather-title-row">${weatherIconMarkup(code,54)}<div><h2>${escapeHTML(headline)}</h2><p>${escapeHTML(weatherDescription(code))} at the selected forecast grid point.</p></div></div>
              <div class="weather-temp-line"><strong>${temp}<sup>°</sup></strong><div class="weather-temp-meta"><span>Feels like ${feels}°C</span><span>Relative humidity ${humidity}%</span></div></div>
              <div class="weather-place-note">Selected location · ${state.location.lat.toFixed(4)}, ${state.location.lon.toFixed(4)}</div>
            </div>
            <div class="weather-side-panels">
              <section class="weather-glass-panel wind-panel">
                <div class="weather-panel-heading"><span>WIND STATUS</span><span class="weather-panel-icon">↗</span></div>
                <div class="wind-readout"><strong>${wind}</strong><span>km/h</span></div>
                <div class="overview-wind-chart"><canvas id="overviewWindChart" aria-label="Hourly wind speed trend"></canvas></div>
                <div class="weather-panel-foot"><span>10 m wind speed</span><span>Pressure ${pressure} hPa</span></div>
              </section>
              <section class="weather-glass-panel sun-panel">
                <div class="weather-panel-heading"><span>DAYLIGHT WINDOW</span><span class="weather-panel-icon">☼</span></div>
                <div class="sun-times"><div><span>SUNRISE</span><strong>${sunrise}</strong></div><div><span>SUNSET</span><strong>${sunset}</strong></div></div>
                <svg class="sun-arc" viewBox="0 0 320 96" role="img" aria-label="Sunrise to sunset arc"><path class="sun-arc-track" d="M18 82 Q160 -45 302 82"/><path class="sun-arc-horizon" d="M18 82H302"/><path class="sun-arc-progress" d="M18 82 Q160 -45 302 82"/><circle cx="160" cy="18" r="5"/></svg>
                <div class="weather-panel-foot"><span>Local solar times</span><span>${dayLabel(daily?.time?.[0])}</span></div>
              </section>
            </div>
          </div>
          <div class="weather-hero-bottom">
            <div><span>PRECIPITATION</span><strong>${rain}<small> mm</small></strong></div>
            <div><span>HUMIDITY</span><strong>${humidity}<small> %</small></strong></div>
            <div><span>WIND</span><strong>${wind}<small> km/h</small></strong></div>
            <div><span>TODAY'S HIGH / LOW</span><strong>${num(daily?.temperature_2m_max?.[0],0)}° <small>/ ${num(daily?.temperature_2m_min?.[0],0)}°</small></strong></div>
          </div>
        </section>
        <section class="overview-forecast-section">
          <div class="overview-section-heading"><div><span class="overview-eyebrow">FORECAST OUTLOOK</span><h2>Next seven days</h2></div><button class="text-link-btn" data-go="Weather">Full forecast ↗</button></div>
          <div class="overview-forecast-grid">${forecast}</div>
        </section>
        <section class="overview-provider-section">
          <div class="overview-section-heading"><div><span class="overview-eyebrow">SOURCE CROSS-CHECK</span><h2>Additional weather sources</h2></div><button class="text-link-btn" id="refreshProviders">Refresh sources ↻</button></div>
          <div class="overview-provider-grid">
            <article class="overview-provider-card"><div class="overview-provider-header"><span>WEATHER API 2</span><span class="overview-provider-mark">SECONDARY SOURCE</span></div><div class="overview-provider-provider">WeatherAPI.com adapter</div><div id="overviewProvider2" class="overview-provider-state">Optional provider is not connected in this edition.</div></article>
            <article class="overview-provider-card"><div class="overview-provider-header"><span>WEATHER API 3</span><span class="overview-provider-mark">SECONDARY SOURCE</span></div><div class="overview-provider-provider">OpenWeatherMap adapter</div><div id="overviewProvider3" class="overview-provider-state">Optional provider is not connected in this edition.</div></article>
          </div>
          <div class="overview-provider-note">Independent source checks are shown only when their provider key is configured. Differences between providers are normal and should be reviewed with source, time and location in mind.</div>
        </section>
        <section class="overview-lower-grid">
          <div class="overview-data-card"><div class="overview-data-heading"><div><span class="overview-eyebrow">INTRADAY TREND</span><h2>Temperature movement</h2></div><span class="overview-unit">°C · HOURLY</span></div><div class="overview-temp-chart"><canvas id="overviewChart"></canvas></div></div>
          <div class="overview-data-card overview-location-card"><span class="overview-eyebrow">SELECTED LOCATION</span><h2>${location}</h2><div class="overview-coordinate-row"><span>LATITUDE</span><strong>${state.location.lat.toFixed(4)}°</strong></div><div class="overview-coordinate-row"><span>LONGITUDE</span><strong>${state.location.lon.toFixed(4)}°</strong></div><div class="overview-coordinate-row"><span>ELEVATION</span><strong>${state.elevation == null ? 'Not available' : num(state.elevation,0)+' m'}</strong></div><div class="overview-location-actions"><button class="secondary-btn" data-go="3D Earth">Open 3D Earth</button><button class="secondary-btn" data-go="Research AI">Research AI</button></div></div>
        </section>
        <div class="overview-data-caption">Data source: Open-Meteo forecast grid · Times shown in the selected location's local time where supplied by the provider. Forecast-grid values are not official station observations.</div>
      </section>`;
  }
  function apiStatusCompact() {
    const items = [['Open-Meteo','Connected'],['Groq AI',state.config.groqConfigured?'Configured':'Not configured'],['Supabase',state.config.supabaseUrl?'Configured':'Not configured']];
    return items.map(([name,status])=>`<div class="hazard-row"><span>${name}</span><strong>${status}</strong></div>`).join('');
  }
  function globePage() {
    return `${pageHeading('3D Earth','Interactive globe · click anywhere to retarget all environmental views',`<button class="small-btn" id="flySelected">⌖ &nbsp;Fly to selected location</button>`)}
      <section class="map-card map-large"><div id="earthGlobe" class="map-canvas"></div><div class="map-overlay"><label class="map-chip"><input id="earthRadarToggle" type="checkbox"> Rain radar</label></div><div class="map-overlay right"><span class="map-chip">CESIUMJS · 3D GLOBE</span></div><div class="map-foot">SATELLITE BASEMAP LOADING · CLICK TO SELECT A LOCATION</div></section>
      <div class="info-strip" style="margin-top:12px">The globe prefers Esri World Imagery satellite basemap tiles and retains OpenStreetMap as a fallback. Cesium ion credentials can enable additional Cesium-hosted assets. Rain radar is a separate public overlay and may be unavailable occasionally.</div>`;
  }
  function weatherPage() {
    const daily = state.weather?.daily;
    const rows = daily?.time?.map((date,i)=>`<tr><td>${new Date(date+'T00:00:00').toLocaleDateString('en',{weekday:'short',day:'numeric',month:'short'})}</td><td>${weatherDescription(daily.weather_code[i])}</td><td>${num(daily.temperature_2m_min[i])}° / ${num(daily.temperature_2m_max[i])}°</td><td>${num(daily.precipitation_sum[i])} mm</td><td>${num(daily.precipitation_probability_max[i],0)}%</td><td>${num(daily.wind_speed_10m_max[i])} km/h</td></tr>`).join('') || '<tr><td colspan="6" class="empty-cell">Weather data not loaded.</td></tr>';
    const c = currentData();
    return `${pageHeading('Weather','Current conditions and the seven-day forecast for the selected location')}
      <div class="metric-grid">${metric('TEMPERATURE',num(c?.temperature_2m),'°C',weatherDescription(c?.weather_code))}${metric('FEELS LIKE',num(c?.apparent_temperature),'°C','Apparent temperature')}${metric('HUMIDITY',num(c?.relative_humidity_2m,0),'%','Relative humidity')}${metric('WIND',num(c?.wind_speed_10m),'km/h','10 m wind')}</div>
      <div class="two-col">${panel('HOURLY TEMPERATURE','Observed/recent and forecast values',`<div class="chart-box"><canvas id="weatherChart"></canvas></div>`)}${panel('CURRENT CONDITIONS','',`<div class="coverage"><div class="list-row"><span>Condition</span><strong>${weatherDescription(c?.weather_code)}</strong></div><div class="list-row"><span>Pressure</span><strong>${num(c?.pressure_msl,0)} hPa</strong></div><div class="list-row"><span>Cloud cover</span><strong>${num(c?.cloud_cover,0)}%</strong></div><div class="list-row"><span>Precipitation</span><strong>${num(c?.precipitation)} mm</strong></div><div class="list-row"><span>Wind direction</span><strong>${num(c?.wind_direction_10m,0)}°</strong></div></div>`)}</div>
      <div style="margin-top:14px">${panel('SEVEN-DAY FORECAST','Daily forecast · Open-Meteo',`<div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>DATE</th><th>CONDITION</th><th>MIN / MAX</th><th>PRECIPITATION</th><th>RAIN CHANCE</th><th>MAX WIND</th></tr></thead><tbody>${rows}</tbody></table></div>`)}</div>`;
  }
  function rainfallPage() {
    const daily = state.weather?.daily;
    return `${pageHeading('Rainfall','Recent precipitation and forecast rainfall at the selected coordinate')}
      <div class="metric-grid">${metric('RAIN RIGHT NOW',num(currentOrDash('precipitation')),'mm','Current conditions')}${metric('TODAY TOTAL',num(daily?.precipitation_sum?.[0]),'mm','Daily forecast')}${metric('NEXT 72 HOURS',num(state.alertMetrics.nextRain),'mm','Forecast accumulation')}${metric('RAIN CHANCE',num(daily?.precipitation_probability_max?.[0],0),'%','Maximum daily probability')}</div>
      <div class="two-col">${panel('HOURLY PRECIPITATION','Millimetres · recent and forecast',`<div class="chart-box"><canvas id="rainHourChart"></canvas></div>`)}${panel('DAILY PRECIPITATION','Daily forecast totals',`<div class="chart-box"><canvas id="rainDayChart"></canvas></div>`)}</div>
      <div class="info-strip" style="margin-top:13px">Precipitation estimates are forecast-grid values. Rainfall distribution can vary substantially over short distances, especially during convective storms.</div>`;
  }
  function floodPage() {
    const a = state.alertMetrics, score = Math.min(100, Math.round(((a.pastRain||0)/100*35 + (a.nextRain||0)/150*45 + (a.maxWind||0)/100*20)));
    const level = score < 25 ? 'LOW SCREENING' : score < 50 ? 'MODERATE SCREENING' : score < 75 ? 'HIGH SCREENING' : 'VERY HIGH SCREENING';
    return `${pageHeading('Flood Intelligence','Rainfall-led baseline screening · not a validated flood-depth or probability model')}
      <div class="info-strip warning-strip">This is a research screening view, not an official flood warning. It does not include verified drainage capacity, river stage, land use, road condition, pothole evidence or calibrated historical flood labels.</div>
      <div class="metric-grid">${metric('BASELINE SCREENING INDEX',score,'/100',level)}${metric('PAST 24 H RAIN',num(a.pastRain),'mm','Recent hourly accumulation')}${metric('NEXT 72 H RAIN',num(a.nextRain),'mm','Forecast accumulation')}${metric('ELEVATION',state.elevation==null?'—':num(state.elevation,0),'m','Open-Meteo elevation grid')}</div>
      <div class="two-col">${panel('RAINFALL SIGNAL','',`<div class="chart-box"><canvas id="floodChart"></canvas></div>`)}${panel('MODEL A · BASELINE INPUTS','Transparent screening inputs',`<div class="coverage"><div class="list-row"><span>Recent rainfall</span><strong>${num(a.pastRain)} mm / 24 h</strong></div><div class="list-row"><span>Forecast rainfall</span><strong>${num(a.nextRain)} mm / 72 h</strong></div><div class="list-row"><span>Peak forecast wind</span><strong>${num(a.maxWind)} km/h</strong></div><div class="list-row"><span>Elevation</span><strong>${state.elevation==null?'Not available':num(state.elevation,0)+' m'}</strong></div><p style="margin-top:12px">Model B should add validated drainage, terrain, land-cover and road-condition evidence. Its performance must be compared with Model A using held-out historical events before drawing conclusions.</p></div>`)}</div>
      <section class="content-card" style="margin-top:14px"><div class="api-diagnostics-head"><div><h2>SUPABASE RIVER OBSERVATIONS</h2><p>Stored Tamil Nadu station records · source agency labels retained</p></div><button class="secondary-btn" id="refreshFloodDb">↻ Refresh</button></div><div id="floodDbRows" class="coverage">Loading stored river observations…</div></section>
      <section class="content-card" style="margin-top:14px"><div class="api-diagnostics-head"><div><h2>OFFICIAL FLOOD & DISASTER WARNINGS</h2><p>Open issuing-agency bulletins; FORECASTRA does not create official alerts</p></div></div><div id="officialAlertRows" class="coverage">Checking official alert records…</div>
      <div class="report-actions" style="margin-top:12px"><a class="secondary-btn" href="https://sachet.ndma.gov.in/" target="_blank" rel="noreferrer">NDMA SACHET live alerts ↗</a><a class="secondary-btn" href="https://mausam.imd.gov.in/responsive/districtWiseWarningGIS.php" target="_blank" rel="noreferrer">IMD district warnings ↗</a><a class="secondary-btn" href="https://ffs.india-water.gov.in/" target="_blank" rel="noreferrer">CWC flood forecasts ↗</a><a class="secondary-btn" href="https://aff.india-water.gov.in/home.php" target="_blank" rel="noreferrer">CWC 7-day flood advisories ↗</a></div></section>`;
  }
  async function loadFloodDatabase(){
    const river=$('floodDbRows'), alerts=$('officialAlertRows');
    if(!river||!alerts)return;
    river.textContent='Loading stored river observations…';
    alerts.textContent='Refreshing NDMA SACHET and loading enriched CAP records…';
    const refresh=$('refreshFloodDb');
    if(refresh && !refresh.dataset.bound){refresh.dataset.bound='1';refresh.addEventListener('click',loadFloodDatabase);}
    if(!state.supabase){
      river.textContent='Supabase is not configured. Check the public project URL and publishable key.';
      alerts.textContent='Official warning records are unavailable. Use the government source links below.';
      return;
    }
    const formatIST=value=>{
      if(!value)return 'Not supplied by issuing agency';
      const date=new Date(value);
      if(!Number.isFinite(date.getTime()))return 'Time unavailable';
      return new Intl.DateTimeFormat('en-IN',{
        timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',
        hour:'2-digit',minute:'2-digit',hour12:true,timeZoneName:'short'
      }).format(date);
    };
    const safeBulletinUrl=value=>{
      try{
        const url=new URL(value);
        return url.protocol==='https:'&&url.hostname==='sachet.ndma.gov.in'
          ?url.toString():'https://sachet.ndma.gov.in/';
      }catch{return 'https://sachet.ndma.gov.in/';}
    };
    try{
      const [riverResult,feedResult]=await Promise.all([
        state.supabase.from('river_water_levels_raw')
          .select('state,agency,station,river,district,observed_at_local,water_level_m,quality_review_flags')
          .eq('state','Tamil Nadu').order('observed_at_local',{ascending:false}).limit(25),
        state.supabase.functions.invoke('forecastra-sachet-feed',{body:{}})
      ]);
      if(riverResult.error)throw riverResult.error;
      const rows=riverResult.data||[];
      if(!rows.length)river.innerHTML='<p>No river station records are stored yet.</p>';
      else{
        const latest=rows[0].observed_at_local;
        const ageHours=latest?Math.round((Date.now()-new Date(latest).getTime())/3600000):null;
        const freshness=ageHours===null?'Timestamp unavailable':ageHours>48?'STALE DATA · ':'Latest stored record · ';
        river.innerHTML='<p><strong>'+freshness+escapeHTML(latest||'—')+'</strong> · '+rows.length+' latest records shown</p><div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>STATION</th><th>RIVER</th><th>DISTRICT</th><th>LEVEL (m)</th><th>OBSERVED</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+escapeHTML(row.station||'—')+'</td><td>'+escapeHTML(row.river||'—')+'</td><td>'+escapeHTML(row.district||'—')+'</td><td>'+num(row.water_level_m,2)+'</td><td>'+escapeHTML(row.observed_at_local||'—')+'</td></tr>').join('')+'</tbody></table></div><p class="metric-foot">Agency in database: '+escapeHTML(rows[0].agency||'Not specified')+' · Stored readings may be delayed; do not treat these as a live flood warning.</p>';
      }

      // The Edge Function refreshes/upserts CAP-enriched records. Always render
      // the database rows afterwards; never promote raw RSS items to active alerts.
      const {data:official,error:alertError}=await state.supabase.from('official_alerts')
        .select('source_agency,hazard_type,severity,headline,description,affected_area,issued_at,expires_at,alert_status,source_url')
        .eq('source_agency','NDMA SACHET')
        .order('issued_at',{ascending:false}).limit(50);
      if(alertError)throw alertError;

      const now=Date.now();
      const classified=(official||[]).map(item=>{
        const expiry=item.expires_at?new Date(item.expires_at).getTime():NaN;
        const storedStatus=String(item.alert_status||'unknown').toLowerCase();
        const status=storedStatus==='cancelled'?'cancelled'
          :Number.isFinite(expiry)?(expiry<=now?'expired':'active')
          :'unknown';
        return {...item,status,source_url:safeBulletinUrl(item.source_url)};
      });
      state.officialAlerts=classified.map(item=>({
        source:item.source_agency,title:item.headline,area:item.affected_area,
        severity:item.severity,issuedAt:item.issued_at,expiresAt:item.expires_at,
        status:item.status,description:item.description,sourceUrl:item.source_url
      }));

      const active=classified.filter(item=>item.status==='active');
      const expired=classified.filter(item=>item.status==='expired');
      const unknown=classified.filter(item=>item.status==='unknown');
      const cancelled=classified.filter(item=>item.status==='cancelled');
      const feed=feedResult.data||{};
      const refreshNote=feedResult.error
        ?'Feed refresh did not complete; showing saved database records.'
        :feed.stale?'NDMA feed returned a stale cached snapshot.'
        :feed.cached?'NDMA feed checked · cached RSS snapshot; CAP records read from Supabase.'
        :'NDMA feed checked · saved CAP records read from Supabase.';
      const capCount=Number(feed.capEnriched)||0;
      const meta='<div class="info-strip">'+escapeHTML(refreshNote)+' '+classified.length+' saved alert record(s) · '+capCount+' CAP document(s) enriched in this refresh. All displayed timestamps use IST.</div>';

      const card=item=>{
        const statusLabel=item.status==='active'?'ACTIVE · EXPIRY VERIFIED'
          :item.status==='expired'?'EXPIRED · HISTORICAL'
          :item.status==='cancelled'?'CANCELLED BY ISSUER':'VALIDITY UNKNOWN';
        const severity=String(item.severity||'Not specified');
        const description=item.description?'<p>'+escapeHTML(item.description)+'</p>':'';
        return '<article class="content-card" style="margin-top:10px"><div class="api-diagnostics-head"><div><span class="status-pill '+(item.status==='active'?'good':item.status==='expired'?'':'warn')+'">'+statusLabel+'</span><span class="status-pill">'+escapeHTML(severity.toUpperCase())+'</span><h3 style="margin-top:10px">'+escapeHTML(item.headline||'Official disaster alert')+'</h3></div><span class="metric-foot">'+escapeHTML(item.hazard_type||'Official alert')+'</span></div><div class="coverage"><div class="list-row"><span>ISSUING AGENCY</span><strong>'+escapeHTML(item.source_agency||'NDMA SACHET')+'</strong></div><div class="list-row"><span>AFFECTED DISTRICTS / AREA</span><strong>'+escapeHTML(item.affected_area||'Not specified in CAP document')+'</strong></div><div class="list-row"><span>ISSUED</span><strong>'+escapeHTML(formatIST(item.issued_at))+'</strong></div><div class="list-row"><span>EXPIRES</span><strong>'+escapeHTML(formatIST(item.expires_at))+'</strong></div>'+description+'<a class="text-link" href="'+escapeHTML(item.source_url)+'" target="_blank" rel="noopener noreferrer">Open original NDMA bulletin ↗</a></div></article>';
      };
      const section=(heading,description,items,empty)=>{
        return '<section style="margin-top:14px"><div class="api-diagnostics-head"><div><h3>'+heading+' ('+items.length+')</h3><p>'+description+'</p></div></div>'+(items.length?items.map(card).join(''):'<div class="info-strip">'+empty+'</div>')+'</section>';
      };
      alerts.dataset.feedState=feed.stale?'stale':feed.cached?'cached':'checked';
      alerts.innerHTML=meta
        +section('ACTIVE OFFICIAL WARNINGS','Only records with a verified future CAP expiry appear here.',active,'No verified unexpired NDMA warnings are currently stored. Check the official NDMA and IMD portals for the latest advisories.')
        +section('EXPIRED WARNINGS','Historical bulletins retained for traceability; these are not live emergencies.',expired,'No expired warning records.')
        +section('CANCELLED WARNINGS','Cancellation status supplied by the issuing authority.',cancelled,'No cancelled warning records.')
        +section('VALIDITY NOT CONFIRMED','Expiry is missing or could not be verified. These are not labelled active.',unknown,'No records with unknown validity.');
    }catch(error){
      river.textContent='Could not load stored flood data: '+error.message;
      alerts.innerHTML='<div class="info-strip warning-strip">Could not load enriched official warning records: '+escapeHTML(error.message)+'. Use the official NDMA and IMD portals below to verify current warnings.</div>';
    }
  }
  function cyclonePage() {
    const records=state.cycloneRecords||[];
    const official=records.filter(r=>r.kind==='official_alert');
    const global=records.filter(r=>r.kind==='global_event');
    const active=records.filter(r=>r.status==='active'||r.status==='event record · verify latest bulletin');
    const expired=records.filter(r=>r.status==='expired');
    const rows=records.map((r,i)=>`<tr><td><strong>${escapeHTML(r.title)}</strong><div class="cyclone-row-sub">${escapeHTML(r.event||'Tropical cyclone')} · ${escapeHTML(r.source)}</div></td><td>${escapeHTML(r.severity||'Not specified')}</td><td>${escapeHTML(r.area||'Not specified')}</td><td>${r.issuedAt?escapeHTML(new Date(r.issuedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})):'Not supplied'}</td><td><span class="status-pill ${r.status==='expired'?'off':r.status==='active'?'warn':'off'}">${escapeHTML(r.status||'Unknown')}</span></td><td><a class="text-link" href="${escapeHTML(r.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></td></tr>`).join('');
    const sourceRows=(state.cycloneSources||[]).map(s=>`<div class="list-row"><span>${escapeHTML(s.name)}</span><strong class="${s.ok?'':'cyclone-source-error'}">${s.ok?'CONNECTED':'UNAVAILABLE'}${s.error?' · '+escapeHTML(s.error):''}</strong></div>`).join('');
    const dateDefault=new Date().toISOString().slice(0,10);
    return `${pageHeading('Cyclone Intelligence','Multi-source tropical cyclone monitoring · official alerts · global events · offline cache',`<button class="primary-btn" id="refreshCyclone">↻ Refresh sources</button>`)}
      <div class="cyclone-hero">
        <div><div class="eyebrow">FORECASTRA · NORTH INDIAN OCEAN WATCH</div><h2>CYCLONE SITUATIONAL AWARENESS</h2><p>Live official bulletins and global event records, with cached last-known data when offline.</p></div>
        <div class="cyclone-updated"><span id="cycloneConnection" class="status-pill off">${state.cycloneOffline?'OFFLINE CACHE':records.length?'DATA LOADED':'AWAITING REFRESH'}</span><small>Last successful retrieval</small><strong>${state.cycloneFetchedAt?escapeHTML(new Date(state.cycloneFetchedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})):'Not available'}</strong></div>
      </div>
      <div class="metric-grid cyclone-metrics">
        ${metric('TRACK / ALERT RECORDS',records.length,'','Current query results')}
        ${metric('OFFICIAL BULLETINS',official.length,'','IMD CAP + NDMA SACHET')}
        ${metric('GLOBAL EVENTS',global.length,'','GDACS tropical cyclone feed')}
        ${metric('EXPIRED BULLETINS',expired.length,'','Shown separately · never live')}
      </div>
      <div class="cyclone-toolbar content-card">
        <div class="cyclone-mode"><button class="small-btn ${state.cycloneMode==='current'?'active':''}" id="cycloneCurrent">Current monitoring</button><button class="small-btn ${state.cycloneMode==='history'?'active':''}" id="cycloneHistory">Historical search</button></div>
        <div class="cyclone-dates"><label>From <input type="date" id="cycloneFrom" value="${state.cycloneFrom||new Date(Date.now()-30*86400000).toISOString().slice(0,10)}"></label><label>To <input type="date" id="cycloneTo" value="${state.cycloneTo||dateDefault}"></label><button class="secondary-btn" id="runCycloneSearch">Load records</button></div>
      </div>
      <div class="two-col cyclone-grid">
        <div class="content-card"><div class="cyclone-section-head"><h3>GLOBAL TRACKING MAP</h3><span>Observed event coordinates only · no forecast cone unless source supplies one</span></div><div class="map-card cyclone-map"><div id="cycloneGlobe" class="map-canvas"></div><div class="map-foot" id="cycloneMapFoot">SATELLITE BASEMAP · CYCLONE POINTS LOAD FROM VERIFIED FEEDS</div></div><div class="cyclone-legend"><span><i class="legend-dot official"></i>Official alerts</span><span><i class="legend-dot global"></i>GDACS events</span><span><i class="legend-dot location"></i>Selected location</span></div></div>
        <div class="side-stack">
          <div class="content-card"><h3>FEED CONNECTIVITY</h3><p>Each provider is reported independently. A failed feed does not erase successful sources.</p><div id="cycloneSources">${sourceRows||'<div class="coverage">Refresh to test the feeds.</div>'}</div></div>
          <div class="content-card"><h3>OFFICIAL WARNING PORTALS</h3>
            <div class="list-row"><span>IMD · Cyclone warnings</span><a class="text-link" href="https://mausam.imd.gov.in/" target="_blank" rel="noopener noreferrer">Open ↗</a></div>
            <div class="list-row"><span>RSMC New Delhi · bulletins & best tracks</span><a class="text-link" href="https://rsmcnewdelhi.imd.gov.in/" target="_blank" rel="noopener noreferrer">Open ↗</a></div>
            <div class="list-row"><span>NDMA SACHET · public alerts</span><a class="text-link" href="https://sachet.ndma.gov.in/" target="_blank" rel="noopener noreferrer">Open ↗</a></div>
            <div class="list-row"><span>GDACS · global events</span><a class="text-link" href="https://www.gdacs.org/" target="_blank" rel="noopener noreferrer">Open ↗</a></div>
          </div>
          <div class="content-card"><h3>HISTORICAL BEST-TRACK ARCHIVE</h3><p>NOAA IBTrACS combines historical best-track records from multiple meteorological agencies. Historical best tracks are not real-time forecasts.</p><a class="text-link" href="https://www.ncei.noaa.gov/products/international-best-track-archive" target="_blank" rel="noopener noreferrer">Open NOAA IBTrACS ↗</a><br><a class="text-link" href="https://rsmcnewdelhi.imd.gov.in/" target="_blank" rel="noopener noreferrer">Open IMD RSMC archives ↗</a></div>
        </div>
      </div>
      <div class="content-card cyclone-records"><div class="cyclone-section-head"><h3>CYCLONE ALERTS & EVENT REGISTER</h3><span>${records.length} records · ${active.length} current/event records · ${expired.length} expired</span></div>
        <div class="info-strip">Official alerts are distinguished from GDACS event records. An event record is not an issuing-agency warning. Missing expiry or location data is shown as unavailable, never inferred.</div>
        <div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>EVENT / ISSUING SOURCE</th><th>SEVERITY</th><th>AREA</th><th>ISSUED (IST)</th><th>VALIDITY</th><th>ORIGINAL SOURCE</th></tr></thead><tbody id="cycloneRecordRows">${rows||'<tr><td colspan="6" class="empty-cell">No cyclone records loaded yet. Select Refresh sources.</td></tr>'}</tbody></table></div>
      </div>
      <div class="info-strip warning-strip">FORECASTRA is a monitoring and research interface, not an emergency-warning authority. For decisions, follow current IMD and NDMA instructions. Forecast tracks, landfall probabilities and storm-surge warnings are not fabricated or inferred from event points.</div>`;
  }
  async function loadCycloneIntel(mode='current'){
    const status=$('cycloneConnection'),rows=$('cycloneRecordRows'),sources=$('cycloneSources');
    if(status){status.textContent='CHECKING SOURCES…';status.className='status-pill warn';}
    if(rows)rows.innerHTML='<tr><td colspan="6" class="empty-cell">Checking official and global cyclone feeds…</td></tr>';
    if(!state.supabase){if(status){status.textContent='SUPABASE NOT CONNECTED';status.className='status-pill off';}if(rows)rows.innerHTML='<tr><td colspan="6" class="empty-cell">Supabase is not configured. Cached records may still be available on this browser.</td></tr>';return;}
    const from=$('cycloneFrom')?.value||new Date(Date.now()-30*86400000).toISOString().slice(0,10);
    const to=$('cycloneTo')?.value||new Date().toISOString().slice(0,10);
    if(from>to){statusToast('Start date must be before end date.',true);return;}
    try{
      const {data,error}=await state.supabase.functions.invoke('forecastra-cyclone-intel',{body:{mode,from,to}});
      if(error)throw new Error(error.message||'Cyclone intelligence request failed.');
      if(data?.error)throw new Error(data.error);
      state.cycloneRecords=Array.isArray(data.records)?data.records:[];
      state.cycloneSources=Array.isArray(data.sources)?data.sources:[];
      state.cycloneFetchedAt=data.fetchedAt||new Date().toISOString();state.cycloneOffline=false;
      try{localStorage.setItem('forecastraCycloneCache',JSON.stringify({records:state.cycloneRecords,sources:state.cycloneSources,fetchedAt:state.cycloneFetchedAt}));}catch(e){console.warn('Cyclone cache could not be saved',e);}
      if(status){const ok=state.cycloneSources.filter(s=>s.ok).length;status.textContent=ok+' / '+state.cycloneSources.length+' FEEDS ONLINE';status.className='status-pill '+(ok?'':'off');}
      if(sources)sources.innerHTML=state.cycloneSources.map(s=>'<div class="list-row"><span>'+escapeHTML(s.name)+'</span><strong class="'+(s.ok?'':'cyclone-source-error')+'">'+(s.ok?'CONNECTED':'UNAVAILABLE')+(s.error?' · '+escapeHTML(s.error):'')+'</strong></div>').join('');
      renderCycloneRows();drawCycloneEntities();
      const foot=$('cycloneMapFoot');if(foot)foot.textContent='FEED RETRIEVAL · '+new Date(state.cycloneFetchedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST';
    }catch(error){
      console.error('Cyclone feed refresh failed',error);
      try{const cache=JSON.parse(localStorage.getItem('forecastraCycloneCache')||'null');if(cache?.records){state.cycloneRecords=cache.records;state.cycloneSources=cache.sources||[];state.cycloneFetchedAt=cache.fetchedAt;state.cycloneOffline=true;renderCycloneRows();drawCycloneEntities();if(sources)sources.innerHTML='<div class="info-strip warning-strip">Live refresh failed. Showing this browser’s previously cached records.</div>';if(status){status.textContent='OFFLINE · CACHED DATA';status.className='status-pill off';}return;}}catch(cacheError){console.warn(cacheError);}
      if(status){status.textContent='FEED ERROR';status.className='status-pill off';}
      if(rows)rows.innerHTML='<tr><td colspan="6" class="empty-cell">'+escapeHTML(error.message)+'</td></tr>';
      if(sources)sources.innerHTML='<div class="info-strip warning-strip">'+escapeHTML(error.message)+'</div>';
    }
  }
  function renderCycloneRows(){
    const rows=$('cycloneRecordRows');if(!rows)return;
    const records=state.cycloneRecords||[];
    if(!records.length){rows.innerHTML='<tr><td colspan="6" class="empty-cell">No cyclone records in this period. This does not prove there is no local weather hazard; check official IMD bulletins.</td></tr>';return;}
    rows.innerHTML=records.map(r=>'<tr><td><strong>'+escapeHTML(r.title)+'</strong><div class="cyclone-row-sub">'+escapeHTML(r.event||'Tropical cyclone')+' · '+escapeHTML(r.source)+'</div></td><td>'+escapeHTML(r.severity||'Not specified')+'</td><td>'+escapeHTML(r.area||'Not specified')+'</td><td>'+(r.issuedAt?escapeHTML(new Date(r.issuedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})):'Not supplied')+'</td><td><span class="status-pill '+(r.status==='expired'?'off':r.status==='active'?'warn':'off')+'">'+escapeHTML(r.status||'Unknown')+'</span></td><td><a class="text-link" href="'+escapeHTML(r.url)+'" target="_blank" rel="noopener noreferrer">Source ↗</a></td></tr>').join('');
  }
  function drawCycloneEntities(){
    const viewer=state.viewer,C=window.Cesium;if(!viewer||viewer.isDestroyed?.()||!C)return;
    viewer.entities.values.filter(e=>e.properties?.forecastraCyclone?.getValue?.()).forEach(e=>viewer.entities.remove(e));
    for(const r of state.cycloneRecords||[]){
      const point=r.geometry;if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon))continue;
      const official=r.kind==='official_alert';
      viewer.entities.add({position:C.Cartesian3.fromDegrees(point.lon,point.lat),point:{pixelSize:official?13:10,color:official?C.Color.fromCssColorString('#ffb34b'):C.Color.fromCssColorString('#ff5d70'),outlineColor:C.Color.WHITE,outlineWidth:2},label:{text:String(r.title||'Cyclone').slice(0,40),font:'11px sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:C.VerticalOrigin.BOTTOM,pixelOffset:new C.Cartesian2(0,-12),scaleByDistance:new C.NearFarScalar(1e6,1,1.5e7,.45)},properties:{forecastraCyclone:true,source:r.source,url:r.url}});
    }
  }
  function restoreCycloneCache(){
    try{const cache=JSON.parse(localStorage.getItem('forecastraCycloneCache')||'null');if(cache?.records){state.cycloneRecords=cache.records;state.cycloneSources=cache.sources||[];state.cycloneFetchedAt=cache.fetchedAt;state.cycloneOffline=true;}}catch{}
  }
  function climatePage() {
    return `${pageHeading('Climate Analytics','Explore recent weather patterns; short-term weather is not the same as long-term climate')}
      <div class="info-strip">This workspace currently summarizes recent daily weather data. A climate-trend study needs longer, quality-controlled records, reference periods and appropriate statistical methods.</div>
      <div class="metric-grid">${metric('DAILY MAX TEMP',num(state.weather?.daily?.temperature_2m_max?.[0]),'°C','Today forecast')}${metric('DAILY MIN TEMP',num(state.weather?.daily?.temperature_2m_min?.[0]),'°C','Today forecast')}${metric('WEEK RAIN TOTAL',num(state.weather?.daily?.precipitation_sum?.reduce((s,v)=>s+(Number(v)||0),0)),'mm','Available forecast days')}${metric('MAX WIND',num(Math.max(0,...(state.weather?.daily?.wind_speed_10m_max||[]))),'km/h','Forecast period')}</div>
      <div class="two-col">${panel('TEMPERATURE RANGE','Daily forecast · °C',`<div class="chart-box"><canvas id="climateTempChart"></canvas></div>`)}${panel('PRECIPITATION PATTERN','Daily forecast · mm',`<div class="chart-box"><canvas id="climateRainChart"></canvas></div>`)}</div>`;
  }
  function disasterPage() {
    const a=state.alertMetrics,records=state.hazardRecords||[];
    const counts={};records.forEach(r=>counts[r.hazard]=(counts[r.hazard]||0)+1);
    const rows=records.map(r=>`<tr><td><strong>${escapeHTML(r.title)}</strong><div class="cyclone-row-sub">${escapeHTML(r.source)} · ${escapeHTML(r.hazard)}</div></td><td>${escapeHTML(r.severity||'Not specified')}</td><td>${escapeHTML(r.area||'Not specified')}</td><td>${r.issuedAt?escapeHTML(new Date(r.issuedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})):'Not supplied'}</td><td><a class="text-link" href="${escapeHTML(r.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></td></tr>`).join('');
    const links=[['NDMA SACHET · National multi-hazard alerts','https://sachet.ndma.gov.in/'],['IMD · Weather, cyclone, heat and cold warnings','https://mausam.imd.gov.in/'],['CWC · River and flood forecasts','https://cwc.gov.in/'],['INCOIS · Tsunami and ocean alerts','https://incois.gov.in/'],['GSI · Landslide information','https://www.gsi.gov.in/'],['Forest Survey of India · Fire alerts','https://fsi.nic.in/'],['National Centre for Seismology · Earthquakes','https://seismo.gov.in/']];
    return `${pageHeading('Disaster Monitoring','Multi-hazard alerts · earthquakes · floods · fires · ocean hazards · droughts',`<button class="primary-btn" id="refreshHazards">↻ Refresh all hazards</button>`)}
      <div class="info-strip warning-strip">Official warnings are reproduced from source feeds where available. Global event records are monitoring data, not local government evacuation instructions. A missing alert does not mean there is no danger.</div>
      <div class="cyclone-hero"><div><div class="eyebrow">FORECASTRA · MULTI-HAZARD INTELLIGENCE</div><h2>ALL-HAZARD SITUATIONAL AWARENESS</h2><p>Current event records, source status and last-known offline cache.</p></div><div class="cyclone-updated"><span class="status-pill ${state.hazardOffline?'off':'warn'}" id="hazardStatus">${state.hazardOffline?'OFFLINE CACHE':state.hazardFetchedAt?'DATA CACHED':'AWAITING REFRESH'}</span><small>Last successful refresh</small><strong>${state.hazardFetchedAt?escapeHTML(new Date(state.hazardFetchedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})):'Not available'}</strong></div></div>
      <div class="metric-grid cyclone-metrics">${metric('ALL EVENTS',records.length,'','Selected date range')}${metric('EARTHQUAKES',counts.Earthquake||0,'','USGS observed events')}${metric('FLOOD EVENTS',counts.Flood||0,'','GDACS records')}${metric('WILDFIRES',counts.Wildfire||0,'','GDACS records')}</div>
      <div class="content-card cyclone-toolbar"><div class="cyclone-dates"><label>From <input type="date" id="hazardFrom" value="${state.hazardFrom||dateAgo(30)}"></label><label>To <input type="date" id="hazardTo" value="${state.hazardTo||isoDate(new Date())}"></label><button class="secondary-btn" id="loadHazardHistory">Load date range</button></div><span class="text-muted">Up to 10 years per query</span></div>
      <div class="two-col cyclone-grid"><div class="content-card"><div class="cyclone-section-head"><h3>GLOBAL MULTI-HAZARD EVENT REGISTER</h3><span id="hazardRecordCount">${records.length} records</span></div><div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>EVENT / SOURCE</th><th>LEVEL / MAGNITUDE</th><th>AREA</th><th>EVENT TIME (IST)</th><th>DETAILS</th></tr></thead><tbody id="hazardRows">${rows||'<tr><td colspan="5" class="empty-cell">Select Refresh all hazards to retrieve records.</td></tr>'}</tbody></table></div></div>
      <div class="side-stack"><div class="content-card"><h3>OFFICIAL INDIA WARNING PORTALS</h3>${links.map(x=>`<div class="list-row"><span>${escapeHTML(x[0])}</span><a class="text-link" href="${x[1]}" target="_blank" rel="noopener noreferrer">Open ↗</a></div>`).join('')}</div><div class="content-card"><h3>FEED CONNECTIVITY</h3><div id="hazardSources">${(state.hazardSources||[]).map(s=>`<div class="list-row"><span>${escapeHTML(s.name)}</span><strong>${s.ok?'CONNECTED':'UNAVAILABLE'}</strong></div>`).join('')||'Refresh to test each source.'}</div></div></div></div>
      <div class="info-strip">Connected event feeds currently include GDACS categories and USGS earthquakes. Direct official India CAP alerts and long-term historical archives still require additional source-specific integration.</div>`;
  }
  async function loadMultiHazards(){
    const status=$('hazardStatus'),rows=$('hazardRows'),sources=$('hazardSources');
    const from=$('hazardFrom')?.value||dateAgo(30),to=$('hazardTo')?.value||isoDate(new Date());
    if(from>to){statusToast('Start date must be before end date.',true);return;}
    if(!state.supabase){if(status){status.textContent='SUPABASE NOT CONNECTED';status.className='status-pill off';}return;}
    if(status){status.textContent='CHECKING SOURCES…';status.className='status-pill warn';}
    if(rows)rows.innerHTML='<tr><td colspan="5" class="empty-cell">Retrieving global hazard feeds…</td></tr>';
    try{
      const {data,error}=await state.supabase.functions.invoke('forecastra-multihazard',{body:{mode:'history',from,to}});
      if(error)throw new Error(error.message||'Multi-hazard feed request failed.');
      if(data?.error)throw new Error(data.error);
      state.hazardRecords=Array.isArray(data.records)?data.records:[];
      state.hazardSources=Array.isArray(data.sources)?data.sources:[];
      state.hazardFetchedAt=data.fetchedAt||new Date().toISOString();state.hazardOffline=false;
      try{localStorage.setItem('forecastraHazardCache',JSON.stringify({records:state.hazardRecords,sources:state.hazardSources,fetchedAt:state.hazardFetchedAt}));}catch(e){console.warn('Hazard cache write failed',e);}
      renderHazardRows();
      if(status){const ok=state.hazardSources.filter(s=>s.ok).length;status.textContent=ok+'/'+state.hazardSources.length+' SOURCES ONLINE';status.className='status-pill '+(ok?'':'off');}
      if(sources)sources.innerHTML=state.hazardSources.map(s=>'<div class="list-row"><span>'+escapeHTML(s.name)+'</span><strong class="'+(s.ok?'':'cyclone-source-error')+'">'+(s.ok?'CONNECTED':'UNAVAILABLE')+(s.error?' · '+escapeHTML(s.error):'')+'</strong></div>').join('');
    }catch(error){
      console.error('Multi-hazard refresh failed',error);
      try{const cache=JSON.parse(localStorage.getItem('forecastraHazardCache')||'null');if(cache?.records){state.hazardRecords=cache.records;state.hazardSources=cache.sources||[];state.hazardFetchedAt=cache.fetchedAt;state.hazardOffline=true;renderHazardRows();if(status){status.textContent='OFFLINE · CACHED DATA';status.className='status-pill off';}if(sources)sources.innerHTML='<div class="info-strip warning-strip">Showing previously cached records; live refresh failed.</div>';return;}}catch{}
      if(status){status.textContent='FEED ERROR';status.className='status-pill off';}
      if(rows)rows.innerHTML='<tr><td colspan="5" class="empty-cell">'+escapeHTML(error.message)+'</td></tr>';
    }
  }
  function renderHazardRows(){
    const rows=$('hazardRows');if(!rows)return;const records=state.hazardRecords||[];
    rows.innerHTML=records.length?records.map(r=>'<tr><td><strong>'+escapeHTML(r.title)+'</strong><div class="cyclone-row-sub">'+escapeHTML(r.source)+' · '+escapeHTML(r.hazard)+'</div></td><td>'+escapeHTML(r.severity||'Not specified')+'</td><td>'+escapeHTML(r.area||'Not specified')+'</td><td>'+(r.issuedAt?escapeHTML(new Date(r.issuedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})):'Not supplied')+'</td><td><a class="text-link" href="'+escapeHTML(r.url)+'" target="_blank" rel="noopener noreferrer">Source ↗</a></td></tr>').join(''):'<tr><td colspan="5" class="empty-cell">No events returned for this period. This does not establish that no hazard exists.</td></tr>';
    const count=$('hazardRecordCount');if(count)count.textContent=records.length+' records';
  }
  function restoreHazardCache(){try{const c=JSON.parse(localStorage.getItem('forecastraHazardCache')||'null');if(c?.records){state.hazardRecords=c.records;state.hazardSources=c.sources||[];state.hazardFetchedAt=c.fetchedAt;state.hazardOffline=true;}}catch{}}
  async function loadArchive(start, end) {
    const params = new URLSearchParams({ latitude:state.location.lat, longitude:state.location.lon, start_date:start, end_date:end, daily:'temperature_2m_max,temperature_2m_min,precipitation_sum', timezone:'auto' });
    return getJSON(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  }
  function historicalPage() {
    return `${pageHeading('Historical Explorer','Query available historical weather records for the selected coordinate')}
      <div class="content-card" style="margin-bottom:14px"><div class="form-grid"><div class="field"><label for="historyStart">START DATE</label><input id="historyStart" type="date" value="${dateAgo(30)}" max="${dateAgo(6)}"></div><div class="field"><label for="historyEnd">END DATE</label><input id="historyEnd" type="date" value="${dateAgo(6)}" max="${dateAgo(6)}"></div></div><div style="margin-top:12px;display:flex;justify-content:flex-end"><button class="primary-btn" id="loadHistory">Load historical data</button></div></div>
      <div class="report-actions" style="margin:-2px 0 13px"><button class="secondary-btn" id="loadVisualHistory">Load Visual Crossing last 30 days (optional)</button></div>
      <div id="historyOutput">${panel('HISTORICAL DATA','',`<div class="coverage">Choose a date range and load archive data. Historical availability depends on the source dataset and location.</div>`)}</div>`;
  }
  function chatMarkup() {
    return `${pageHeading('Research AI','Ask environmental questions, analyse datasets and draft research summaries')}
      <div class="chat-layout"><section class="chat-shell"><div class="chat-head"><div class="ai-badge">F</div><div class="chat-head-copy"><strong>FORECASTRA Research AI</strong><div>Environmental research assistant · powered by your configured Groq model</div></div><span class="status-pill ${state.config.groqConfigured?'':'off'}" id="aiConnectionStatus">${state.config.groqConfigured?'CONNECTED':state.supabase?'ENDPOINT LINKED · GROQ UNVERIFIED':'SUPABASE NOT CONNECTED'}</span></div>
      <div class="chat-stream" id="chatStream"><div class="chat-welcome"><div class="ai-badge">F</div><h2>What would you like to investigate?</h2><p>Ask about weather, rainfall, climate records, flood screening or an uploaded dataset. I will separate observations, forecasts and estimates, and point out data limitations.</p><div class="suggestions"><button class="suggestion" data-prompt="Summarise the current weather at my selected location.">Summarise current weather</button><button class="suggestion" data-prompt="Explain the rainfall signals relevant to flood screening at this location.">Explain flood indicators</button><button class="suggestion" data-prompt="Help me design a fair comparison between baseline flood model A and enhanced model B.">Compare flood models</button><button class="suggestion" data-prompt="Analyse the dataset I uploaded and explain its main trends and limitations.">Analyse uploaded data</button></div></div></div>
      <form class="chat-compose" id="chatForm"><div class="composer-box"><textarea id="chatInput" rows="1" placeholder="Message FORECASTRA…" aria-label="Message FORECASTRA"></textarea><div class="composer-tools"><div class="composer-left"><button type="button" class="tool-btn" id="micButton" title="Dictate your message">🎙 Microphone</button><button type="button" class="tool-btn" id="talkButton" title="Start voice conversation">◉ Talk mode</button><span class="tool-status" id="voiceStatus">Enter to send · Shift + Enter for a new line</span></div><button class="send-btn" id="chatSend" type="submit" aria-label="Send message">↑</button></div></div><div class="composer-disclaimer">AI analysis can be incomplete · Not an official emergency warning</div></form></section>
      <aside class="chat-context"><div class="context-card"><h3>SELECTED CONTEXT</h3><p><strong style="color:var(--text)">${escapeHTML(state.location.name)}</strong><br>${state.location.lat.toFixed(4)}°, ${state.location.lon.toFixed(4)}°<br>${state.weather?.current ? `${num(state.weather.current.temperature_2m)}°C · ${weatherDescription(state.weather.current.weather_code)}` : 'Weather data unavailable'}</p></div><div class="context-card"><h3>AVAILABLE DATA</h3><ul><li>Current weather and forecast</li><li>Rainfall screening indicators</li><li>Selected elevation grid</li><li>${state.dataset ? `Uploaded dataset: ${escapeHTML(state.dataset.name)}` : 'No user dataset loaded'}</li></ul></div><div class="context-card"><h3>VOICE CONTROLS</h3><p>Microphone transcribes speech into the text box. Talk mode listens for a spoken question and reads the reply aloud. Browser speech support varies.</p><button class="secondary-btn context-action" data-start-talk>Start talk mode</button></div></aside></div>`;
  }
  function dataLabPage() {
    return `${pageHeading('Data Laboratory','Upload CSV, Excel or JSON files for descriptive statistics and exploratory analysis')}
      <div class="upload-zone"><strong>Drop a dataset here or choose a file</strong><p>Supported: .csv, .xlsx, .xls, .json · Data is processed in this browser session</p><input id="dataFile" type="file" accept=".csv,.xlsx,.xls,.json,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
      <div id="datasetOutput" style="margin-top:14px">${panel('DATASET WORKSPACE','',`<div class="coverage">No dataset loaded. Upload a table to calculate count, mean, minimum, maximum, standard deviation and simple outlier flags for numeric columns. Avoid uploading private or sensitive personal information.</div>`)}</div>`;
  }
  function reportsPage() {
    return `${pageHeading('Reports','Generate a shareable snapshot from the currently loaded environmental context')}
      <div class="two-col"><div class="content-card"><h3>REPORT CONTENT</h3><p>Current selected location, available weather observations and forecast values, screening indicators, data-source status and optional uploaded-dataset summary.</p><div class="report-actions" style="margin-top:16px"><button class="primary-btn" id="exportJson">Export JSON report</button><button class="secondary-btn" id="exportCsv">Export forecast CSV</button><button class="secondary-btn" id="printReport">Print / Save as PDF</button></div></div><div class="content-card"><h3>REPORT LIMITATIONS</h3><p>Hazard indicators are not official alerts or validated probabilities. Forecast-grid values are not station observations. AI summaries may contain errors and should be checked against source data.</p></div></div>`;
  }
  function notificationsPage() {
    const a = state.alertMetrics;
    const body = state.notifications.length ? state.notifications.map(item=>`<div class="list-row"><span><span class="status-pill ${item.level==='red'?'warn':''}">${item.level.toUpperCase()}</span> &nbsp;${escapeHTML(item.title)}<div class="metric-foot">${escapeHTML(item.detail)}</div></span><strong>${escapeHTML(state.location.name)}</strong></div>`).join('') : '<div class="coverage">No threshold-based screening indicators are currently active for the selected location. This does not mean hazards are impossible, and this page is not an official alert feed.</div>';
    return `${pageHeading('Notification','Environmental screening notifications and application events')}${panel('LOCAL SCREENING NOTIFICATIONS',`${a.total} indicator(s) · generated from current selected-location weather`,body)}<div class="info-strip" style="margin-top:13px">Official warning notifications are not connected in this build. Check your national and local meteorological or disaster-management authority for alerts.</div>`;
  }
  function renderSecondaryProvider(targetId, stateText, values = null, error = false) {
    const target = $(targetId); if (!target) return;
    if (error) { target.innerHTML = `<span class="overview-provider-error">${escapeHTML(stateText)}</span>`; return; }
    if (!values) { target.textContent = stateText; return; }
    target.innerHTML = `<div class="overview-provider-reading"><strong>${escapeHTML(values.temperature)}</strong><span>°C</span><em>${escapeHTML(values.condition)}</em></div><div class="overview-provider-meta"><span>Humidity ${escapeHTML(values.humidity)}%</span><span>Wind ${escapeHTML(values.wind)} km/h</span></div>`;
  }
  async function refreshAdditionalWeatherProviders() {
    const second = $('overviewProvider2'), third = $('overviewProvider3');
    if (!second || !third) return;
    if (!apiBaseUrl) {
      renderSecondaryProvider('overviewProvider2','Optional provider is not connected in the GitHub + Supabase edition.');
      renderSecondaryProvider('overviewProvider3','Optional provider is not connected in the GitHub + Supabase edition.');
      return;
    }
    renderSecondaryProvider('overviewProvider2','Checking Weather API 2…');
    renderSecondaryProvider('overviewProvider3','Checking Weather API 3…');
    const coordinates = `lat=${encodeURIComponent(state.location.lat)}&lon=${encodeURIComponent(state.location.lon)}`;
    const tasks = await Promise.allSettled([
      getJSON(`/api/weather/2?${coordinates}`),
      getJSON(`/api/weather/3?${coordinates}`)
    ]);
    const a = tasks[0];
    if (a.status === 'fulfilled') {
      const current = a.value.current || {};
      renderSecondaryProvider('overviewProvider2','', {
        temperature: num(current.temp_c,1),
        condition: current.condition?.text || 'Condition unavailable',
        humidity: num(current.humidity,0),
        wind: num(current.wind_kph,1)
      });
    } else renderSecondaryProvider('overviewProvider2',a.reason?.message || 'Weather API 2 unavailable.',true,true);
    const b = tasks[1];
    if (b.status === 'fulfilled') {
      const current = b.value.current || {};
      renderSecondaryProvider('overviewProvider3','', {
        temperature: num(current.main?.temp,1),
        condition: current.weather?.[0]?.description || 'Condition unavailable',
        humidity: num(current.main?.humidity,0),
        wind: num((Number(current.wind?.speed) || 0) * 3.6,1)
      });
    } else renderSecondaryProvider('overviewProvider3',b.reason?.message || 'Weather API 3 unavailable.',true,true);
  }

  function apiManagementPage() {
    const supabaseReady = Boolean(state.config.supabaseUrl && state.config.supabaseAnonKey);
    const services = [
      {name:'GitHub Pages',kind:'Static website hosting',status:'Connected',detail:'FORECASTRA frontend is published from the GitHub repository.',symbol:'⌘'},
      {name:'Supabase',kind:'Authentication · Edge Functions · saved data',status:supabaseReady?'Configured':'Needs setup',detail:supabaseReady?'Project URL and publishable key are configured in the public client settings.':'Set the Supabase project URL and publishable key in docs/config.js.',symbol:'▦'},
      {name:'Groq AI',kind:state.config.groqModel || 'openai/gpt-oss-120b',status:'Public · rate limited',detail:'Research AI is available without an account. Groq credentials remain server-side in Supabase secrets.',symbol:'✳'},
      {name:'Open-Meteo',kind:'Forecast · Geocoding · Elevation',status:'Connected',detail:'Public endpoints provide current conditions, forecasts and elevation.',symbol:'◉'},
      {name:'RainViewer',kind:'Radar tile overlay',status:'Optional',detail:'Public radar tiles. Availability can vary by provider.',symbol:'⌁'},
      {name:'Cesium ion',kind:'Globe assets · Terrain',status:state.config.cesiumToken?'Configured':'Optional',detail:state.config.cesiumToken?'A browser-visible token is configured; restrict it to this site.':'The globe can use its available fallback without a Cesium token.',symbol:'◎'}
    ];
    const configuredCount=services.filter(s=>['Connected','Configured','Server-side'].includes(s.status)).length;
    const cards=services.map(service=>`
      <article class="api-service-card"><div class="api-service-icon" aria-hidden="true">${service.symbol}</div>
        <div class="api-service-main"><div class="api-service-top"><h3>${service.name}</h3><span class="status-pill">${service.status}</span></div>
        <div class="api-service-kind">${service.kind}</div><p>${service.detail}</p></div></article>`).join('');
    return `
      <div class="api-page">
        <div class="api-page-heading"><div><div class="api-overline">PLATFORM CONFIGURATION / CONNECTIVITY</div><h1>API Management</h1><p>GitHub-hosted interface with a secure Supabase AI backend.</p></div>
          <div class="api-heading-actions"><button class="secondary-btn" id="refreshHealth">↻ &nbsp;Refresh status</button></div></div>
        <section class="api-summary"><div class="api-summary-copy"><span class="api-summary-label">INTEGRATION OVERVIEW</span><strong>${configuredCount}<small> / ${services.length}</small></strong><span>services configured or available</span></div>
          <div class="api-summary-note"><span class="api-summary-dot"></span><span>Private provider credentials stay in Supabase Edge Function secrets.</span></div></section>
        <div class="api-section-head"><div><h2>CONNECTED SERVICES</h2><p>Cloudflare is not part of this deployment.</p></div><span class="api-section-meta">SERVICE DIRECTORY</span></div>
        <div class="api-service-grid">${cards}</div>
        <section class="api-diagnostics"><div class="api-diagnostics-head"><div><h2>CONNECTION DIAGNOSTICS</h2><p>Check the Supabase project connection.</p></div><span class="api-diagnostics-mark">LIVE</span></div>
          <div class="api-endpoint"><span>SUPABASE PROJECT</span><code>${supabaseReady?'Configured':'Not configured'}</code></div>
          <div class="api-endpoint"><span>AI FUNCTION</span><code>forecastra-ai</code></div>
          <div class="api-endpoint"><span>AI MODEL</span><code>${state.config.groqModel || 'openai/gpt-oss-120b'}</code></div>
          <div class="api-diagnostic-actions"><button class="secondary-btn" id="testGroqModels">AI connection information</button></div>
          <div id="healthResult" class="api-health-result" aria-live="polite">Refresh status to inspect Supabase configuration.</div>
        </section>
        <div class="api-security-note"><strong>Security note</strong><span>Never put Groq keys, Supabase secret keys or service-role keys in public JavaScript. Store Groq credentials as Supabase Edge Function secrets.</span></div>
      </div>`;
  }
  function settingsPage() {
    return `${pageHeading('Settings','Configure display preferences and workspace behaviour')}
      <div class="two-col"><div class="content-card"><h3>GENERAL PREFERENCES</h3>
        <div class="toggle-row"><div class="toggle-copy"><strong>Light appearance</strong><span>Switch the interface to a light theme</span></div><label class="switch"><input id="lightSetting" type="checkbox" ${document.body.classList.contains('light')?'checked':''}><span></span></label></div>
        <div class="toggle-row"><div class="toggle-copy"><strong>Speak AI replies automatically</strong><span>Used during voice conversation mode</span></div><label class="switch"><input id="autoSpeakSetting" type="checkbox" ${state.settings.autoSpeak?'checked':''}><span></span></label></div>
        <div class="toggle-row"><div class="toggle-copy"><strong>Enable voice features</strong><span>Use browser speech recognition and speech synthesis</span></div><label class="switch"><input id="voiceSetting" type="checkbox" ${state.settings.voice?'checked':''}><span></span></label></div>
        <div class="report-actions" style="margin-top:16px"><button class="primary-btn" id="saveSettings">Save preferences</button></div>
      </div><div class="content-card"><h3>PUBLIC DATA & DATABASE</h3>
        <p>FORECASTRA is running in public mode. No account or login is required. Public environmental datasets are read from Supabase with read-only browser permissions; trusted ingestion runs separately on the backend.</p>
        <div class="list-row"><span>Database</span><strong>${state.supabase?'Connected':'Not connected'}</strong></div>
        <div class="list-row"><span>Public flood observations</span><strong>Read-only</strong></div>
        <div class="list-row"><span>Research AI</span><strong>Public access · rate limited</strong></div>
        <div class="list-row"><span>Official warnings</span><strong>Source-linked</strong></div>
      </div><div class="content-card"><h3>WORKSPACE INFORMATION</h3><div class="list-row"><span>Application</span><strong>FORECASTRA 2.0</strong></div><div class="list-row"><span>Project</span><strong>Quantum Minds</strong></div><div class="list-row"><span>Default location</span><strong>Chennai, India</strong></div><div class="list-row"><span>Map engine</span><strong>CesiumJS</strong></div><div class="list-row"><span>Weather source</span><strong>Open-Meteo</strong></div><div class="list-row"><span>AI provider</span><strong>${state.config.groqConfigured?'Groq':'Not configured'}</strong></div></div></div>`;
  }
  function renderPage() {
    destroyCharts(); destroyGlobe();
    const view = $('pageView');
    const templates = {
      'Global Intelligence': globalIntelligencePage,
      'Overview': overviewPage,
      '3D Earth': globePage,
      'Weather': weatherPage,
      'Rainfall': rainfallPage,
      'Flood Intelligence': floodPage,
      'Cyclone Tracking': cyclonePage,
      'Climate Analytics': climatePage,
      'Disaster Monitoring': disasterPage,
      'Historical Explorer': historicalPage,
      'Research AI': chatMarkup,
      'Data Laboratory': dataLabPage,
      'Reports': reportsPage,
      'Notification': notificationsPage,
      'API Management': apiManagementPage,
      'Settings': settingsPage
    };
    view.innerHTML = (templates[state.page] || globalIntelligencePage)();
    $('topTitle').textContent = state.page;
    $('topKicker').textContent = ({'Global Intelligence':'WORLDWIDE SITUATIONAL PICTURE','3D Earth':'GLOBAL OBSERVATION','Research AI':'ENVIRONMENTAL RESEARCH ASSISTANT','Data Laboratory':'DATA ANALYSIS WORKSPACE','API Management':'CONNECTED SERVICES','Settings':'WORKSPACE CONFIGURATION'}[state.page] || 'ENVIRONMENTAL INTELLIGENCE WORKSPACE');
    document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === state.page));
    bindPageEvents();
    if (state.page === 'Overview') refreshAdditionalWeatherProviders();
    if (state.page === 'Global Intelligence') { createGlobe('globalGlobe'); }
    if (state.page === '3D Earth' || state.page === 'Cyclone Tracking') { createGlobe(state.page==='3D Earth'?'earthGlobe':'cycloneGlobe', true); }
    renderChartsForPage();
    if (state.page === 'Research AI') renderChatHistory();
  }
  function chart(id, type, labels, datasets, options = {}) {
    const canvas = $(id); if (!canvas || !window.Chart) return;
    const textColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#8799ad';
    const lineColor = getComputedStyle(document.body).getPropertyValue('--line').trim() || '#20354b';
    const base = { responsive:true, maintainAspectRatio:false, animation:false, interaction:{ intersect:false, mode:'index' }, plugins:{ legend:{ labels:{ color:textColor, boxWidth:10, usePointStyle:true, font:{size:10} } } }, scales:{ x:{ ticks:{ color:textColor, maxTicksLimit:8, font:{size:9} }, grid:{ color:lineColor } }, y:{ ticks:{ color:textColor, font:{size:9} }, grid:{ color:lineColor } } } };
    state.charts[id] = new Chart(canvas, { type, data:{ labels, datasets }, options:{ ...base, ...options } });
  }
  function renderChartsForPage() {
    const weather = state.weather; if (!weather) return;
    const currentIndex = Math.max(0, weather.hourly.time.findIndex(t => t >= weather.current.time));
    const hourlyTimes = weather.hourly.time.slice(Math.max(0,currentIndex-12),currentIndex+48);
    const hourStart = Math.max(0,currentIndex-12), hourEnd = Math.min(weather.hourly.time.length,currentIndex+48);
    const hourlyLabels = hourlyTimes.map(t=>t.slice(5,16).replace('T',' '));
    if (state.page === 'Overview') {
      chart('overviewChart','line',hourlyLabels,[{label:'Temperature °C',data:weather.hourly.temperature_2m.slice(hourStart,hourEnd),borderColor:'#d6edf4',backgroundColor:'rgba(146,207,222,.10)',fill:true,tension:.34,pointRadius:0,borderWidth:2}],{plugins:{legend:{display:false},tooltip:{enabled:true}},scales:{x:{grid:{display:false},ticks:{color:'#90a9b8',maxTicksLimit:6,font:{size:8}}},y:{grid:{color:'rgba(173,206,219,.13)'},ticks:{color:'#90a9b8',font:{size:8}}}}});
      chart('overviewWindChart','line',hourlyLabels,[{label:'Wind speed km/h',data:weather.hourly.wind_speed_10m.slice(hourStart,hourEnd).map((value)=>Number(value)),borderColor:'rgba(255,255,255,.9)',backgroundColor:'rgba(255,255,255,.08)',fill:true,tension:.38,pointRadius:0,borderWidth:2}],{plugins:{legend:{display:false},tooltip:{enabled:true}},scales:{x:{display:false,grid:{display:false}},y:{display:false,grid:{display:false}}},elements:{point:{radius:0,hitRadius:5},line:{borderWidth:2}}});
    }
    if (state.page === 'Weather') chart('weatherChart','line',hourlyLabels,[{label:'Temperature °C',data:weather.hourly.temperature_2m.slice(hourStart,hourEnd),borderColor:'#2bc8e8',tension:.3,pointRadius:0},{label:'Wind km/h',data:weather.hourly.wind_speed_10m.slice(hourStart,hourEnd),borderColor:'#f4ab43',tension:.3,pointRadius:0,yAxisID:'y1'}],{scales:{y:{ticks:{color:'#90a4b8'},grid:{color:'#20354b'}},y1:{position:'right',ticks:{color:'#90a4b8'},grid:{drawOnChartArea:false}},x:{ticks:{color:'#90a4b8',maxTicksLimit:8},grid:{color:'#20354b'}}}});
    if (state.page === 'Rainfall') {
      chart('rainHourChart','bar',hourlyLabels,[{label:'Precipitation mm',data:weather.hourly.precipitation.slice(hourStart,hourEnd),backgroundColor:'#28bde0'}]);
      chart('rainDayChart','bar',weather.daily.time.map(t=>t.slice(5)),[{label:'Daily precipitation mm',data:weather.daily.precipitation_sum,backgroundColor:'#e5a13b'}]);
    }
    if (state.page === 'Flood Intelligence') chart('floodChart','bar',['Past 24h','Next 72h forecast'],[{label:'Rainfall mm',data:[state.alertMetrics.pastRain||0,state.alertMetrics.nextRain||0],backgroundColor:['#27b6d8','#e5a13b']}]);
    if (state.page === 'Climate Analytics') {
      chart('climateTempChart','line',weather.daily.time.map(t=>t.slice(5)),[{label:'Minimum °C',data:weather.daily.temperature_2m_min,borderColor:'#2bb9e0',pointRadius:2},{label:'Maximum °C',data:weather.daily.temperature_2m_max,borderColor:'#f1a342',pointRadius:2}]);
      chart('climateRainChart','bar',weather.daily.time.map(t=>t.slice(5)),[{label:'Precipitation mm',data:weather.daily.precipitation_sum,backgroundColor:'#239ec4'}]);
    }
  }
  function bindPageEvents() {
    $('refreshGlobal')?.addEventListener('click',()=>refreshLocationData(false));
    $('refreshOverview')?.addEventListener('click',()=>refreshLocationData(false));
    $('refreshProviders')?.addEventListener('click',refreshAdditionalWeatherProviders);
    $('openEarthBtn')?.addEventListener('click',()=>navigate('3D Earth'));
    $('layersBtn')?.addEventListener('click',()=>statusToast('Base layer: satellite imagery when available, with OpenStreetMap fallback. RainViewer radar can be toggled separately.'));
    $('radarToggle')?.addEventListener('change',event=>toggleRainRadar(event.target.checked));
    $('earthRadarToggle')?.addEventListener('change',event=>toggleRainRadar(event.target.checked));
    $('flySelected')?.addEventListener('click',flyGlobeToLocation);
    $('historyEnd')?.addEventListener('change',()=>{ if($('historyStart')) $('historyStart').max=$('historyEnd').value; });
    $('loadHistory')?.addEventListener('click',loadHistoricalPage);
    $('loadVisualHistory')?.addEventListener('click',loadVisualCrossingHistory);
    $('dataFile')?.addEventListener('change',handleDatasetUpload);
    $('exportJson')?.addEventListener('click',exportJSONReport);
    $('exportCsv')?.addEventListener('click',exportForecastCSV);
    $('printReport')?.addEventListener('click',()=>window.print());
    $('refreshHealth')?.addEventListener('click',refreshHealthStatus);
    $('testGroqModels')?.addEventListener('click',testGroqModels);
    $('lightSetting')?.addEventListener('change',event=>document.body.classList.toggle('light',event.target.checked));
    $('saveSettings')?.addEventListener('click',saveSettings);
    if(state.page==='Flood Intelligence') loadFloodDatabase();
    if(state.page==='Disaster Monitoring'){
      $('refreshHazards')?.addEventListener('click',loadMultiHazards);
      $('loadHazardHistory')?.addEventListener('click',()=>{state.hazardFrom=$('hazardFrom')?.value;state.hazardTo=$('hazardTo')?.value;loadMultiHazards();});
      if(!state.hazardFetchedAt)loadMultiHazards();
    }
    if(state.page==='Cyclone Tracking'){
      $('refreshCyclone')?.addEventListener('click',()=>loadCycloneIntel('current'));
      $('cycloneCurrent')?.addEventListener('click',()=>{state.cycloneMode='current';loadCycloneIntel('current');});
      $('cycloneHistory')?.addEventListener('click',()=>{state.cycloneMode='history';renderPage();});
      $('runCycloneSearch')?.addEventListener('click',()=>{state.cycloneFrom=$('cycloneFrom')?.value;state.cycloneTo=$('cycloneTo')?.value;loadCycloneIntel(state.cycloneMode);});
      if(!state.cycloneFetchedAt)loadCycloneIntel('current');
      else drawCycloneEntities();
    }
    $('autoSpeakSetting')?.addEventListener('change',event=>state.settings.autoSpeak=event.target.checked);
    $('voiceSetting')?.addEventListener('change',event=>state.settings.voice=event.target.checked);
    $('chatForm')?.addEventListener('submit',event=>{event.preventDefault();sendAIMessage();});
    $('chatInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAIMessage();}});
    $('chatInput')?.addEventListener('input',event=>{event.target.style.height='auto';event.target.style.height=Math.min(event.target.scrollHeight,140)+'px';});
    $('micButton')?.addEventListener('click',()=>{if(state.listening)stopListening();else startListening(false);});
    $('talkButton')?.addEventListener('click',toggleTalkMode);
    document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{ $('chatInput').value=button.dataset.prompt; sendAIMessage(); }));
    document.querySelector('[data-start-talk]')?.addEventListener('click',toggleTalkMode);
  }
  function navigate(page) {
    if (!['Overview','Global Intelligence','3D Earth','Weather','Rainfall','Flood Intelligence','Cyclone Tracking','Climate Analytics','Disaster Monitoring','Historical Explorer','Research AI','Data Laboratory','Reports','Notification','API Management','Settings'].includes(page)) return;
    state.page=page; renderPage();
    $('sidebar').classList.remove('open'); $('mobileScrim').classList.remove('show');
    document.body.classList.toggle('collapsed',localStorage.getItem('forecastraNavCollapsed')==='true');
  }
  async function loadVisualCrossingHistory(){
    const output=$('historyOutput');if(!output)return;
    output.innerHTML='<div class="info-strip">Loading Visual Crossing history…</div>';
    try{
      const data=await getJSON(`/api/vc?lat=${state.location.lat}&lon=${state.location.lon}&start=last30days`);
      const days=data.days||[];
      if(!days.length)throw new Error('The provider returned no daily records.');
      const rows=days.map(day=>`<tr><td>${escapeHTML(day.datetime)}</td><td>${num(day.tempmin)}°C</td><td>${num(day.tempmax)}°C</td><td>${num(day.precip)} mm</td><td>${num(day.windspeed)} km/h</td></tr>`).join('');
      output.innerHTML=`${panel('VISUAL CROSSING · LAST 30 DAYS','Provider daily history · separate from Open-Meteo forecast',`<div class="chart-box"><canvas id="visualHistoryChart"></canvas></div><div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>DATE</th><th>MIN TEMP</th><th>MAX TEMP</th><th>PRECIPITATION</th><th>WIND</th></tr></thead><tbody>${rows}</tbody></table></div>`)}`;
      chart('visualHistoryChart','line',days.map(day=>day.datetime.slice(5)),[{label:'Precipitation mm',data:days.map(day=>day.precip),borderColor:'#2abbdc',yAxisID:'y'},{label:'Maximum temperature °C',data:days.map(day=>day.tempmax),borderColor:'#ed9f3b',yAxisID:'y1'}],{scales:{y:{ticks:{color:'#90a4b8'},grid:{color:'#20354b'}},y1:{position:'right',ticks:{color:'#90a4b8'},grid:{drawOnChartArea:false}},x:{ticks:{color:'#90a4b8',maxTicksLimit:8},grid:{color:'#20354b'}}}});
    }catch(error){output.innerHTML=`<div class="info-strip warning-strip">Visual Crossing history unavailable: ${escapeHTML(error.message)}. Configure VISUAL_CROSSING_KEY in Supabase Edge Function secrets.</div>`;}
  }
  async function loadHistoricalPage() {
    const start=$('historyStart')?.value,end=$('historyEnd')?.value;
    if(!start||!end||start>end){statusToast('Choose a valid start and end date.',true);return;}
    const output=$('historyOutput'); if(output) output.innerHTML='<div class="info-strip">Loading historical weather data…</div>';
    try {
      const data=await loadArchive(start,end); state.archive=data;
      const rows=data.daily.time.map((date,i)=>`<tr><td>${date}</td><td>${num(data.daily.temperature_2m_min[i])}°C</td><td>${num(data.daily.temperature_2m_max[i])}°C</td><td>${num(data.daily.precipitation_sum[i])} mm</td></tr>`).join('');
      output.innerHTML=`${panel('HISTORICAL DAILY WEATHER',`${start} to ${end} · Open-Meteo Archive API`,`<div class="chart-box"><canvas id="historyChart"></canvas></div><div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>DATE</th><th>MIN TEMP</th><th>MAX TEMP</th><th>PRECIPITATION</th></tr></thead><tbody>${rows}</tbody></table></div>`)}`;
      chart('historyChart','line',data.daily.time,[{label:'Min °C',data:data.daily.temperature_2m_min,borderColor:'#26bfe3',pointRadius:0},{label:'Max °C',data:data.daily.temperature_2m_max,borderColor:'#e5a33d',pointRadius:0}]);
    } catch(error){output.innerHTML=`<div class="info-strip warning-strip">Historical query failed: ${escapeHTML(error.message)}</div>`;}
  }
  async function handleDatasetUpload(event) {
    const file=event.target.files?.[0]; if(!file)return;
    try {
      let rows;
      if(/\.json$/i.test(file.name)){const json=JSON.parse(await file.text());rows=Array.isArray(json)?json:(json.data||json.rows||[json]);}
      else {
        if(!window.XLSX)throw new Error('Spreadsheet parser did not load. Check your internet connection and retry.');
        const book=XLSX.read(await file.arrayBuffer(),{type:'array'});rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:null});
      }
      if(!Array.isArray(rows)||!rows.length||typeof rows[0]!=='object')throw new Error('No tabular rows were found in this file.');
      const columns=Object.keys(rows[0]);
      const numeric=columns.filter(column=>{const values=rows.map(row=>Number(row[column])).filter(Number.isFinite);return values.length>=Math.max(2,Math.ceil(rows.length*.65));});
      const summary={};
      for(const column of numeric){const values=rows.map(row=>Number(row[column])).filter(Number.isFinite);const mean=values.reduce((a,b)=>a+b,0)/values.length;const sd=Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length);summary[column]={count:values.length,mean:+mean.toFixed(3),min:Math.min(...values),max:Math.max(...values),stdDev:+sd.toFixed(3),greaterThan3SD:sd?values.filter(v=>Math.abs(v-mean)>3*sd).length:0};}
      state.dataset={name:file.name,rows,columns,numeric,summary}; renderDatasetOutput();
      statusToast(`Loaded ${file.name} · ${rows.length} rows`);
      saveSupabaseDatasetAnalysis(state.dataset).catch(error=>statusToast(`Dataset summary was not saved: ${error.message}`,true));
    }catch(error){statusToast(`Dataset could not be read: ${error.message}`,true);}
  }
  function renderDatasetOutput() {
    const d=state.dataset,output=$('datasetOutput');if(!d||!output)return;
    const column=d.numeric[0];
    const options=d.numeric.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    output.innerHTML=`${panel('DATASET SUMMARY',`${escapeHTML(d.name)} · ${d.rows.length} rows · ${d.columns.length} columns`,`<div class="stat-mini-grid"><div class="stat-mini"><span>ROWS</span><strong>${d.rows.length}</strong></div><div class="stat-mini"><span>COLUMNS</span><strong>${d.columns.length}</strong></div><div class="stat-mini"><span>NUMERIC FIELDS</span><strong>${d.numeric.length}</strong></div><div class="stat-mini"><span>MISSING CELLS (ROUGH)</span><strong>${d.rows.reduce((s,row)=>s+d.columns.filter(c=>row[c]==null||row[c]==='').length,0)}</strong></div></div><div class="field" style="padding:0 14px 12px"><label for="datasetColumn">NUMERIC COLUMN</label><select id="datasetColumn">${options}</select></div><div class="chart-box"><canvas id="datasetChart"></canvas></div><div class="station-table-wrap"><table class="forecast-table"><thead><tr><th>FIELD</th><th>COUNT</th><th>MEAN</th><th>MIN</th><th>MAX</th><th>STD DEV</th><th>&gt;3 SD</th></tr></thead><tbody>${d.numeric.map(c=>`<tr><td>${escapeHTML(c)}</td><td>${d.summary[c].count}</td><td>${d.summary[c].mean}</td><td>${d.summary[c].min}</td><td>${d.summary[c].max}</td><td>${d.summary[c].stdDev}</td><td>${d.summary[c].greaterThan3SD}</td></tr>`).join('')||'<tr><td colspan="7" class="empty-cell">No numeric fields detected.</td></tr>'}</tbody></table></div>`)}`;
    $('datasetColumn')?.addEventListener('change',event=>plotDatasetColumn(event.target.value));
    if(column)plotDatasetColumn(column);
  }
  function plotDatasetColumn(column) {
    const d=state.dataset;if(!d)return;const xColumn=d.columns.find(c=>/date|time|year/i.test(c));
    chart('datasetChart','line',d.rows.map((row,i)=>String(xColumn?row[xColumn]:i+1)),[{label:column,data:d.rows.map(row=>Number(row[column])).map(v=>Number.isFinite(v)?v:null),borderColor:'#35c8e5',backgroundColor:'#35c8e51b',fill:true,tension:.2,pointRadius:0}]);
  }
  function createDownload(filename,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function reportPayload() {
    return { platform:'FORECASTRA · Quantum Minds',version:'2.0.0',generatedAt:new Date().toISOString(),location:state.location,weather:state.weather?{retrievedAt:state.weather.current?.time,timezone:state.weather.timezone,current:state.weather.current,daily:state.weather.daily}:null,elevationM:state.elevation,screeningIndicators:state.alertMetrics,limitations:['Forecast-grid data are not station observations.','Screening indicators are not official warnings or validated probabilities.','No flood depth, drainage-network or cyclone-track model is included unless separately configured.'],uploadedDataset:state.dataset?{name:state.dataset.name,rows:state.dataset.rows.length,summary:state.dataset.summary}:null};
  }
  function exportJSONReport(){createDownload(`forecastra-report-${isoDate(new Date())}.json`,JSON.stringify(reportPayload(),null,2),'application/json');}
  function exportForecastCSV(){const d=state.weather?.daily;if(!d){statusToast('Weather data is not available.',true);return;}const lines=['date,temp_min_c,temp_max_c,precipitation_mm,precipitation_probability_max_pct,wind_speed_max_kmh'];d.time.forEach((date,i)=>lines.push([date,d.temperature_2m_min[i],d.temperature_2m_max[i],d.precipitation_sum[i],d.precipitation_probability_max[i],d.wind_speed_10m_max[i]].join(',')));createDownload(`forecastra-forecast-${isoDate(new Date())}.csv`,lines.join('\n'),'text/csv');}
  async function refreshHealthStatus(){
    const el=$('healthResult');if(!el)return;
    const {data}=await state.supabase?.auth.getSession() || {};
    el.textContent = state.supabase
      ? 'Supabase connected · public read access configured · AI function: forecastra-ai (no login required)'
      : 'Supabase is not configured. Check the public project URL and publishable key in docs/config.js.';
  }
  async function testGroqModels(){
    const el=$('healthResult');if(!el)return;
    el.textContent='Groq model access is checked by the secure Supabase AI function when you send a Research AI prompt. Never expose the Groq key in this browser.';
  }
  function saveSettings(){state.settings.autoSpeak=$('autoSpeakSetting')?.checked??true;state.settings.voice=$('voiceSetting')?.checked??true;localStorage.setItem('forecastraSettings',JSON.stringify(state.settings));localStorage.setItem('forecastraTheme',document.body.classList.contains('light')?'light':'dark');statusToast('Preferences saved on this device.');}
  function addChatMessage(role,text) {
    const stream=$('chatStream');if(!stream)return;
    stream.querySelector('.chat-welcome')?.remove();
    const row=document.createElement('div');row.className=`chat-message ${role}`;
    const avatar=document.createElement('div');avatar.className='chat-avatar';avatar.textContent=role==='user'?'YOU':'F';
    const bubble=document.createElement('div');bubble.className='chat-bubble';bubble.textContent=text;
    row.append(avatar,bubble);stream.append(row);stream.scrollTop=stream.scrollHeight;
    return bubble;
  }
  function renderChatHistory(){if(!state.chat.length)return;const stream=$('chatStream');stream.innerHTML='';state.chat.forEach(item=>addChatMessage(item.role,item.content));}
  async function aiContext(){
    let databaseContext={riverObservations:[],officialAlerts:state.officialAlerts||[]};
    if(state.supabase){
      try{
        const [river,alerts]=await Promise.all([
          state.supabase.from('river_water_levels_raw').select('station,river,district,agency,observed_at_local,water_level_m').eq('state','Tamil Nadu').order('observed_at_local',{ascending:false}).limit(8),
          state.supabase.from('official_alerts').select('source_agency,hazard_type,severity,headline,affected_area,issued_at,expires_at,source_url').order('issued_at',{ascending:false}).limit(8)
        ]);
        if(!river.error)databaseContext.riverObservations=river.data||[];
        if(!alerts.error)databaseContext.officialAlerts=alerts.data||[];
      }catch(error){console.warn('Could not load database context for Research AI:',error.message);}
    }
    return{location:state.location,retrievedAt:new Date().toISOString(),current:state.weather?.current||null,daily:state.weather?.daily||null,elevationM:state.elevation,screeningIndicators:state.alertMetrics,databaseContext,uploadedDataset:state.dataset?{name:state.dataset.name,rowCount:state.dataset.rows.length,numericSummary:state.dataset.summary,sampleRows:state.dataset.rows.slice(0,12)}:null};
  }
  async function sendAIMessage(forcedText) {
    const input=$('chatInput');const question=String(forcedText??input?.value??'').trim();if(!question||state.aiBusy)return;
    const previousAnswer=[...state.chat].reverse().find(item=>item.role==='assistant')?.content||'';
    const wantsShortExplanation=/^(?:please\\s+)?(?:explain(?:\\s+it)?\\s+(?:more\\s+)?short(?:ly)?|make\\s+(?:it|this)\\s+shorter|shorten\\s+(?:it|that)|in\\s+short|summari[sz]e\\s+(?:it\\s+)?briefly|explain\\s+briefly)[.!?\\s]*$/i.test(question);
    if(wantsShortExplanation&&!previousAnswer){
      if(input){input.value='';input.style.height='auto';}
      addChatMessage('user',question);state.chat.push({role:'user',content:question});
      const notice='There is no earlier answer to shorten yet. Ask me a question first, then say “explain more short”.';
      addChatMessage('assistant',notice);state.chat.push({role:'assistant',content:notice});
      return;
    }
    const aiQuestion=wantsShortExplanation
      ? 'Rewrite your immediately previous answer as a short, easy-to-understand explanation. Keep only the most important points, use 2–4 concise bullet points or 2–3 short sentences, and avoid unnecessary detail. Do not add facts that were not in the previous answer.'
      : question;
    if(input){input.value='';input.style.height='auto';}
    state.chat.push({role:'user',content:question});addChatMessage('user',question);
    persistSupabaseResearchMessage('user',question).catch(error=>console.warn('Research message was not saved:',error.message));
    const pending=addChatMessage('assistant','');
    pending.classList.add('thinking-bubble');
    pending.innerHTML='<div class="thinking-head"><span class="thinking-orbit"><i></i></span><div><strong>Thinking</strong><span class="thinking-dots"><i></i><i></i><i></i></span><p data-thinking-stage>Gathering the latest environmental context…</p></div></div><div class="thinking-steps"><div class="thinking-step active" data-step="context"><span class="step-mark">01</span><span><strong>Understanding your question</strong><small>Reading your request and selected location</small></span><b>IN PROGRESS</b></div><div class="thinking-step" data-step="data"><span class="step-mark">02</span><span><strong>Checking available data</strong><small>Weather, forecast and connected Supabase records</small></span><b>WAITING</b></div><div class="thinking-step" data-step="model"><span class="step-mark">03</span><span><strong>Generating the answer</strong><small>Waiting for the configured AI provider</small></span><b>WAITING</b></div></div>';
    const setThinkingStage=(stage,activeStep)=>{
      const label=pending.querySelector('[data-thinking-stage]');if(label)label.textContent=stage;
      pending.querySelectorAll('.thinking-step').forEach((item,index)=>{
        const active=index===activeStep,done=index<activeStep;
        item.classList.toggle('active',active);item.classList.toggle('done',done);
        const stateLabel=item.querySelector('b');if(stateLabel)stateLabel.textContent=done?'COMPLETE':active?'IN PROGRESS':'WAITING';
      });
    };
    state.aiBusy=true;if($('chatSend'))$('chatSend').disabled=true;
    if(state.listening)stopListening();
    try{
      setThinkingStage('Gathering weather, forecast and saved research context…',1);
      const context=await aiContext();
      setThinkingStage('Sending your question to the configured AI service…',2);
      const data=await getJSON('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:aiQuestion,context,history:state.chat.slice(-9,-1).map(item=>({role:item.role,content:item.content.slice(0,2500)}))})});
      pending.classList.remove('thinking-bubble');
      state.config.groqConfigured=true;
      const connectionStatus=$('aiConnectionStatus');if(connectionStatus){connectionStatus.textContent='GROQ CONNECTED';connectionStatus.classList.remove('off');}
      pending.textContent=data.answer;state.chat.push({role:'assistant',content:data.answer});
      persistSupabaseResearchMessage('assistant',data.answer).catch(error=>console.warn('Research reply was not saved:',error.message));
      if(state.talkMode&&state.settings.autoSpeak) speakAnswer(data.answer);
    }catch(error){
      state.config.groqConfigured=false;
      const connectionStatus=$('aiConnectionStatus');if(connectionStatus){connectionStatus.textContent='CONNECTION ERROR · CHECK SUPABASE/GROQ';connectionStatus.classList.add('off');}
      pending.textContent=`I could not complete that request: ${error.message}`;state.chat.push({role:'assistant',content:pending.textContent});statusToast(error.message,true);
    }
    finally{state.aiBusy=false;if($('chatSend'))$('chatSend').disabled=false;if(state.talkMode&&!window.speechSynthesis?.speaking)startListening(true);}
  }
  function voiceStatus(message,error=false){const node=$('voiceStatus');if(node){node.textContent=message;node.style.color=error?'#f09a9a':'';}}
  function buildRecognition(){
    const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Speech)return null;
    const recognition=new Speech();recognition.lang='en-IN';recognition.interimResults=true;recognition.continuous=false;
    recognition.onstart=()=>{state.listening=true;$('micButton')?.classList.add('listening');$('talkButton')?.classList.add('listening');voiceStatus(state.talkMode?'Talk mode listening…':'Listening… speak now');};
    recognition.onresult=event=>{let finalText='';let interim='';for(let i=event.resultIndex;i<event.results.length;i++){const piece=event.results[i][0].transcript;if(event.results[i].isFinal)finalText+=piece;else interim+=piece;}
      if(state.talkMode){if(finalText.trim())sendAIMessage(finalText.trim());else voiceStatus(interim||'Listening…');}
      else if($('chatInput')){$('chatInput').value=(finalText||interim).trim();voiceStatus(finalText?'Transcription ready · press Enter to send':'Listening…');}
    };
    recognition.onerror=event=>{state.listening=false;voiceStatus(`Microphone issue: ${event.error}`,true);};
    recognition.onend=()=>{state.listening=false;$('micButton')?.classList.remove('listening');$('talkButton')?.classList.remove('listening');if(state.talkMode&&!state.aiBusy){setTimeout(()=>{if(state.talkMode&&!state.listening&&!window.speechSynthesis?.speaking)startListening(true);},450);}else if(!state.talkMode)voiceStatus('Enter to send · Shift + Enter for a new line');};
    return recognition;
  }
  function startListening(forTalk=false){
    if(!state.settings.voice){voiceStatus('Voice features are disabled in Settings.',true);return;}
    if(!state.recognition)state.recognition=buildRecognition();
    if(!state.recognition){voiceStatus('Speech recognition is unavailable. Try Chrome or Edge over localhost or HTTPS.',true);return;}
    if(forTalk)state.talkMode=true;
    try{state.recognition.start();}catch(error){voiceStatus('Microphone is already active or unavailable.',true);}
  }
  function stopListening(){try{state.recognition?.stop();}catch{}state.listening=false;$('micButton')?.classList.remove('listening');$('talkButton')?.classList.remove('listening');}
  function speakAnswer(text){if(!window.speechSynthesis||!state.settings.voice)return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-IN';utterance.rate=1;utterance.pitch=1;utterance.onend=()=>{if(state.talkMode&&!state.aiBusy)startListening(true);};window.speechSynthesis.speak(utterance);}
  function toggleTalkMode(){
    state.talkMode=!state.talkMode;
    const button=$('talkButton');if(button){button.classList.toggle('listening',state.talkMode);button.textContent=state.talkMode?'■ Stop talk mode':'◉ Talk mode';}
    if(state.talkMode){window.speechSynthesis?.cancel();voiceStatus('Talk mode on · speak after listening starts');startListening(true);}
    else{stopListening();window.speechSynthesis?.cancel();voiceStatus('Talk mode off · type or use microphone');}
  }
  function bindNavigationAndHeader(){
    document.querySelectorAll('.nav-item').forEach(button=>{button.title=button.dataset.page||'';button.setAttribute('aria-label',button.dataset.page||'Navigation');button.addEventListener('click',()=>navigate(button.dataset.page));});
    document.addEventListener('click',event=>{const button=event.target.closest('[data-go]');if(button)navigate(button.dataset.go);});
    $('locationSearch').addEventListener('submit',event=>{event.preventDefault();searchLocation($('locationQuery').value);});
    $('coordinatePill').addEventListener('click',()=>statusToast(`${state.location.name} · ${state.location.lat.toFixed(4)}, ${state.location.lon.toFixed(4)}`));
    $('collapseNav').addEventListener('click',()=>{const collapsed=!document.body.classList.contains('collapsed');document.body.classList.toggle('collapsed',collapsed);localStorage.setItem('forecastraNavCollapsed',String(collapsed));});
    $('themeToggle').addEventListener('click',()=>{document.body.classList.toggle('light');localStorage.setItem('forecastraTheme',document.body.classList.contains('light')?'light':'dark');});
    $('openSidebar').addEventListener('click',()=>{$('sidebar').classList.add('open');$('mobileScrim').classList.add('show');});
    $('closeSidebar').addEventListener('click',()=>{$('sidebar').classList.remove('open');$('mobileScrim').classList.remove('show');});
    $('mobileScrim').addEventListener('click',()=>{$('sidebar').classList.remove('open');$('mobileScrim').classList.remove('show');});
  }
  async function init(){
    const saved=JSON.parse(localStorage.getItem('forecastraSettings')||'{}');state.settings={...state.settings,...saved};
    if(localStorage.getItem('forecastraTheme')==='light')document.body.classList.add('light');
    document.body.classList.toggle('collapsed',localStorage.getItem('forecastraNavCollapsed')==='true');
    bindNavigationAndHeader();clockTick();setInterval(clockTick,1000);updateTopLocation();
    restoreCycloneCache();restoreHazardCache();
    await loadConfig();
    await refreshLocationData(false);
  }
  init().catch(error=>{console.error(error);statusToast(`FORECASTRA could not finish loading: ${error.message}`,true);renderPage();});
})();
