#!/usr/bin/env node
/* サーヴァント1騎ずつを扱うCLI（data/servants.json は大きいので、丸ごと読まずにこれで見る・足す）
 *
 *   node tools/servant.js index [--grep 語] [--names]       一覧（1騎1行。chars = その騎を全部出したときの文字数）
 *   node tools/servant.js show <真名|id|別名|ページ名> [--part 部分,…] [--all]
 *                                                           1騎を出す。既定は core（ゲームの強さを決める部分だけ）
 *   node tools/servant.js add <ファイル.json …|-> [--dry-run]
 *                                                           個別のサーヴァントのJSONを元データ（servants.json）に足す・更新する
 *   node tools/servant.js remove <真名|id> [別の騎 …] [--keep-overrides] [--dry-run]
 *                                                           元データから削除する（manifest に並ぶ全ファイルから。手直し表の取り残しも片付ける）
 *   node tools/servant.js wipe <真名|id> [別の騎 …] [--dry-run]
 *                                                           その騎に付いた手直しだけを消す（取り違えて取り込んだとき。ページ名は残す）
 *   node tools/servant.js check                             元データの整合を確かめる（問題があれば終了コード1）
 *
 *   共通：--data <dir>（既定 data。テストや試し書き用）
 *
 * 部分（--part）：core（名前・クラス・ステータス・スキル・宝具・武器）／text（解説・人物・コメント）／voice（セリフ）／
 *   profile（プロフィール）／relations（因縁）／meta（ページ名・info・警告・読み取りで外した項目など）／source（Wikiの原文）
 *   複数はカンマ区切り（例：core,text）。--all は保存されている形そのまま。
 *
 * add に渡せるもの：英霊1騎のJSON／その配列／{ servants: [...] }（リストツールの書き出しもよい）。
 *   - 書いた項目だけが入れ替わる。書かなかった項目（セリフ・解説・原文など）は今のまま残る → show の出力を直して add で戻せる
 *   - 新しい騎は、trueName・class・stats があれば足せる。ランクは文字列でよい（stats: { str: 'A', … }、rankRaw: 'B+'）
 *   - 同じ id（クラス＋真名）があれば更新、なければ追加。並び（クラス順→真名）と書き方は incoming.js と同じ
 *   - 手直し表（overrides.json）に載っている手直しは、ゲームと同じく掛けて組み直す（ここでは書き換えない）
 *
 * remove：同じ id がどのファイル（servants.json・packs/…）にあっても消す。packs に残っていると、servants.json から消しても
 *   ゲームには出続けるため。手直し表（servant・np・stats・content・pages・reviewed）にその騎の名前で残った手直しも消す
 *   （--keep-overrides で残す。同じ真名の別クラスの騎がいるときは触らない）。data/incoming/ に同じ騎を含むファイルが残っていれば、
 *   次の反映で復活するので知らせる。
 */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./datalib');
const { H, B } = L;
const R = H.rank;

const STAT_KEYS = B.STAT_KEYS;
const KEY_ORDER = ['kind', 'id', 'trueName', 'aliases', 'class', 'origin', 'sex', 'alignment', 'attribute', 'traits', 'stats', 'statsAlt',
  'classSkills', 'skills', 'nps', 'weapons', 'profile', 'relations', 'voice', 'text', 'info', 'warnings', 'body', 'sourceText'];
const PARTS = {
  core: ['trueName', 'aliases', 'class', 'origin', 'sex', 'alignment', 'attribute', 'traits', 'stats', 'classSkills', 'skills', 'nps', 'weapons'],
  text: ['text'], voice: ['voice'], profile: ['profile'], relations: ['relations'], source: ['sourceText'],
};
const SKILL_FIELDS = ['name', 'rankRaw', 'desc'], NP_FIELDS = ['name', 'reading', 'rankRaw', 'typeRaw', 'rangeRaw', 'maxRaw', 'desc'], WEAPON_FIELDS = ['name', 'reading', 'desc'];

const fail = msg => { console.error(msg); process.exit(1); };
const j = (x, sp) => JSON.stringify(x, null, sp);
const idOf = s => s.id || ((s.class && (s.class.key || H.parser.parseClass(s.class.raw || s.class.label || '').key)) || 'extra') + ':' + s.trueName;

