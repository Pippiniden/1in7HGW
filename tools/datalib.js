/* tools 用：data/ のフォルダ（manifest.json と、そこに書かれた servants・overrides）を、ゲームと同じ組み立てで読む
 *   const L = require('./datalib');
 *   const r = L.loadDir('data');        // { roster, raw, overrides, files, errors }
 * 読むたびに手直し表（effects.js の OVERRIDE_TABLES）を空にしてから読み直すので、二つのフォルダ（変更前と変更後）を
 * 続けて読んで見比べられる。
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['config', 'rank', 'parser', 'effects', 'build', 'master', 'war']) require(path.join(ROOT, 'js', f + '.js'));
const H = globalThis.HGW, E = H.effects, B = H.build;

const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const listOf = d => Array.isArray(d) ? d : d && d.servants ? d.servants : d && d.kind === 'servant' ? [d] : [];

/** 手直し表を空にする */
function clearOverrides() { for (const t of Object.values(E.OVERRIDE_TABLES)) for (const k of Object.keys(t)) delete t[k]; }
/** 手直し表に足す（overrides.json の形） */
function applyOverrides(o) { for (const [k, t] of Object.entries(E.OVERRIDE_TABLES)) Object.assign(t, (o && o[k]) || {}); }
/** 今の手直し表を overrides.json の形で */
function currentOverrides() {
  const o = { format: 'hgw-overrides', version: 2 };
  for (const [k, t] of Object.entries(E.OVERRIDE_TABLES)) o[k] = JSON.parse(JSON.stringify(t));
  return o;
}

/** data/ のようなフォルダを読む。フォルダが無ければ空のリスト */
function loadDir(dir) {
  clearOverrides();
  const out = { roster: [], raw: [], overrides: currentOverrides(), files: [], errors: [] };
  const manPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manPath)) return out;
  const man = readJSON(manPath);
  for (const f of man.overrides || []) { const p = path.join(dir, f); if (fs.existsSync(p)) { applyOverrides(readJSON(p)); out.files.push(f); } }
  for (const f of man.servants || []) { const p = path.join(dir, f); if (fs.existsSync(p)) { out.raw.push(...listOf(readJSON(p))); out.files.push(f); } }
  B.harvestOverrides(out.raw);
  const byId = new Map();
  for (const s of out.raw) { try { const b = B.fromJSON(s); byId.set(b.id, b); } catch (e) { out.errors.push((s.trueName || '?') + '：' + e.message); } }
  out.roster = [...byId.values()];
  out.overrides = currentOverrides();
  return out;
}

/** 開戦時の評価と同じ：リストの全騎と1対1で戦った平均勝率と、その順位による S〜E */
function grades(roster) {
  const ids = roster.slice().sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)), REF = 120;
  const refs = ids.length <= REF ? ids : Array.from({ length: REF }, (_, i) => ids[Math.floor(i * ids.length / REF)]);
  const rate = new Map();
  for (const a of roster) { let t = 0, n = 0; for (const b of refs) { if (a === b) continue; t += (B.battleOdds(a, b, {}).pA + B.battleOdds(a, b, { np: true }).pA) / 2; n++; } rate.set(a.id, n ? t / n : 0.5); }
  const all = [...rate.values()], grade = new Map();
  for (const [id, r] of rate) grade.set(id, H.gradeOfPct(all.filter(x => x > r + 1e-9).length / Math.max(1, all.length - 1)));
  return { rate, grade };
}

/** リストの並び（クラスの順 → 真名）。取り込みツールと同じ */
function sortLean(list) {
  const CLS = Object.keys(H.CONFIG.CLASS_DEFS);
  const ord = s => { const k = H.parser.parseClass((s.class && (s.class.raw || s.class.label)) || '').key, i = CLS.indexOf(k); return i < 0 ? 99 : i; };
  return list.sort((a, b) => ord(a) - ord(b) || String(a.trueName).localeCompare(String(b.trueName), 'ja'));
}

module.exports = { H, E, B, ROOT, readJSON, listOf, clearOverrides, applyOverrides, currentOverrides, loadDir, grades, sortLean };
