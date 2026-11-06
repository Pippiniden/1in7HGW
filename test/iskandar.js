// 軍勢召喚（summon）の試し：イスカンダル（原作キャラ。データには入れず、ここで組み立てる）が実際にどれだけ強いか
// 使い方: node test/iskandar.js [戦争の数] [--no-summon]   … 順位は「出場した戦争での勝率」を、全員と比べる
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const fs = require('fs');
const H = HGW, E = H.effects, B = H.build;
const N = +process.argv.find(a => /^\d+$/.test(a)) || 1500, NOSUM = process.argv.includes('--no-summon');
const pub = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON).filter(s => !s.bossOnly);

const spec = {
  trueName: 'イスカンダル', class: 'ライダー', plain: true, alignment: '混沌・善', sex: '男', origin: 'ギリシャ神話・史実',
  stats: { str: 'B', end: 'A', agi: 'D', mag: 'C', luk: 'A+', np: 'A++' },
  classSkills: [],
  skills: [
    { name: 'カリスマ', rankRaw: 'A', desc: '軍団を指揮する天性の才能。' },
    { name: '軍略', rankRaw: 'B', desc: '一対一の戦闘ではなく、多人数を動員した戦場における戦術的直感。' },
    { name: '神性', rankRaw: 'C', desc: '神霊適性を持つか否か。' },
  ],
  nps: [
    { name: '遥かなる蹂躙制覇', reading: 'ヴィア・エクスプグナティオ', rankRaw: 'A+', typeRaw: '対軍宝具', rangeRaw: '2～50', maxRaw: '100人', desc: '神威の車輪による蹂躙。', attack: true },
    { name: '王の軍勢', reading: 'アイオニオン・ヘタイロイ', rankRaw: 'EX', typeRaw: '対軍宝具', rangeRaw: '1～99', maxRaw: '1000人', desc: '固有結界に生前の臣下たちを呼び出す。',
      attack: false, effects: NOSUM ? [] : [['summon', 3.5, { tag: '王の軍勢' }]] },
  ],
};
const r0 = B.leanFromSpec(spec);
Object.assign(E.SERVANT_OVERRIDES, r0.servantOv); Object.assign(E.NP_OVERRIDES, r0.npOv);
const isk = B.fromJSON(r0.lean); isk.bossOnly = false;
console.log('イスカンダル 戦闘力', isk.power.toFixed(1), '宝具の頂', (isk.npPeak || 0).toFixed(1), '効果', Object.keys(isk.effectSummary).join(' '));
for (const n of isk.nps) console.log('  宝具', n.name, 'attack=' + n.attackResolved, 'mode=' + (n.mode || '-'), (n.effects || []).map(e => e.id + ':' + (+e.mag).toFixed(2)).join(' '));

const roster = pub.concat([isk]);
const stat = {};   // id → { app, win, surv }
const logs = { appear: 0, block: 0, gone: 0 }; let errors = 0;
for (let i = 0; i < N; i++) {
  let r;
  try { r = H.engine.runWar({ roster, seed: 'is' + i, player: 'none', intrude: { on: false } }); } catch (e) { errors++; if (errors < 3) console.error(e.stack); continue; }
  const ids = (r.camps || []).map(c => c && (c.servantId || c.id));
  const win = new Set((r.winners && r.winners.length ? r.winners : r.winner != null ? [r.winner] : []).map(x => typeof x === 'object' ? x.id : x));
  (r.camps || []).forEach((c, k) => {
    const id = c.servantId || (c.sv && c.sv.id) || c.id; if (!id) return;
    const s = stat[id] = stat[id] || { app: 0, win: 0 };
    s.app++; if (win.has(k) || win.has(c.id)) s.win++;
  });
  if (i < 300) for (const e of r.entries) { if (/王の軍勢が現れた/.test(e.text)) logs.appear++; if (/王の軍勢が.*受け止めた/.test(e.text)) logs.block++; if (/王の軍勢は霧散した/.test(e.text)) logs.gone++; }
}
const rows = Object.entries(stat).filter(([, s]) => s.app >= 100).map(([id, s]) => ({ id, ...s, rate: s.win / s.app })).sort((a, b) => b.rate - a.rate);
const me = rows.findIndex(x => x.id === isk.id);
console.log(`${N}戦（エラー ${errors}）  出場した騎 ${rows.length}`);
if (me < 0) console.log('イスカンダルの出場が少ない', stat[isk.id]);
else {
  const x = rows[me], mean = rows.reduce((t, y) => t + y.rate, 0) / rows.length;
  console.log(`イスカンダル：出場 ${x.app}・勝利 ${x.win}・勝率 ${(x.rate * 100).toFixed(1)}%  全体の平均 ${(mean * 100).toFixed(1)}%  順位 ${me + 1}/${rows.length}（上位 ${(((me + 1) / rows.length) * 100).toFixed(0)}%）`);
  console.log('上位:', rows.slice(0, 5).map(y => `${y.id.split(':')[1]} ${(y.rate * 100).toFixed(0)}%`).join('  '));
  const ps = pub.slice().sort((a, b) => b.power - a.power), pr = ps.filter(s => s.power > isk.power).length + 1;
  console.log(`戦闘力の順位 ${pr}/${pub.length + 1}  軍勢（最初の300戦）出現 ${logs.appear}・受け止め ${logs.block}・霧散 ${logs.gone}`);
}