/* ---------- 引数 ---------- */
function parseArgs(argv) {
  const o = { _: [], flags: new Set(), opt: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') o._.push(a);
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['dry-run', 'names', 'all', 'json'].includes(k)) o.flags.add(k); else o.opt[k] = argv[++i];
    } else o._.push(a);
  }
  return o;
}

/* ---------- 読み書き ---------- */
function dirs(args) { const dir = path.resolve(args.opt.data || path.join(L.ROOT, 'data')); return { dir, man: path.join(dir, 'manifest.json'), sv: path.join(dir, 'servants.json'), ov: path.join(dir, 'overrides.json') }; }

/** 公開データを読む（ゲームと同じく manifest の servants を順に。同じ id は後ろが優先） */
function loadAll(P) {
  const files = fs.existsSync(P.man) ? (L.readJSON(P.man).servants || []) : [];
  const byId = new Map();
  for (const f of files) {
    const p = path.join(P.dir, f);
    if (!fs.existsSync(p)) continue;
    for (const s of L.listOf(L.readJSON(p))) byId.set(idOf(s), s);
  }
  return { files, byId };
}
function loadOverrides(P) { L.clearOverrides(); if (fs.existsSync(P.ov)) L.applyOverrides(L.readJSON(P.ov)); }
function readPack(P) { return fs.existsSync(P.sv) ? L.readJSON(P.sv) : { format: 'hgw-servants', version: 2, lean: true, servants: [] }; }
function writePack(P, pack, list) {
  pack.servants = L.sortLean(list); pack.format = 'hgw-servants'; pack.version = 2; pack.lean = true; pack.at = new Date().toISOString();
  fs.writeFileSync(P.sv, j(pack, 1) + '\n');
}

/* ---------- 切り出し ---------- */
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
function core(s) {
  const o = { id: idOf(s) };
  for (const k of ['trueName', 'aliases', 'origin', 'sex', 'alignment', 'attribute', 'traits']) if (s[k] !== undefined) o[k] = s[k];
  o.class = s.class && (s.class.raw || s.class.label) || '';
  o.stats = {}; for (const k of STAT_KEYS) { const v = s.stats && s.stats[k]; o.stats[k] = v ? (typeof v === 'string' ? v : v.raw) : ''; }
  o.classSkills = (s.classSkills || []).map(x => pick(x, SKILL_FIELDS));
  o.skills = (s.skills || []).map(x => pick(x, SKILL_FIELDS));
  o.nps = (s.nps || []).map(x => pick(x, NP_FIELDS));
  o.weapons = (s.weapons || []).map(x => pick(x, WEAPON_FIELDS));
  return o;
}
const META_SKIP = new Set([...PARTS.core, ...PARTS.text, ...PARTS.voice, ...PARTS.profile, ...PARTS.relations, ...PARTS.source, 'kind', 'id', 'statsAlt']);
const meta = s => { const o = {}; for (const k of Object.keys(s)) if (!META_SKIP.has(k)) o[k] = s[k]; if (s.statsAlt && s.statsAlt.length) o.statsAlt = s.statsAlt; return o; };
function part(s, name) {
  if (name === 'core') return core(s);
  if (name === 'meta') return meta(s);
  const keys = PARTS[name]; if (!keys) fail(`部分「${name}」は知りません（core, text, voice, profile, relations, meta, source）`);
  return pick(s, keys);
}

function find(byId, q) {
  if (byId.has(q)) return byId.get(q);
  const all = [...byId.values()];
  const exact = all.filter(s => s.trueName === q || (s.aliases || []).includes(q) || s.page === q);
  if (exact.length === 1) return exact[0];
  const hits = exact.length ? exact : all.filter(s => s.trueName.includes(q) || (s.aliases || []).some(a => a.includes(q)));
  if (hits.length === 1) return hits[0];
  if (!hits.length) fail(`「${q}」は見つかりません（node tools/servant.js index --grep ${q} で探せます）`);
  fail(`「${q}」は複数に当たります。id で指定してください：\n` + hits.map(s => '  ' + idOf(s)).join('\n'));
}

