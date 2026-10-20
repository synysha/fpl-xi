// Zostaví webovú verziu appky a doplní ikonu a nastavenia pre pridanie na plochu iPhonu.
const fs = require('fs');
const { execSync } = require('child_process');

const repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1] || '';
const base = repo ? '/' + repo : '';
const TITLE = 'My FPL team';
const SHORT = 'My FPL';
const COLOR = '#0d0d63';   // farba lišty stavu iPhonu (tmavomodrá ako hlavička)
const PAGE = '#f1f2f9';    // farba pozadia pod obsahom (svetlá)

// 1) nastavenie Expo pre web
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
app.expo = app.expo || {};
app.expo.web = { ...(app.expo.web || {}), bundler: 'metro', output: 'single', favicon: './assets/icon.png' };
app.expo.experiments = { ...(app.expo.experiments || {}), baseUrl: base };
fs.writeFileSync('app.json', JSON.stringify(app, null, 2));

// 2) export
if (!process.env.SKIP_EXPORT) execSync('npx expo export -p web', { stdio: 'inherit' });

// 3) ikona, manifest a úprava index.html
fs.copyFileSync('assets/icon.png', 'dist/apple-touch-icon.png');
fs.writeFileSync('dist/.nojekyll', '');
fs.writeFileSync(
  'dist/manifest.webmanifest',
  JSON.stringify({
    name: TITLE,
    short_name: SHORT,
    start_url: base + '/',
    scope: base + '/',
    display: 'standalone',
    background_color: COLOR,
    theme_color: COLOR,
    icons: [{ src: base + '/apple-touch-icon.png', sizes: '1024x1024', type: 'image/png' }],
  })
);
const tags =
  `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">` +
  `<link rel="manifest" href="${base}/manifest.webmanifest">` +
  '<meta name="apple-mobile-web-app-capable" content="yes">' +
  '<meta name="mobile-web-app-capable" content="yes">' +
  `<meta name="apple-mobile-web-app-title" content="${SHORT}">` +
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
  `<meta name="theme-color" content="${COLOR}">` +
  `<style>html,body,#root{height:100%;min-height:100dvh;margin:0;background:${PAGE};overscroll-behavior:none;}` +
  `html{background:${COLOR};}</style>`;
const file = 'dist/index.html';
let html = fs.readFileSync(file, 'utf8');
html = html.replace(/<title>.*?<\/title>/s, `<title>${TITLE}</title>`);
if (/<meta name="viewport"/.test(html)) {
  html = html.replace(/(<meta name="viewport" content=")([^"]*)(")/, (m, a, b, c) => a + b.replace(/,?\s*viewport-fit=cover/, '') + ', viewport-fit=cover' + c);
} else {
  html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
}
html = html.replace('</head>', tags + '</head>');
fs.writeFileSync(file, html);
console.log('Web verzia pripravená.');
