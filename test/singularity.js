// 特異点攻略：全自動で何度も回して、エラー・結末の割合（人理修復の成功率）・倒した数・日数を見る。対話式の再現も確かめる
//   node test/singularity.js [回数] [シードを1つ表示]
//   node test/singularity.js 300 --focus=advance   （方針を固定して回す。auto advance search stealth rest defend）
//   node test/singularity.js 300 --set=foePower:0.1,encBase:0.3   （config.js の SING を一時的に変えて比べる）
const fs = require('fs');
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine', 'singdata', 'singularity']) require('../js/' + f + '.js');
const H = globalThis.HGW, E = H.effects;
const D = __dirname + '/../data/';
const man = JSON.parse(fs.readFileSync(D + 'manifest.json', 'utf8'));
for (const f of man.overrides || []) { const o = JSON.parse(fs.readFileSync(D + f, 'utf8')); for (const [k, t] of Object.entries(E.OVERRIDE_TABLES)) Object.assign(t, o[k] || {}); }
const raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(D + f, 'utf8')).servants);
H.build.harvestOverrides(raw);
const roster = raw.map(H.build.fromJSON);
const bspec = []; for (const f of man.bosses || []) bspec.push(...JSON.parse(fs.readFileSync(D + f, 'utf8')).bosses);
const { bosses, errors: bossErr } = H.singularity.prepareBosses(bspec);
if (bossErr.length) { console.error('ボスのデータを読めません', bossErr); process.exitCode = 1; }