/* ---------- index ---------- */
function cmdIndex(args, P) {
  const { byId } = loadAll(P), grep = args.opt.grep;
  let list = L.sortLean([...byId.values()]);
  if (grep) {
    const g = grep.normalize('NFKC');
    list = list.filter(s => [s.id, s.trueName, ...(s.aliases || []), s.page || '', s.origin || '', ...(s.skills || []).map(x => x.name), ...(s.classSkills || []).map(x => x.name), ...(s.nps || []).map(x => x.name + (x.reading || ''))]
      .join('\n').normalize('NFKC').includes(g));
  }
  let total = 0;
  for (const s of list) {
    const stats = STAT_KEYS.map(k => { const v = s.stats && s.stats[k]; return (v && (typeof v === 'string' ? v : v.raw)) || '?'; }).join(' ');
    const chars = j(s).length; total += chars;
    let line = `${idOf(s)}  [${stats}]  chars=${chars}`;
    if (args.flags.has('names')) line += `\n    スキル: ${[...(s.classSkills || []), ...(s.skills || [])].map(x => x.name).join('、') || '-'}\n    宝具: ${(s.nps || []).map(x => x.name).join('、') || '-'}`;
    else line += `  skills=${(s.classSkills || []).length + (s.skills || []).length} nps=${(s.nps || []).length}`;
    console.log(line);
  }
  console.error(`${list.length}騎（ステータスは 筋 耐 敏 魔 運 宝 の順。全部出すと ${total} 文字）`);
}

/* ---------- show ---------- */
function cmdShow(args, P) {
  const q = args._[1]; if (!q) fail('使い方：node tools/servant.js show <真名|id> [--part core,text,voice,profile,relations,meta,source | --all]');
  const { byId } = loadAll(P), s = find(byId, q);
  let out;
  if (args.flags.has('all')) out = s;
  else {
    const names = (args.opt.part || 'core').split(',').map(x => x.trim()).filter(Boolean);
    out = { id: idOf(s) };
    for (const n of names) Object.assign(out, part(s, n));
  }
  const text = j(out, 1);
  console.log(text);
  console.error(`${idOf(s)}：${text.length}文字（全部だと ${j(s, 1).length}文字）`);
}

/* ---------- add ---------- */
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
const asStr = v => v == null ? '' : String(v).trim();

