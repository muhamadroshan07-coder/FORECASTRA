import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const env = { ...process.env };
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const splitAt = trimmed.indexOf('=');
    if (splitAt < 1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[key] == null || env[key] === '') env[key] = value;
  }
}

const cache = new Map();
const inflight = new Map();
const mime = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.txt':'text/plain; charset=utf-8'
};
const sendJSON = (res, code, data) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(data)); };

function applyApiCors(req, res) {
  const origin = req.headers.origin;
  const allowed = String(env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

async function cachedJSON(url, ttlMs = 10 * 60 * 1000) {
  const saved = cache.get(url);
  if (saved && Date.now() - saved.at < ttlMs) return saved.value;
  if (inflight.has(url)) return inflight.get(url);
  const request = fetch(url, { headers:{ 'User-Agent':'FORECASTRA-QuantumMinds/2.0' } })
    .then(async response => { if (!response.ok) throw new Error(`Upstream service returned ${response.status}`); const value = await response.json(); cache.set(url,{at:Date.now(),value}); return value; })
    .finally(() => inflight.delete(url));
  inflight.set(url, request); return request;
}

async function readJSON(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function handleAPI(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(res,200,{
      service:'FORECASTRA',version:'2.0.0',status:'online',
      configured:{groq:Boolean(env.GROQ_API_KEY),visualCrossing:Boolean(env.VISUAL_CROSSING_KEY),supabase:Boolean(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY),cesiumIon:Boolean(env.CESIUM_ION_TOKEN)}
    });
  }
  if (url.pathname === '/api/config' && req.method === 'GET') {
    return sendJSON(res,200,{
      supabaseUrl:env.SUPABASE_URL||'',supabaseAnonKey:env.SUPABASE_ANON_KEY||'',cesiumToken:env.CESIUM_ION_TOKEN||'',
      groqConfigured:Boolean(env.GROQ_API_KEY),groqModel:env.GROQ_MODEL||'openai/gpt-oss-120b',visualCrossingConfigured:Boolean(env.VISUAL_CROSSING_KEY)
    });
  }
  if (url.pathname === '/api/vc' && req.method === 'GET') {
    if (!env.VISUAL_CROSSING_KEY) return sendJSON(res,503,{error:'Visual Crossing is not configured. Add VISUAL_CROSSING_KEY to .env.'});
    const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return sendJSON(res,400,{error:'Valid latitude and longitude are required.'});
    const start=String(url.searchParams.get('start')||'last30days'),end=url.searchParams.get('end')?`/${url.searchParams.get('end')}`:'';
    const upstream=new URL(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${start}${end}`);
    upstream.search=new URLSearchParams({unitGroup:'metric',include:'days,current',elements:'datetime,tempmax,tempmin,temp,precip,precipprob,windspeed,winddir,conditions',contentType:'json',key:env.VISUAL_CROSSING_KEY}).toString();
    try{return sendJSON(res,200,await cachedJSON(upstream.toString()));}catch(error){return sendJSON(res,502,{error:error.message});}
  }
  if (url.pathname === '/api/groq-models' && req.method === 'GET') {
    if(!env.GROQ_API_KEY)return sendJSON(res,503,{error:'GROQ_API_KEY is not configured.'});
    try{
      const upstream=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`}});
      const data=await upstream.json();if(!upstream.ok)throw new Error(data.error?.message||`Groq returned ${upstream.status}`);
      return sendJSON(res,200,{models:(data.data||[]).filter(model=>model.active!==false).map(model=>({id:model.id,owned_by:model.owned_by}))});
    }catch(error){return sendJSON(res,502,{error:error.message});}
  }
  if (url.pathname === '/api/ai' && req.method === 'POST') {
    if(!env.GROQ_API_KEY)return sendJSON(res,503,{error:'FORECASTRA AI is not connected yet. Add GROQ_API_KEY to your .env file and restart the server.'});
    let body;try{body=await readJSON(req);}catch(error){return sendJSON(res,400,{error:error.message.includes('too large')?error.message:'Invalid JSON request.'});}
    const question=String(body?.question||'').trim();
    if(!question)return sendJSON(res,400,{error:'Enter a question first.'});
    if(question.length>12000)return sendJSON(res,413,{error:'That message is too long. Please shorten it.'});
    const context=body?.context&&typeof body.context==='object'?body.context:{};
    const system=[
      'You are FORECASTRA AI, an environmental data and research assistant created by Quantum Minds.',
      'Be clear, analytical and helpful. Explain weather, rainfall, climate datasets, flood-screening indicators and uploaded tabular data.',
      'Use only the supplied environmental context for claims about current conditions. Never invent observations, station measurements, official alerts, cyclone tracks, or model accuracy.',
      'Always distinguish measured/observed values, forecasts, historical values and estimates.',
      'Any simple hazard score is a screening heuristic, not a calibrated probability or validated warning. Explain data gaps and uncertainty.',
      'For emergencies, advise checking official government meteorological and disaster-management agencies. Do not present this app as an emergency-alert authority.'
    ].join(' ');
    try{
      const upstream=await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.GROQ_API_KEY}`},
        body:JSON.stringify({model:env.GROQ_MODEL||'openai/gpt-oss-120b',temperature:0.2,max_completion_tokens:1400,messages:[{role:'system',content:system},{role:'user',content:`ENVIRONMENTAL CONTEXT (may be incomplete):\n${JSON.stringify(context).slice(0,18000)}\n\nQUESTION:\n${question}`}]})
      });
      const data=await upstream.json();if(!upstream.ok)throw new Error(data.error?.message||`Groq returned ${upstream.status}`);
      return sendJSON(res,200,{answer:data.choices?.[0]?.message?.content||'I could not produce a response. Please try again.',model:env.GROQ_MODEL||'openai/gpt-oss-120b'});
    }catch(error){return sendJSON(res,502,{error:error.message});}
  }
  return sendJSON(res,404,{error:'API endpoint not found.'});
}

async function serveStatic(req,res,url){
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==='/')pathname='/index.html';
  const filePath=path.resolve(publicDir,`.${pathname}`);
  if(!filePath.startsWith(publicDir+path.sep)&&filePath!==publicDir)return sendJSON(res,403,{error:'Forbidden'});
  try{
    const stat=await fs.promises.stat(filePath);if(!stat.isFile())throw new Error('Not a file');
    const content=await fs.promises.readFile(filePath);
    res.writeHead(200,{'Content-Type':mime[path.extname(filePath).toLowerCase()]||'application/octet-stream','Cache-Control':path.extname(filePath)==='.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
    res.end(content);
  }catch{return sendJSON(res,404,{error:'File not found.'});}
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(url.pathname.startsWith('/api/')) {
      applyApiCors(req, res);
      if (req.method === 'OPTIONS') {
        if (!res.hasHeader('Access-Control-Allow-Origin')) return sendJSON(res, 403, { error: 'Origin is not allowed by CORS policy.' });
        res.writeHead(204); res.end(); return;
      }
      return await handleAPI(req,res,url);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return sendJSON(res,405,{error:'Method not allowed'});
    return await serveStatic(req,res,url);
  }catch(error){console.error(error);if(!res.headersSent)sendJSON(res,500,{error:'Unexpected server error.'});else res.end();}
});
const port=Number(env.PORT||3000);
server.listen(port,'0.0.0.0',()=>console.log(`FORECASTRA running on port ${port}`));