const args = process.argv.slice(2), flag = k => (args.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const pos = args.filter(a => !a.startsWith('--'));
const n = +(pos[0] || 300), show = pos[1];
const fixFocus = flag('focus');
const sing = {};
for (const kv of (flag('set') || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split(':'), [k1, k2] = k.split('.');
  if (k2) sing[k1] = Object.assign({}, H.CONFIG.SING[k1], sing[k1], { [k2]: +v }); else sing[k1] = +v;
}
const focusFn = fixFocus ? () => fixFocus : undefined;

// ボス専用の英霊は聖杯戦争に呼ばれない
{
  const mix = roster.concat(bosses);
  for (let i = 0; i < 30; i++) { const w = H.engine.runWar({ roster: mix, seed: 'bossfree' + i }); if (w.camps.some(c => bosses.some(b => b.id === c.servantId))) { console.error('ボスが聖杯戦争に呼ばれた'); process.exitCode = 1; break; } }
}

if (show) {
  const r = H.singularity.run({ roster, bosses, seed: show, sing, focus: focusFn });
  for (const e of r.entries) console.log(`[${e.day}${e.phase[0]}] ${e.kind.padEnd(8)} ${e.you ? '★' : ' '} ${e.text}${e.quote ? '  「' + e.quote.text + '」' : ''}`);
  console.log(`\n${r.name}（${r.region}）  結末: ${r.ending}  ${r.days}日  倒した敵 ${r.slain}/${r.foes}  令呪 ${r.cs}  全滅からの復帰 ${r.revived}`);
  console.log('味方: ' + r.party.map(c => `${c.label}${c.trueName}${c.alive ? '' : '✝'}`).join(' / '));
  console.log('敵  : ' + r.enemies.map(c => `${c.label}${c.trueName}${c.alive ? '' : '✝'}`).join(' / '));
  if (r.boss) console.log(`ボス: ${r.boss.trueName}${r.boss.empowered ? '（超強化）' : ''} ゲージ ${r.boss.gauges}/${r.boss.gaugeMax} ${r.boss.alive ? '健在' : '撃破'}`);
  process.exit(0);
}

const ends = { clear: 0, wipe: 0, master: 0, timeout: 0 }, slain = [], days = [], reachBoss = [0, 0];
let errs = 0, entries = 0, battles = 0, revived = 0, strays = 0, cs = 0, bossKind = { boss: 0, empower: 0 }, bossClear = { boss: 0, empower: 0 };
for (let i = 0; i < n; i++) {
  let r;
  try { r = H.singularity.run({ roster, bosses, seed: 'sg' + i, sing, focus: focusFn }); } catch (e) { errs++; if (errs < 4) console.error(e); continue; }
  ends[r.ending]++; slain.push(r.slain); days.push(r.days); entries += r.entries.length; revived += r.revived; strays += r.strayJoined ? 1 : 0; cs += r.cs;
  battles += r.entries.filter(e => e.kind === 'battle' && e.head).length;
  if (r.stage === 'boss') reachBoss[0]++;
  const bk = r.boss && r.boss.empowered ? 'empower' : 'boss'; bossKind[bk]++; if (r.ending === 'clear') bossClear[bk]++;
}
const ok = n - errs, pct = x => (x / Math.max(1, ok) * 100).toFixed(1) + '%';
slain.sort((a, b) => a - b); days.sort((a, b) => a - b);
console.log({ n, errs, focus: fixFocus || 'auto', set: Object.keys(sing).length ? sing : undefined,
  clear: pct(ends.clear), wipe: pct(ends.wipe), master: pct(ends.master), timeout: pct(ends.timeout), reachBoss: pct(reachBoss[0]),
  slainMedian: slain[slain.length >> 1], daysMedian: days[days.length >> 1], battlesPerRun: (battles / ok).toFixed(1), entriesAvg: Math.round(entries / ok),
  revivedPerRun: (revived / ok).toFixed(2), strayJoin: pct(strays), csLeft: (cs / ok).toFixed(2),
  bossClear: `専用 ${bossClear.boss}/${bossKind.boss}・超強化 ${bossClear.empower}/${bossKind.empower}` });

// 対話式：ランダムな方針・令呪・推測・答えで回し、同じ入力で同じ結果になるか
const FOC = Object.keys(H.singularity.FOCUS);
let mismatch = 0, ierr = 0, asks = 0;
function play(seed, front, pickAns, pickTick) {
  const out = {}, L = H.singularity.compose({ roster, bosses, seed });
  const g = H.singularity.gen({ roster, bosses, seed, lineup: L, front, ask: 'big', out });
  let r = g.next(); const log = [];
  while (!r.done) {
    if (r.value.type === 'tick') { const t = pickTick(r.value.day, out); log.push(t); r = g.next(t); }
    else { asks++; const k = pickAns(r.value); log.push(k); r = g.next(k); }
  }
  return { res: r.value, log };
}
for (let i = 0; i < Math.min(60, n); i++) {
  try {
    let k = 0;
    const front = [(i % 6), ((i + 2) % 6), ((i + 4) % 6)];
    const tick = (d, out) => {
      const cmds = [];
      if (d % 7 === 3) cmds.push({ k: 'heal', t: i % 6 });
      if (d % 11 === 5) cmds.push({ k: 'mana' });
      const last = out.entries && out.entries.length ? out.entries[out.entries.length - 1].snap : null;
      const foe = last && last.c.find(c => c.side === 'foe' && c.alive && c.seen && !c.name);
      if (foe && d % 2) cmds.push({ k: 'guess', t: foe.id, sv: roster[(i * 13 + d) % roster.length].id });
      return { f: FOC[(i + Math.floor(d / 3)) % FOC.length], cmds };
    };
    const a = play('si' + i, front, q => q.options[(i * 5 + k++) % q.options.length].k, tick);
    let j = 0;
    const b = play('si' + i, front, () => a.log[j++], () => a.log[j++]);
    if (JSON.stringify(a.res.party) !== JSON.stringify(b.res.party) || a.res.ending !== b.res.ending || a.res.entries.length !== b.res.entries.length) mismatch++;
  } catch (e) { ierr++; if (ierr < 4) console.error(e); }
}
console.log({ interactive: Math.min(60, n), ierr, mismatch, asksPerRun: (asks / Math.min(60, n) / 2).toFixed(1) });
// ボスの試し（リストツールの「ボスを試す」）：万全なら必ずボス戦から始まり、消耗ありはそこへ至るまでに減る
let terr = 0;
if (bosses.length) {
  const a = H.singularity.bossTrial({ roster, boss: bosses[0], n: 20, fresh: true }), b = H.singularity.bossTrial({ roster, boss: bosses[0], n: 20, fresh: false });
  terr = a.errors + b.errors + (a.reach === a.n - a.errors ? 0 : 1) + (b.reach <= b.n ? 0 : 1);
  console.log({ bossTrial: bosses[0].trueName, fresh: { clear: a.clear, reach: a.reach, n: a.n }, worn: { clear: b.clear, reach: b.reach, n: b.n }, terr });
}
if (errs || ierr || mismatch || terr) process.exitCode = 1;

// 考えて動くプレイヤーの例（--smart）：傷が浅いうちに休み、ボスの前に令呪で魔力を満たし、全滅に備えて令呪を残す。
// おまかせより成功率が上がるか（＝方針に意味があるか）を見る
if (args.includes('--smart')) {
  const res = { clear: 0, wipe: 0, master: 0, timeout: 0 }; let boss = 0;
  for (let i = 0; i < n; i++) {
    const out = {}, seed = 'sg' + i, L = H.singularity.compose({ roster, bosses, seed });
    const g = H.singularity.gen({ roster, bosses, seed, lineup: L, ask: 'big', out, sing });
    let r = g.next(), usedMana = false;
    while (!r.done) {
      if (r.value.type === 'tick') {
        const sn = out.entries.length ? out.entries[out.entries.length - 1].snap : null;
        let f = 'search'; const cmds = [];
        if (sn) {
          const fr = sn.c.filter(c => c.side === 'party' && c.alive && c.front), hp = fr.length ? fr.reduce((t, c) => t + c.hp, 0) / fr.length : 100;
          if (sn.p.stage === 'boss') {
            f = hp < 70 || sn.p.mana < 45 ? 'rest' : 'advance';
            if (!usedMana && sn.p.cs >= 1 && sn.p.mana < 70 && f === 'advance') { cmds.push({ k: 'mana' }); usedMana = true; }
          } else f = hp < 50 || sn.p.mana < 30 ? 'rest' : r.value.day % 2 ? 'search' : 'advance';
        }
        r = g.next({ f, cmds });
      } else {
        const q = r.value;
        r = g.next(q.kind === 'cs' ? (out.entries.length && out.entries[out.entries.length - 1].snap.p.stage === 'boss' ? 'heal' : 'none') : 'auto');
      }
    }
    res[r.value.ending]++; if (r.value.stage === 'boss') boss++;
  }
  console.log({ smart: n, clear: (res.clear / n * 100).toFixed(1) + '%', wipe: res.wipe, master: res.master, timeout: res.timeout, reachBoss: (boss / n * 100).toFixed(1) + '%' });
}