/** 書かれた項目を、保存される形（rank つき）の入力に直す。直せないものは例外 */
function normalizeInput(inp, base) {
  const o = {};
  for (const [k, v] of Object.entries(inp)) {
    if (k === 'id' || k === 'kind') continue;
    if (k === 'class') o.class = typeof v === 'string' ? { raw: v } : v;
    else if (k === 'stats') {
      if (!v || typeof v !== 'object') throw new Error('stats はオブジェクトで書いてください（{ str: "A", end: "B", … }）');
      o.stats = {};
      for (const sk of STAT_KEYS) {
        const x = v[sk], raw = x == null ? '' : typeof x === 'string' ? x : x.raw;
        if (raw == null || raw === '') {
          const old = base && base.stats && base.stats[sk];
          if (old) { o.stats[sk] = old; continue; }
          throw new Error(`stats.${sk} がありません（筋力 str・耐久 end・敏捷 agi・魔力 mag・幸運 luk・宝具 np の6つが要ります）`);
        }
        const oldS = base && base.stats && base.stats[sk];
        o.stats[sk] = oldS && oldS.raw === asStr(raw) ? oldS : { raw: asStr(raw), rank: R.parseRank(asStr(raw)) };
      }
    } else if (k === 'classSkills' || k === 'skills') {
      if (!Array.isArray(v)) throw new Error(`${k} は配列で書いてください`);
      o[k] = v.map((x, i) => {
        if (!x || !asStr(x.name)) throw new Error(`${k}[${i}] に name がありません`);
        const rankRaw = asStr(x.rankRaw != null ? x.rankRaw : typeof x.rank === 'string' ? x.rank : '');   // build.js の mkSkill と同じ形
        return { name: asStr(x.name), rankRaw, rank: R.parseRank(rankRaw), desc: x.desc == null ? '' : String(x.desc) };
      });
    } else if (k === 'nps') {
      if (!Array.isArray(v)) throw new Error('nps は配列で書いてください');
      o.nps = v.map((x, i) => {
        if (!x || !asStr(x.name)) throw new Error(`nps[${i}] に name がありません`);
        const P = H.parser, g = f => asStr(x[f]);   // build.js の mkNP と同じ形
        return { name: g('name'), reading: g('reading'), rankRaw: g('rankRaw'), rank: R.parseRank(g('rankRaw')), typeRaw: g('typeRaw'), typeKey: P.npTypeKey(g('typeRaw')),
          rangeRaw: g('rangeRaw'), range: P.parseRange(g('rangeRaw')), maxRaw: g('maxRaw'), maxTargets: P.parseNum(g('maxRaw')), desc: x.desc == null ? '' : String(x.desc) };
      });
    } else o[k] = clone(v);
  }
  return o;
}
/** 「変更があるか」を見るための形（rank など組み直しで出る項目を除いた、書き手が触れる項目だけ） */
function sig(k, v) {
  if (v == null) return v;
  if (k === 'class') return v.raw || v.label || '';
  if (k === 'stats') return Object.fromEntries(STAT_KEYS.map(sk => [sk, v[sk] ? (typeof v[sk] === 'string' ? v[sk] : v[sk].raw) : '']));
  if (k === 'classSkills' || k === 'skills') return v.map(x => pick(x, SKILL_FIELDS));
  if (k === 'nps') return v.map(x => pick(x, NP_FIELDS));
  if (k === 'weapons') return v.map(x => pick(x, WEAPON_FIELDS));
  return v;
}
const DEFAULTS = () => ({ kind: 'servant', aliases: [], origin: '', sex: '', alignment: '', attribute: '', traits: [], statsAlt: [], classSkills: [], skills: [], nps: [], weapons: [], profile: {}, relations: [], voice: {}, text: {}, info: {}, warnings: [] });
const canonical = s => { const o = {}; for (const k of KEY_ORDER) if (k in s) o[k] = s[k]; for (const k of Object.keys(s)) if (!(k in o)) o[k] = s[k]; return o; };
const same = (a, b) => j(a) === j(b);

