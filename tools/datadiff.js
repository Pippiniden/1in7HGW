#!/usr/bin/env node
/* 二つの data/ フォルダ（変更前・変更後）を見比べて、何が変わったかを Markdown で書く
 *
 *   node tools/datadiff.js 変更前のフォルダ [変更後のフォルダ=data] [--summary 報告.md]
 *
 * 英霊の追加・削除・変更（どの項目が変わったか、戦闘力・宝具の威力・評価の変化）と、手直し表（overrides.json）の
 * 表ごとの追加・変更・削除を出す。GitHub Actions の「データの反映」（.github/workflows/data.yml）から使う。
 */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./datalib');
const { B } = L;

const SECTIONS = [
  ['class', 'クラス', s => s.class && (s.class.raw || s.class.label)],
  ['stats', 'ステータス', s => s.stats],
  ['skills', 'スキル', s => (s.classSkills || []).concat(s.skills || []).map(x => [x.name, x.rankRaw, x.desc])],
  ['nps', '宝具', s => (s.nps || []).map(x => [x.name, x.reading, x.rankRaw, x.typeRaw, x.desc])],
  ['voice', 'セリフ', s => s.voice],
  ['text', '解説・人物', s => s.text],
  ['profile', 'プロフィール', s => s.profile],
  ['relations', '因縁', s => s.relations],
  ['basic', '基本情報', s => [s.origin, s.sex, s.alignment, s.attribute, s.traits, s.aliases]],
  ['page', 'ページ名', s => [s.page, s.pageMissing && s.pageMissing.tried]],
];
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.keys(x).sort().reduce((o, k) => (o[k] = canon(x[k]), o), {}) : x;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const TABLE_JA = { global: 'スキル全体の効果', servant: '英霊ごとの効果', stats: 'ステータス', np: '宝具の攻撃／補助', content: '内容の手直し', pages: 'ページ名', reviewed: '確認済みの要確認', attrs: '属性マスタ', attrOf: '英霊ごとの属性', boss: 'ボスの設定' };

