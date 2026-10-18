#!/usr/bin/env node
/* Chaldea（https://github.com/chaldea-center/chaldea のデータ chaldea-data）から、FGO のスキル名 → 効果の部品の表を作る
 *
 *   node tools/chaldea.js <chaldea-data のフォルダ> [--out js/fgoskills.js]
 *
 * chaldea-data の dist/servants.*.json・dist/baseSkills.json・dist/baseFunctions.json を読み、実装済みのサーヴァントの保有スキルと
 * クラス別スキルについて、FGO での働き（攻撃力アップ・回避・ガッツ・弱体化など）をこのゲームの効果の部品に置き換える。
 * 説明文は持ち込まず、スキル名と部品だけを js/fgoskills.js に書く。辞書（effects.js の SKILL_DICT）で決まる名前は入れない。
 * ゲームでは、辞書にも説明文にも手がかりが無いスキル（今までの「仮の効果」）だけがこの表を使う（effects.js の resolveSkill）。
 * データを取り直すとき：git clone --depth 1 --filter=blob:none https://github.com/chaldea-center/chaldea-data してから実行
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['config', 'rank', 'parser', 'effects']) require(path.join(ROOT, 'js', f + '.js'));
const E = globalThis.HGW.effects, R = globalThis.HGW.rank;

const args = process.argv.slice(2);
const src = args.find(a => !a.startsWith('--'));
const oi = args.indexOf('--out'), out = oi >= 0 ? args[oi + 1] : path.join(ROOT, 'js', 'fgoskills.js');
if (!src) { console.error('使い方: node tools/chaldea.js <chaldea-data のフォルダ> [--out js/fgoskills.js]'); process.exit(2); }
const dist = path.join(src, 'dist');
const read = f => JSON.parse(fs.readFileSync(path.join(dist, f), 'utf8'));
const svts = fs.readdirSync(dist).filter(f => /^servants\.\d+\.json$/.test(f)).flatMap(read);
const skills = new Map(Object.values(read('baseSkills.json')).map(s => [s.id, s]));
const funcs = new Map(Object.values(read('baseFunctions.json')).map(f => [f.funcId, f]));

// FGO の働き → 効果の部品（係数）。味方全体・味方一人に掛かる強化は、統率（同盟相手との連携）にも少し足す
const ALLY = /^pt/, ENEMY = /^enemy/;
const SELF_BUFF = {
  upAtk: ['power', 0.6], upCommandall: ['power', 0.5], upCommandatk: ['power', 0.4], upDamage: ['power', 0.5],
  upDamageIndividuality: ['power', 0.4], upDamageIndividualityActiveonly: ['power', 0.4], upNpdamage: ['np_boost', 0.6],
  upDefence: ['guard', 0.6], subSelfdamage: ['guard', 0.5], upDefencecommandall: ['guard', 0.4],
  invincible: ['evade', 0.6], avoidance: ['evade', 0.6], guts: ['guts', 0.8], gutsFunction: ['guts', 0.8],
  upCriticaldamage: ['crit', 0.5], upCriticalrate: ['crit', 0.4], upCriticalpoint: ['crit', 0.3], regainStar: ['crit', 0.3], upStarweight: ['crit', 0.2],
  regainNp: ['np_boost', 0.4], upDropnp: ['np_boost', 0.3], upChagetd: ['np_boost', 0.4],
  upTolerance: ['mental_guard', 0.5], avoidState: ['mental_guard', 0.5], upToleranceSubstate: ['mental_guard', 0.4],
  pierceInvincible: ['pierce', 0.6], breakAvoidance: ['pierce', 0.6], pierceDefence: ['pierce', 0.5],
  regainHp: ['regen', 0.5], upGainHp: ['regen', 0.3], addMaxhp: ['regen', 0.3],
};
const SELF_FUNC = { gainNp: ['np_boost', 0.5], hastenNpturn: ['np_boost', 0.4], gainStar: ['crit', 0.3], gainHp: ['regen', 0.5], subState: ['mental_guard', 0.3] };
const ENEMY_BUFF = {
  downAtk: ['debuff', 0.6], downDefence: ['debuff', 0.6], downDefencecommandall: ['debuff', 0.5], downCommandall: ['debuff', 0.5],
  downCriticalrate: ['debuff', 0.3], downCriticalpoint: ['debuff', 0.2], downNpdamage: ['debuff', 0.4], downTolerance: ['debuff', 0.3],
  donotAct: ['charm', 0.7], donotNoble: ['debuff', 0.5], donotSkill: ['debuff', 0.4],
};
const ENEMY_FUNC = { lossNp: ['debuff', 0.4], delayNpturn: ['debuff', 0.4], instantDeath: ['instakill', 0.6], forceInstantDeath: ['instakill', 0.6] };
function specsOf(skill) {
  const acc = new Map();
  const add = (id, f) => acc.set(id, Math.min(1.2, (acc.get(id) || 0) + f));
  for (const x of skill.functions || []) {
    const f = funcs.get(x.funcId); if (!f) continue;
    const t = f.funcTargetType || '', bt = f.buffs && f.buffs[0] && f.buffs[0].type;
    let m = null;
    if (ENEMY.test(t)) m = (bt && ENEMY_BUFF[bt]) || ENEMY_FUNC[f.funcType];
    else {
      m = (bt && SELF_BUFF[bt]) || SELF_FUNC[f.funcType];
      if (m && m[0] === 'regen' && ALLY.test(t)) m = ['heal_other', m[1]];
      if (m && ALLY.test(t) && ['power', 'guard', 'np_boost', 'crit'].includes(m[0])) add('rally', 0.3);
    }
    if (m) add(m[0], m[1]);
  }
  return [...acc].map(([id, f]) => [id, Math.round(f * 10) / 10]).filter(s => s[1] > 0);
}
// スキル名から末尾のランク（「 A+」「 EX」）を外し、辞書と同じ形に
const nameOf = n => E.normName(R.normalize(String(n || '')).replace(/\s+(?:EX|[A-E])[+\-]*(?:[~～](?:EX|[A-E])[+\-]*)?$/, '').trim());
const SKIP = /ドロップ|獲得数アップ|英霊紀行|ポイント|経験値|絆獲得/;

const table = {}, holders = {};
for (const s of svts) {
  if (!(s.collectionNo > 0)) continue;
  for (const ref of (s.skills || []).concat(s.classPassive || [])) {
    const k = skills.get(ref.id); if (!k || !k.name || SKIP.test(k.name)) continue;
    const n = nameOf(k.name); if (!n || n.length < 2) continue;
    if (E.SKILL_DICT[n] || E.lookupDict(n)) continue;          // 辞書で決まる名前は辞書に任せる
    (holders[n] = holders[n] || new Set()).add(s.name);
    if (table[n]) continue;
    const sp = specsOf(k); if (sp.length) table[n] = sp;
  }
}
const keys = Object.keys(table).sort();
const body = keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`).join('\n');
fs.writeFileSync(out, `/* FGO のスキル名 → 効果の部品（tools/chaldea.js が Chaldea のデータ chaldea-data から作る。手で直さない）
 *   出典：https://github.com/chaldea-center/chaldea-data（ゲームデータは Atlas Academy 経由）。スキルの説明文は持ち込まず、名前と働きの分類だけ。
 *   辞書（effects.js の SKILL_DICT）にも説明文にも手がかりが無いスキルだけが、この表を使う（resolveSkill の source 'fgo'）。
 *   ${keys.length}語・${svts.filter(s => s.collectionNo > 0).length}騎から
 */
(function (G) {
  'use strict';
  G.FGO_SKILLS = {
${body}
  };
})(globalThis.HGW = globalThis.HGW || {});
`);
console.log(`${out} を書きました：${keys.length}語（${svts.filter(s => s.collectionNo > 0).length}騎のスキルから。辞書にある名前は除く）`);