function readInputs(files) {
  const out = [];
  for (const f of files) {
    let text;
    try { text = f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8'); } catch (e) { fail(`${f} を読めません：${e.message}`); }
    let d; try { d = JSON.parse(text); } catch (e) { fail(`${f} はJSONとして読めません：${e.message}`); }
    const list = Array.isArray(d) ? d : d && d.servants ? d.servants : d && d.trueName ? [d] : [];
    if (!list.length) fail(`${f} に英霊が入っていません（英霊1騎のJSON、その配列、{ servants: [...] } のどれか）`);
    for (const s of list) out.push({ file: f, s });
  }
  return out;
}

function cmdAdd(args, P) {
  const files = args._.slice(1); if (!files.length) fail('使い方：node tools/servant.js add <ファイル.json …|-> [--dry-run]');
  const inputs = readInputs(files);
  loadOverrides(P);
  const pack = readPack(P);
  const list = L.listOf(pack).slice();
  const index = new Map(list.map((s, i) => [idOf(s), i]));
  const report = [], notes = [], errors = [];
  for (const { file, s: inp } of inputs) {
    const label = `${inp.trueName || '?'}（${file}）`;
    try {
      if (!asStr(inp.trueName)) throw new Error('trueName（真名）がありません');
      const cls = inp.class != null ? (typeof inp.class === 'string' ? { raw: inp.class } : inp.class) : null;
      const cur = cls ? H.parser.parseClass(cls.raw || cls.label || '') : null;
      let at = index.get(cur ? cur.key + ':' + asStr(inp.trueName) : inp.id);
      if (at == null && !cur) {   // class を書かないときは、同じ真名の1騎を探す
        const hit = list.map((x, i) => [x, i]).filter(([x]) => x.trueName === asStr(inp.trueName));
        if (hit.length > 1) throw new Error('同じ真名が複数のクラスにいます。id か class を書いてください');
        if (hit.length) at = hit[0][1];
      }
      const old = at != null ? list[at] : null;
      if (!old && !cur) throw new Error('新しい英霊には class（クラス）が要ります');
      if (!old && !inp.stats) throw new Error('新しい英霊には stats（ステータス）が要ります');
      const given = normalizeInput(inp, old);
      given.trueName = asStr(inp.trueName);
      if (old) for (const k of Object.keys(given)) if (same(sig(k, given[k]), sig(k, old[k]))) delete given[k];
      const cand = Object.assign(old ? clone(old) : DEFAULTS(), given);
      const built = B.fromJSON(cand), rebuilt = B.toLean(built);
      let next;
      if (!old) next = canonical(rebuilt);
      else {
        next = clone(old);
        for (const k of Object.keys(given)) next[k] = rebuilt[k] !== undefined ? rebuilt[k] : cand[k];
        if ('class' in given || 'trueName' in given) next.id = rebuilt.id;
      }
      const id = next.id;
      if (inp.id && inp.id !== id) notes.push(`${label}：id は「${inp.id}」ではなく「${id}」になります（クラス＋真名から決まります）`);
      const touched = old ? Object.keys(next).filter(k => !same(next[k], old[k])) : null;
      const info = { id, power: built.power, npPeak: built.npPeak, review: (built.review || []).map(r => `${r.target}：${r.why}`) };
      if (old && !touched.length) report.push({ label, id, status: '変更なし' });
      else {
        if (old) list[at] = next; else { list.push(next); index.set(id, list.length - 1); }
        report.push(Object.assign({ label, status: old ? `更新（${touched.join('・')}）` : '追加' }, info));
      }
      if (old && (id !== idOf(old))) { index.delete(idOf(old)); index.set(id, at); }
    } catch (e) { errors.push(`- ${label}：${e.message}`); }
  }
  if (errors.length) { console.error('読めなかったもの（何も書き込みません）：\n' + errors.join('\n')); process.exit(1); }
  const changed = report.filter(r => r.status !== '変更なし');
  for (const n of notes) console.log('注意  ' + n);
  for (const r of report) {
    console.log(`${r.status === '変更なし' ? '＝' : r.status.startsWith('追加') ? '＋' : '～'} ${r.id}  ${r.status}` + (r.power != null ? `  戦闘力 ${r.power}／宝具の威力 ${r.npPeak}` : ''));
    for (const w of (r.review || []).slice(0, 8)) console.log(`    要確認 ${w}`);
    if ((r.review || []).length > 8) console.log(`    …ほか ${r.review.length - 8}件`);
  }
  if (!changed.length) { console.log('反映するものはありませんでした'); return; }
  if (args.flags.has('dry-run')) { console.log(`（--dry-run：${P.sv} には書き込んでいません）`); return; }
  writePack(P, pack, list);
  console.log(`${path.relative(process.cwd(), P.sv) || P.sv} に書き込みました（${changed.length}騎）。続けて：node tools/survival.js（優勝率の集計を作り直す）`);
}

/* ---------- その騎の手直し ---------- */
/** 内容（と真名・クラスの変更）は Wikiでの真名、効果・宝具・ステータス・確認済み・ページ名は表示の真名（真名の変更のあと）で引く */
function displayName(s, o) { const idn = o && o.content && o.content[s.trueName] && o.content[s.trueName].identity; return (idn && idn.trueName) || s.trueName; }
function ownKeys(s, o, withPages) {
  const wn = s.trueName, dn = displayName(s, o), out = [];
  if (o.content && o.content[wn]) out.push(['content', wn]);
  for (const t of ['servant', 'np']) for (const k of Object.keys(o[t] || {})) if (k.startsWith(dn + '/')) out.push([t, k]);
  for (const t of ['stats', 'reviewed'].concat(withPages ? ['pages'] : [])) if (o[t] && o[t][dn] !== undefined) out.push([t, dn]);
  return out;
}

/* ---------- wipe ---------- */
function cmdWipe(args, P) {
  const qs = args._.slice(1); if (!qs.length) fail('使い方：node tools/servant.js wipe <真名|id> [別の騎 …] [--dry-run]');
  const { byId } = loadAll(P), targets = [...new Set(qs.map(q => find(byId, q)))], dry = args.flags.has('dry-run');
  if (!fs.existsSync(P.ov)) fail(`${P.ov} がありません`);
  const o = L.readJSON(P.ov), all = [...byId.values()];
  let n = 0;
  for (const t of targets) {
    const twins = all.filter(x => x !== t && x.trueName === t.trueName);
    if (twins.length) { console.log(`注意  ${idOf(t)}：同じ真名の別の騎（${twins.map(idOf).join('、')}）と手直しを共有しているので消しません`); continue; }
    const keys = ownKeys(t, o, false);
    console.log(`${keys.length ? '－' : '＝'} ${idOf(t)}  ${keys.length ? keys.map(([tb, k]) => `${tb}:${k}`).join('、') : '手直しはありません'}`);
    for (const [tb, k] of keys) { delete o[tb][k]; n++; }
  }
  const g = Object.keys(o.global || {}).filter(k => targets.some(t => [...(t.classSkills || []), ...(t.skills || []), ...(t.nps || [])].some(x => H.effects.normName(x.name) === k)));
  if (g.length) console.log(`（全員に効く手直し ${g.join('、')} はほかの騎にも掛かるので残しています。リストツールの「全員に効く手直し」で消せます）`);
  if (!n) return;
  if (dry) { console.log(`（--dry-run：${n}件、書き込んでいません）`); return; }
  fs.writeFileSync(P.ov, j(o, 1) + '\n');
  console.log(`${path.relative(process.cwd(), P.ov) || P.ov} から ${n}件消しました（ページ名の手直しは残しています）。続けて：node tools/survival.js`);
}

/* ---------- remove ---------- */
function cmdRemove(args, P) {
  const qs = args._.slice(1); if (!qs.length) fail('使い方：node tools/servant.js remove <真名|id> [別の騎 …] [--keep-overrides] [--dry-run]');
  const { files, byId } = loadAll(P);
  const targets = [...new Set(qs.map(q => find(byId, q)))];
  const ids = new Set(targets.map(idOf));
  const dry = args.flags.has('dry-run');
  const out = [];
  // 1) 読み込まれる全ファイルから消す（同じ id が packs にもあると、servants.json から消しても出続ける）
  for (const f of files) {
    const p = path.join(P.dir, f); if (!fs.existsSync(p)) continue;
    const d = L.readJSON(p), list = L.listOf(d), kept = list.filter(x => !ids.has(idOf(x)));
    if (kept.length === list.length) continue;
    out.push(`${f}：${list.length - kept.length}件を外す（${list.length} → ${kept.length}騎）`);
    if (dry) continue;
    if (Array.isArray(d)) fs.writeFileSync(p, j(kept, 1) + '\n');
    else if (d.servants) { d.servants = kept; if (d.at) d.at = new Date().toISOString(); fs.writeFileSync(p, j(d, 1) + '\n'); }
    else fail(`${f} は英霊1騎だけのファイルです。手で消してください（manifest からも外す）`);
  }
  // 2) 手直し表に取り残される、その騎の手直し
  if (!args.flags.has('keep-overrides')) {
    const rest = [...byId.values()].filter(x => !ids.has(idOf(x)));
    const man = L.readJSON(P.man);
    for (const f of man.overrides || []) {
      const p = path.join(P.dir, f); if (!fs.existsSync(p)) continue;
      const o = L.readJSON(p); let n = 0; const gone = [];
      for (const t of targets) {
        if (rest.some(x => x.trueName === t.trueName)) { out.push(`${f}：同じ真名「${t.trueName}」の別の騎がいるので、手直しには触りません`); continue; }
        if (rest.some(x => displayName(x, o) === displayName(t, o))) { out.push(`${f}：真名を変えたあとの名前「${displayName(t, o)}」の別の騎がいるので、手直しには触りません`); continue; }
        for (const [table, k] of ownKeys(t, o, true)) { delete o[table][k]; n++; gone.push(`${table}:${k}`); }
      }
      if (n) { out.push(`${f}：手直し ${n}件を消す（${gone.join('、')}）`); if (!dry) fs.writeFileSync(p, j(o, 1) + '\n'); }
    }
  }
  // 3) 次の反映で復活しないか
  const inc = path.join(P.dir, 'incoming'), warn = [];
  if (fs.existsSync(inc)) for (const f of fs.readdirSync(inc)) {
    if (!/\.json$/i.test(f)) continue;
    try { if (L.listOf(L.readJSON(path.join(inc, f))).some(x => ids.has(idOf(x)))) warn.push(f); } catch (e) { /* 読めないファイルは無視 */ }
  }
  for (const t of targets) console.log(`－ ${idOf(t)}`);
  if (!out.length) console.log('消すものはありませんでした（どのファイルにも入っていません）');
  for (const l of out) console.log('  ' + l);
  if (warn.length) console.log(`注意  data/incoming/ の ${warn.join('、')} にも入っています。次の「データの反映」で復活するので、そのファイルを外してください`);
  if (dry) { console.log('（--dry-run：何も書き込んでいません）'); return; }
  console.log('続けて：node tools/survival.js（優勝率の集計を作り直す）。リストツールを開いたままなら「公開中のリストにそろえる」。');
}

/* ---------- check ---------- */
function cmdCheck(args, P) {
  const errors = [], warns = [];
  if (!fs.existsSync(P.man)) fail(`${P.man} がありません`);
  const man = L.readJSON(P.man);
  const seen = new Map();
  for (const f of man.servants || []) {
    const p = path.join(P.dir, f);
    if (!fs.existsSync(p)) { errors.push(`manifest の ${f} がありません`); continue; }
    let d; try { d = L.readJSON(p); } catch (e) { errors.push(`${f} を読めません：${e.message}`); continue; }
    const list = L.listOf(d);
    if (f === 'servants.json') {
      const sorted = L.sortLean(list.slice());
      if (!list.every((s, i) => s === sorted[i])) warns.push(`${f} の並びがクラス順→真名ではありません（incoming.js / servant.js add で整います）`);
    }
    list.forEach((s, i) => {
      const where = `${f}[${i}] ${s && s.trueName || '?'}`;
      if (!s || !s.trueName) return errors.push(`${where}：trueName がありません`);
      const calc = idOf(Object.assign({}, s, { id: undefined }));
      if (s.id && s.id !== calc) errors.push(`${where}：id「${s.id}」がクラス＋真名「${calc}」と合いません`);
      const id = s.id || calc;
      if (seen.has(id)) warns.push(`${id} が ${seen.get(id)} と ${f} の両方にあります（後ろが優先）`);
      seen.set(id, f);
      for (const k of STAT_KEYS) { const v = s.stats && s.stats[k]; if (!v || !asStr(typeof v === 'string' ? v : v.raw)) warns.push(`${id}：stats.${k} がありません（読み込み時は ${H.CONFIG.MISSING_STAT} 扱いで要確認になります）`); }
      const names = new Set();
      for (const [lst, items] of [['classSkills', s.classSkills], ['skills', s.skills], ['nps', s.nps]]) for (const x of items || []) {
        if (!asStr(x.name)) errors.push(`${id}：${lst} に名前の無い項目があります`);
        else if (names.has(lst + x.name)) warns.push(`${id}：${lst} に同じ名前「${x.name}」が2つあります`);
        names.add(lst + x.name);
      }
    });
  }
  loadOverrides(P);
  let built = 0;
  for (const s of loadAll(P).byId.values()) { try { B.fromJSON(s); built++; } catch (e) { errors.push(`${idOf(s)}：組み立てに失敗（${e.message}）`); } }
  for (const w of warns) console.log('注意  ' + w);
  for (const e of errors) console.log('エラー ' + e);
  console.log(`${built}騎を組み立てました。エラー ${errors.length}件・注意 ${warns.length}件`);
  if (errors.length) process.exit(1);
}

/* ---------- main ---------- */
const args = parseArgs(process.argv.slice(2)), cmd = args._[0], P = dirs(args);
const CMDS = { index: cmdIndex, show: cmdShow, add: cmdAdd, remove: cmdRemove, wipe: cmdWipe, check: cmdCheck };
if (!CMDS[cmd]) { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 36).map(l => l.replace(/^\/?\*\s?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
CMDS[cmd](args, P);