function diff(oldDir, newDir) {
  const A = L.loadDir(oldDir), gA = L.grades(A.roster);
  const leanA = new Map(A.raw.map(s => [(s.class && s.class.key || 'extra') + ':' + L.E.okey(s), s]));
  const builtA = new Map(A.roster.map(s => [s.id, s]));
  const Bn = L.loadDir(newDir), gB = L.grades(Bn.roster);
  const builtB = new Map(Bn.roster.map(s => [s.id, s]));
  // 公開用のデータの見比べは、組み立て直した軽い形どうしで（クラスの読み直しなどを吸収する）
  const leanOf = s => B.toLean(s);
  const added = [], removed = [], changed = [], gradeMoves = [];
  for (const [id, b] of builtB) {
    const a = builtA.get(id);
    if (!a) { added.push(b); continue; }
    const la = leanOf(a), lb = leanOf(b);
    const secs = SECTIONS.filter(([, , f]) => !same(f(la), f(lb))).map(([, ja]) => ja);
    const eff = !same(a.allSkills.map(x => x.effects), b.allSkills.map(x => x.effects)) || !same(a.nps.map(x => [x.effects, x.attackResolved]), b.nps.map(x => [x.effects, x.attackResolved]));
    if (eff && !secs.includes('スキル') && !secs.includes('宝具')) secs.push('効果の読み取り');
    if (!same(a.contentEdited, b.contentEdited)) secs.push('内容の手直し');
    const ga = gA.grade.get(id), gb = gB.grade.get(id);
    const nums = a.power !== b.power || (a.npPeak || 0) !== (b.npPeak || 0);
    if (secs.length || nums) changed.push({ a, b, secs, ga, gb });
    else if (ga !== gb) gradeMoves.push({ b, ga, gb });
  }
  for (const [id, a] of builtA) if (!builtB.has(id)) removed.push(a);

  // 手直し表
  const ov = [];
  for (const t of Object.keys(TABLE_JA)) {
    const x = A.overrides[t] || {}, y = Bn.overrides[t] || {};
    const add = Object.keys(y).filter(k => !(k in x)), del = Object.keys(x).filter(k => !(k in y)), mod = Object.keys(y).filter(k => k in x && !same(x[k], y[k]));
    if (add.length || del.length || mod.length) ov.push({ t, add, del, mod });
  }

  // 書く
  const nm = s => `${s.class.label}「${s.trueName}」`;
  const list = (arr, f, max = 30) => arr.slice(0, max).map(f).join('、') + (arr.length > max ? ` ほか${arr.length - max}` : '');
  const num = (x, y) => x === y ? `${x}` : `${x} → **${y}**`;
  const L2 = [];
  L2.push(`英霊：${A.roster.length}騎 → ${Bn.roster.length}騎（追加 ${added.length}・削除 ${removed.length}・変更 ${changed.length}）` + (ov.length ? `・手直し表の変更 ${ov.reduce((t, x) => t + x.add.length + x.del.length + x.mod.length, 0)}件` : ''));
  if (added.length) L2.push('', '### 追加', ...added.map(s => `- ${nm(s)}：戦闘力 ${s.power}・宝具 ${s.npPeak || '—'}・評価 ${gB.grade.get(s.id)}・スキル ${s.allSkills.length}・宝具 ${s.nps.length}` + (s.review.length ? `・要確認 ${s.review.filter(r => r.kind !== 'class').length}` : '')));
  if (removed.length) L2.push('', '### 削除', '- ' + list(removed, nm, 60));
  if (changed.length) {
    L2.push('', '### 変更', '| 英霊 | 変わった項目 | 戦闘力 | 宝具の威力 | 評価 |', '|---|---|---|---|---|');
    for (const c of changed.slice(0, 80)) L2.push(`| ${nm(c.b)} | ${c.secs.join('・') || '（数値のみ）'} | ${num(c.a.power, c.b.power)} | ${num(c.a.npPeak || '—', c.b.npPeak || '—')} | ${num(c.ga, c.gb)} |`);
    if (changed.length > 80) L2.push(`| ほか ${changed.length - 80}騎 | | | | |`);
  }
  if (gradeMoves.length) L2.push('', `### 評価だけ変わった騎（ほかの騎が変わったため。評価はリストの中の順位なので）`, '- ' + list(gradeMoves, x => `${x.b.trueName} ${x.ga}→${x.gb}`, 40));
  if (ov.length) {
    L2.push('', '### 手直し表（overrides.json）');
    for (const x of ov) L2.push(`- ${TABLE_JA[x.t]}（${x.t}）：` + [x.add.length && `追加 ${list(x.add, k => k, 12)}`, x.mod.length && `変更 ${list(x.mod, k => k, 12)}`, x.del.length && `削除 ${list(x.del, k => k, 12)}`].filter(Boolean).join(' ／ '));
  }
  if (!added.length && !removed.length && !changed.length && !ov.length) L2.push('', '英霊と手直し表に違いはありません。');
  if (Bn.errors.length) L2.push('', '### 読めなかったもの', ...Bn.errors.map(e => '- ' + e));
  return { md: L2.join('\n'), counts: { added: added.length, removed: removed.length, changed: changed.length, overrides: ov.length, grade: gradeMoves.length } };
}

if (require.main === module) {
  const args = process.argv.slice(2), o = { dirs: [], summary: null };
  for (let i = 0; i < args.length; i++) { if (args[i] === '--summary') o.summary = args[++i]; else o.dirs.push(args[i]); }
  if (!o.dirs.length) { console.error('使い方: node tools/datadiff.js 変更前のフォルダ [変更後のフォルダ] [--summary 報告.md]'); process.exit(2); }
  const r = diff(path.resolve(o.dirs[0]), path.resolve(o.dirs[1] || path.join(L.ROOT, 'data')));
  if (o.summary) fs.writeFileSync(o.summary, r.md + '\n'); else console.log(r.md);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(r.counts).map(([k, v]) => `diff_${k}=${v}\n`).join(''));
}
module.exports = { diff };
