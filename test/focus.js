// 最初の方針のおすすめ（index.html の REC_FOCUS）が、本当に勝ちやすいかを確かめる
// 使い方: node test/focus.js [シードの数=1000]
//
// 同じシード（同じ顔ぶれ・同じプレイヤーの陣営）で、方針だけを七通りに変えて全自動で戦わせる（方針は最後まで変えない。
// 大きな決断はおまかせ）。プレイヤーのサーヴァントの評価（S〜E。index.html の evaluate と同じ式）ごとに、方針ごとの勝率と
// 生き残った日数を出し、おすすめが「最も勝ちやすい方針」より誤差を超えて劣っていないかを見る。
// エンジンや config.js の数値を変えたら、これを回して REC_FOCUS を見直す。シード1000で約40秒。
for (const f of ['config', 'rank', 'parser', 'effects', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const H = HGW, fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const man = JSON.parse(fs.readFileSync(ROOT + '/data/manifest.json', 'utf8'));
for (const f of man.overrides) { const o = JSON.parse(fs.readFileSync(ROOT + '/data/' + f, 'utf8')); const E = H.effects; Object.assign(E.SKILL_OVERRIDES, o.global || {}); Object.assign(E.SERVANT_OVERRIDES, o.servant || {}); Object.assign(E.STAT_OVERRIDES, o.stats || {}); Object.assign(E.NP_OVERRIDES, o.np || {}); Object.assign(E.CONTENT_OVERRIDES, o.content || {}); }
const raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(ROOT + '/data/' + f, 'utf8')).servants);
H.build.harvestOverrides(raw);
const byId = new Map(); for (const s of raw) { const b = H.build.fromJSON(s); byId.set(b.id, b); }
const roster = [...byId.values()];

// index.html からおすすめの表を読む
const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
const REC = {}; for (const m of html.slice(html.indexOf('const REC_FOCUS')).split('};')[0].matchAll(/([A-Z]): \['(\w+)'/g)) REC[m[1]] = m[2];
// 評価（index.html の strengthTable・evaluate と同じ。リストの全騎との1対1の平均勝率の順位で S〜E。区切りは config.js の GRADES）
const B = H.build, rates = new Map();
for (const a of roster) { let t = 0, n = 0; for (const b of roster) { if (a === b) continue; t += (B.battleOdds(a, b, {}).pA + B.battleOdds(a, b, { np: true }).pA) / 2; n++; } rates.set(a.id, n ? t / n : 0.5); }
const sorted = [...rates.values()].sort((x, y) => y - x);
const gradeOf = id => { const r = rates.get(id), pct = (sorted.filter(x => x > r + 1e-9).length) / Math.max(1, roster.length - 1); return H.gradeOfPct(pct); };

const N = +(process.argv[2] || 1000), FOCI = Object.keys(H.engine.FOCUS), G = {};
for (let i = 0; i < N; i++) {
  let grade = null; const row = {};
  for (const f of FOCI) {
    const r = H.engine.runWar({ roster, seed: 'f' + i, focus: () => f });
    const you = r.entries.find(e => e.snap).snap.find(c => c.you).id;
    let fell = null; for (const e of r.entries) if (e.snap && !e.snap[you].alive) { fell = e.day; break; }
    row[f] = { win: r.winner === you ? 1 : 0, days: fell == null ? r.days : fell };
    grade = grade || gradeOf(r.camps[you].servantId);
  }
  (G[grade] = G[grade] || []).push(row);
}
let bad = 0;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
for (const g of H.GRADES.map(x => x[0])) {
  const l = G[g]; if (!l) continue;
  const win = f => mean(l.map(r => r[f].win)), days = f => mean(l.map(r => r[f].days));
  const best = FOCI.slice().sort((a, b) => win(b) - win(a))[0], rec = REC[g] || 'auto';
  // おすすめと最善の差（同じシードどうしで比べる）と、その誤差（標準誤差の2倍）
  const d = l.map(r => r[best].win - r[rec].win), md = mean(d), se = Math.sqrt(mean(d.map(x => (x - md) ** 2)) / Math.max(1, d.length - 1));
  const worse = md > 2 * se + 1e-9;
  if (worse) bad++;
  console.log(`評価${g}（${l.length}戦）おすすめ「${H.engine.FOCUS[rec].label}」 勝率${(win(rec) * 100).toFixed(1)}%${rec === best ? '（最善）' : ` ／ 最善「${H.engine.FOCUS[best].label}」${(win(best) * 100).toFixed(1)}%（差 ${(md * 100).toFixed(1)}±${(2 * se * 100).toFixed(1)}${worse ? '、誤差を超えて劣る' : '、誤差の範囲'}）`}`);
  console.log('   ' + FOCI.map(f => `${H.engine.FOCUS[f].label} ${(win(f) * 100).toFixed(1)}%/${days(f).toFixed(1)}日`).join('  '));
}
console.log(bad ? `NG：おすすめが最善より誤差を超えて劣る評価が${bad}つある。REC_FOCUS を見直す` : 'OK：どの評価でも、おすすめは最善と誤差の範囲で並ぶ');
process.exitCode = bad ? 1 : 0;
