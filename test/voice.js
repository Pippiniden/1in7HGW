// セリフの場面（config.js の VOICE_SLOTS）を確かめる
// 使い方: node test/voice.js
//  1) engine.js・index.html が使う場面の名前が、すべて VOICE_SLOTS にある
//  2) 見出しが二つの場面にまたがらない／使わない見出しの表と重ならない
//  3) セリフを足したり消したりしても、戦争の展開（勝敗・脱落・戦いの数）は変わらない
//  4) いまのデータで、ゲームで使う場面ごとに何騎がセリフを持っているか
for (const f of ['config', 'rank', 'parser', 'effects', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const fs = require('fs'), H = HGW;
const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(H.build.fromJSON);
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.error('NG:', msg); } };
const slots = new Set(H.VOICE_SLOTS.map(s => s.key));

// 1) コードの中の場面の名前
const keysIn = (src, re) => [...src.matchAll(re)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
const eng = fs.readFileSync(__dirname + '/../js/engine.js', 'utf8');
const used = new Set(keysIn(eng, /\bsay\(\w+, \[([^\]]*)\]\)/g).concat(keysIn(eng, /(?<![.\w])has\(('[^']+')\)/g)));
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const fq = html.slice(html.indexOf('function finalQuote'), html.indexOf('function lastWordHtml'));
for (const k of keysIn(fq, /(\[[^\]]*\])/g)) used.add(k);
ok(used.size >= 8, 'コードから場面の名前を読めていない：' + [...used].join(','));
for (const k of used) ok(slots.has(k), `コードが使う場面「${k}」が VOICE_SLOTS に無い`);
for (const k of slots) ok(used.has(k) || k === '宝具', `VOICE_SLOTS の「${k}」をコードが使っていない`);
ok(/G\.npVoiceLines\(/.test(eng), '宝具のセリフを npVoiceLines で選んでいない');

// 2) 見出しの重なり
const seen = {};
for (const s of H.VOICE_SLOTS) for (const h of [s.key].concat(s.aliases)) { ok(!seen[h], `見出し「${h}」が二つの場面にある`); seen[h] = s.key; }
for (const [, hs] of H.VOICE_UNUSED) for (const h of hs) ok(!seen[h], `見出し「${h}」が使う場面と使わない表の両方にある`);

// 3) セリフを変えても展開は同じ（行を足す・減らす・入れ替える。日常の出来事は「その場面のセリフが有るか」で起こり方が
//    変わるので、日常に使う場面は有る・無いを変えない。召喚・開始・宝具・戦闘不能などは無かった騎にも足す）
const LIFE = new Set(['会話', '聖杯について', '好きなこと', '嫌いなこと', '絆']);
const strip = r => JSON.stringify({ w: r.winner, d: r.days, c: r.camps.map(c => [c.servantId, c.alive, c.masterAlive, c.kills, c.battles, c.npUses, c.bond]) });
const alt = roster.map(s => {
  const t = Object.assign(Object.create(Object.getPrototypeOf(s)), s);
  const v = {}; let i = 0;
  for (const [k, ls] of Object.entries(s.voice || {})) v[k] = i++ % 2 ? ls.concat(['テスト用の行']) : ls.length > 1 ? ls.slice(1) : ls.slice().reverse();
  for (const s2 of H.VOICE_SLOTS) if (!LIFE.has(s2.key) && !H.voiceLines(t, s2.key).length) v[s2.key] = ['足した' + s2.key];
  t.voice = v; return t;
});
for (let i = 0; i < 40; i++) {
  const a = H.engine.runWar({ roster, seed: 'v' + i, ask: 'big' }), b = H.engine.runWar({ roster: alt, seed: 'v' + i, ask: 'big' });
  ok(strip(a) === strip(b), `セリフを変えたら展開が変わった（シード v${i}）`);
}

// 5) 編集欄（js/voiceedit.js）のテキストの形との行き来：「その2」は前の見出しにまとめ、読めない行は bad に
require('../js/voiceedit.js');
const VE = H.voiceEdit;
for (const s of roster.filter(x => Object.keys(x.voice || {}).length)) {
  const v = JSON.parse(JSON.stringify(s.voice)), r = VE.parseText(VE.toText(v));
  const strip2 = o => JSON.stringify(Object.keys(o).filter(k => !/^(その)?\d+$/.test(k)).sort().map(k => [k, o[k]]));
  ok(!r.bad.length && strip2(r.voice) === strip2(v), `${s.trueName}: テキストの形にして戻すとセリフが変わる`);
}
{ const r = VE.parseText('召喚：「はじめまして」\nその2：「よろしく」\nただの文章\n会話：カギかっこ無し'); ok(JSON.stringify(r.voice) === JSON.stringify({ 召喚: ['はじめまして', 'よろしく'], 会話: ['カギかっこ無し'] }) && r.bad.length === 1, 'parseText の読み方が違う：' + JSON.stringify(r)); }

// 4) いまのデータで、場面ごとにセリフを持つ騎数
const withVoice = roster.filter(s => Object.keys(s.voice || {}).length);
console.log(`セリフのあるサーヴァント ${withVoice.length}/${roster.length}騎`);
console.log('  ' + H.VOICE_SLOTS.map(s => `${s.key} ${withVoice.filter(v => H.voiceLines(v, s.key).length).length}`).join('  '));
const unused = {};
for (const s of withVoice) for (const h of Object.keys(s.voice)) if (!H.voiceSlotOf(h)) unused[h] = (unused[h] || 0) + 1;
const known = new Set(H.VOICE_UNUSED.flatMap(x => x[1]));
const odd = Object.entries(unused).filter(([h]) => !known.has(h));
console.log('  ゲームでは使わない見出し：' + Object.entries(unused).filter(([h]) => known.has(h)).map(([h, n]) => h + n).join(' '));
if (odd.length) console.log('  どの表にも無い見出し（名前の誤りかも）：' + odd.map(([h, n]) => h + n).join(' '));
console.log(fail ? `NG ${fail}件` : 'OK：場面の名前がそろっている／セリフの行を変えても展開は変わらない');
process.exitCode = fail ? 1 : 0;
