#!/usr/bin/env node
/* スキル・宝具の効果の点検：付けても働かない設定や、誰にも当たらない相手の属性を一覧にする
 *
 *   node tools/fxcheck.js                 # 全員（手直し表 overrides.json を当てた、ゲームと同じ組み立て）
 *   node tools/fxcheck.js --grep 秀吉      # 名前で絞る
 *   node tools/fxcheck.js --weak          # とても弱い効果（実際の強さが WEAK 未満の割合・確率の効果）も出す
 *   node tools/fxcheck.js --data <dir>    # 別の data フォルダ
 *
 * 見るもの：
 *   働かない設定  … effects.js の deadParams（戦いの外で読む効果に戦いの中の発動・相手の属性、属性付与に条件、など）
 *   誰にも当たらない … 相手の属性の条件（vs）・特攻・弱点の相手が、リストの誰の属性にも無い
 *   とても弱い    … 条件・確率・日数をならした強さが小さく、ゲームでほとんど差が出ない（--weak のときだけ）
 * 直すときは roster.html の効果の編集（「発動・条件など」にその効果で働く欄だけが出る）か、overrides.json。
 */
'use strict';
const path = require('path');
const L = require('./datalib');
const { E, B } = L;

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dir = opt('--data') || path.join(L.ROOT, 'data'), grep = opt('--grep'), weak = args.includes('--weak');
const WEAK = 0.03;

const { roster } = L.loadDir(dir);
const allTags = new Set(roster.flatMap(s => s.tags || []));
const out = [], count = {};
const note = (sv, item, e, why, kind) => { out.push({ sv, item, e, why }); count[kind] = (count[kind] || 0) + 1; };
for (const sv of roster) {
  if (grep && !sv.trueName.includes(grep) && !sv.id.includes(grep)) continue;
  const items = (sv.allSkills || []).map(x => [x, false]).concat((sv.nps || []).map(x => [x, x.mode !== 'always']));
  for (const [item, np] of items) for (const e of item.effects || []) {
    const p = e.params || {};
    const dead = E.deadParams(e.id, p, np);
    if (dead.length) note(sv, item, e, '働かない設定：' + dead.join('・'), '働かない設定');
    for (const [k, t] of [['vs', p.vs], ['tag', ['power_vs', 'weakness'].includes(e.id) ? p.tag : null]]) if (t && !allTags.has(t)) note(sv, item, e, `「${t}」の属性を持つ英霊がリストにいない（${k === 'vs' ? (p.vsNot ? 'いつでも働く' : '働かない') : '特攻・弱点が当たらない'}）`, '誰にも当たらない');
    const unit = (E.EFFECTS[e.id] || {}).unit;
    if (weak && (unit === 'rate' || unit === 'chance') && e.mag > 0) {
      const w = Math.abs(e.mag) * (p.cond ? 0.4 : 1) * (p.vs ? 0.3 : 1) * (p.chance != null ? Math.max(0, Math.min(1, p.chance)) : 1) * (p.dmin || p.dmax || p.grow || p.decay ? 0.6 : 1);
      if (w < WEAK) note(sv, item, e, `とても弱い（強さ ${Math.round(e.mag * 1000) / 10}%${E.hasCond(p) ? '・条件つき' : ''}）`, 'とても弱い');
    }
  }
}
let last = '';
for (const { sv, item, e, why } of out) {
  if (sv.id !== last) { console.log(`\n■ ${sv.id}`); last = sv.id; }
  const d = E.describe(e, { np: (sv.nps || []).includes(item), npMode: item.mode });
  console.log(`  ${item.name}：${d.name}${E.condShort(e.params)}  — ${why}`);
}
console.log(`\n${out.length ? Object.entries(count).map(([k, n]) => `${k} ${n}件`).join('・') : '気になる効果はありません'}（${roster.length}騎）`);
