/* FORECASTRA public browser configuration.
 * This file is committed to GitHub Pages and is visible to everyone.
 * Only use browser-safe values here: Supabase publishable/anon key and a Cesium token
 * restricted to the published site domain. Never put Groq, Visual Crossing, or service-role secrets here.
 */
window.FORECASTRA_CONFIG = {
  // Set this to your separately hosted backend origin, e.g. https://your-api.example.com
  apiBaseUrl: '',
  // Safe only when Supabase Row Level Security is correctly enabled on every exposed table.
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Use a Cesium ion token restricted to your GitHub Pages domain and read-only permissions.
  cesiumToken: '',
  groqModel: 'openai/gpt-oss-120b'
};
