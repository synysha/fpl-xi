// Cloudflare Worker: sprostredkovateľ medzi webovou verziou appky a oficiálnym FPL API.
const ALLOWED = ['bootstrap-static', 'fixtures', 'entry', 'event', 'leagues-classic', 'element-summary'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    const first = url.pathname.split('/')[1];
    if (!ALLOWED.includes(first)) return new Response('Not allowed', { status: 403, headers: CORS });
    const res = await fetch('https://fantasy.premierleague.com/api' + url.pathname + url.search, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cf: { cacheTtl: 30, cacheEverything: true },
    });
    const headers = new Headers(CORS);
    headers.set('Content-Type', res.headers.get('Content-Type') || 'application/json');
    return new Response(res.body, { status: res.status, headers });
  },
};
