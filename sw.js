/* サービスワーカー（PWA：ホーム画面から開く・電波のないところでも遊べる）
 *
 * 方針：同じサイトのファイルは「ネットワーク優先」。つながれば常に最新を取りに行き、取れたものを保存しておく。
 * つながらない（または応答が遅い）ときだけ、保存しておいたものを使う。
 * なので js・データ・HTML を更新しても、オンラインならすぐ反映される（ここを書き換える必要はない）。
 *
 * VERSION を上げるのは、PRECACHE（最初に保存しておくファイルの一覧）を変えたときと、このファイルの処理を変えたとき。
 * js/ にファイルを足したら PRECACHE にも足す。
 */
'use strict';
const VERSION = 'v1';
const CACHE = 'hgw-' + VERSION;
const FONT_CACHE = 'hgw-fonts';
const PRECACHE = [
  './', 'index.html', 'roster.html', 'manifest.webmanifest',
  'js/config.js', 'js/rank.js', 'js/parser.js', 'js/effects.js', 'js/build.js', 'js/master.js', 'js/war.js',
  'js/names.js', 'js/scenes.js', 'js/personas.js', 'js/engine.js', 'js/data.js',
  'data/manifest.json', 'data/servants.json', 'data/overrides.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];
const NET_TIMEOUT = 6000; // これ以上かかったら保存しておいたものを先に出す

self.addEventListener('install', e => {
  // 1つ取れなくても他は保存する（data/packs/ の追加分などは、開いたときに保存される）
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hgw-') && k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ページ（index.html?seed=… など）は、問い合わせ部分を除いた住所で保存する（シードごとに増えないように）
const keyOf = req => {
  if (req.mode !== 'navigate') return req;
  const u = new URL(req.url); u.search = ''; u.hash = '';
  return new Request(u.href);
};

async function networkFirst(req) {
  const cache = await caches.open(CACHE), key = keyOf(req);
  const net = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  const saved = () => cache.match(key, { ignoreSearch: req.mode === 'navigate' }).then(r => r || (req.mode === 'navigate' ? cache.match('index.html') : null));
  try {
    // 応答が遅いときは、保存しておいたものがあればそれを先に出す（取得は裏で続け、次回に反映）
    const timer = new Promise(res => setTimeout(() => saved().then(r => r && res(r)), NET_TIMEOUT));
    return await Promise.race([net, timer]);
  } catch (err) {
    const r = await saved();
    if (r) return r;
    throw err;
  }
}

// Google Fonts：保存したものをすぐ出し、裏で新しいものを取りに行く
async function fonts(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') e.respondWith(fonts(req));
});
