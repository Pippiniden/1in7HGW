/* 公開データの読み込み
 *
 * data/manifest.json に読み込むファイルを並べる：
 *   {
 *     "servants":  ["servants.json", "packs/2026-10-xxさん.json"],   // サーヴァントの束（リストツールの書き出し）
 *     "overrides": ["overrides.json"],                               // 手直し表（後ろのファイルほど優先）
 *     "masters":   ["masters.json"],                                 // 固定マスター（任意）
 *     "bosses":    ["bosses.json"]                                   // 特異点攻略のボス専用の英霊（任意。聖杯戦争には呼ばれない）
 *   }
 * 同じクラス・真名のサーヴァントが複数の束にあれば、後ろの束を使う。
 */
(function (G) {
  'use strict';
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + '：' + r.status);
    return r.json();
  }
  function applyOverrides(o) {
    const E = G.effects;
    const T = E.OVERRIDE_TABLES;
    for (const k in T) Object.assign(T[k], (o && o[k]) || {});
  }
  function listOf(d) { return Array.isArray(d) ? d : d.servants || (d.kind === 'servant' ? [d] : []); }

  /** 公開データを読む。戻り値: { servants, masters, bosses, files, errors }
   *  bosses はボスのデータ（書いたままの形）。組み立ては singularity.js の prepareBosses */
  async function loadPublished(base) {
    base = base || 'data/';
    const man = await getJSON(base + 'manifest.json');
    const errors = [], files = [];
    for (const f of man.overrides || []) { try { applyOverrides(await getJSON(base + f)); files.push(f); } catch (e) { errors.push(e.message); } }
    const raw = [];
    for (const f of man.servants || []) { try { raw.push(...listOf(await getJSON(base + f))); files.push(f); } catch (e) { errors.push(e.message); } }
    G.build.harvestOverrides(raw);
    const byId = new Map();
    for (const s of raw) { try { const b = G.build.fromJSON(s); byId.set(b.id, b); } catch (e) { errors.push((s.trueName || '?') + '：' + e.message); } }
    let masters = [];
    for (const f of man.masters || []) { try { const d = await getJSON(base + f); masters.push(...(Array.isArray(d) ? d : d.masters || [])); files.push(f); } catch (e) { errors.push(e.message); } }
    const bosses = [];
    for (const f of man.bosses || []) { try { const d = await getJSON(base + f); bosses.push(...(Array.isArray(d) ? d : d.bosses || [])); files.push(f); } catch (e) { errors.push(e.message); } }
    return { servants: Array.from(byId.values()), masters, bosses, files, errors };
  }

  /** リストツール（roster.html）がこのブラウザに保存したリストと手直しを読む */
  function loadLocal() {
    try {
      applyOverrides(JSON.parse(localStorage.getItem('hgw.overrides.v1') || 'null'));
      const raw = JSON.parse(localStorage.getItem('hgw.roster.v2') || '[]');
      return { servants: raw.map(G.build.fromJSON), masters: [], files: ['ブラウザのリスト'], errors: [] };
    } catch (e) { return { servants: [], masters: [], files: [], errors: [e.message] }; }
  }
  function hasLocal() { try { return JSON.parse(localStorage.getItem('hgw.roster.v2') || '[]').length; } catch (e) { return 0; } }

  /** 手元のJSONファイル（File オブジェクト）から読む。file:// で開いたとき用 */
  async function loadFiles(fileList) {
    const raw = [], errors = [], bosses = [];
    for (const f of fileList) {
      try {
        const d = JSON.parse(await f.text());
        if (d.format === 'hgw-overrides' || d.global || d.servant || d.content) applyOverrides(d);
        else if (d.format === 'hgw-bosses') bosses.push(...(d.bosses || []));
        else raw.push(...listOf(d));
      } catch (e) { errors.push(f.name + '：' + e.message); }
    }
    G.build.harvestOverrides(raw);
    const byId = new Map();
    for (const s of raw) { try { const b = G.build.fromJSON(s); byId.set(b.id, b); } catch (e) { errors.push((s.trueName || '?') + '：' + e.message); } }
    return { servants: Array.from(byId.values()), masters: [], bosses, files: Array.from(fileList).map(f => f.name), errors };
  }

  // ---------- 英霊図鑑の発見（戦いの中で真名を知った英霊） ----------
  // hgw.zukan.v1：発見した英霊の id の配列（どのモードで知っても同じ図鑑に載る）／ hgw.zukan.open：'1' なら全公開
  // 表示だけに使う。戦争の中身・URL・記録には関わらない
  const ZK_KEY = 'hgw.zukan.v1', ZK_OPEN = 'hgw.zukan.open';
  let zkSet = null;
  const zukan = {
    load() {
      if (zkSet) return zkSet;
      zkSet = new Set();
      try { const a = JSON.parse(localStorage.getItem(ZK_KEY) || '[]'); if (Array.isArray(a)) for (const x of a) if (typeof x === 'string') zkSet.add(x); } catch (e) { /* 保存が使えなくても動く */ }
      return zkSet;
    },
    /** 発見した英霊を足す。新しく足した数を返す（増えたときだけ保存する） */
    add(ids) {
      const s = zukan.load(); let n = 0;
      for (const id of ids || []) if (typeof id === 'string' && id && !s.has(id)) { s.add(id); n++; }
      if (n) try { localStorage.setItem(ZK_KEY, JSON.stringify([...s])); } catch (e) { /* 保存できなくても動く */ }
      return n;
    },
    reset() { zkSet = new Set(); try { localStorage.removeItem(ZK_KEY); } catch (e) { /* 同上 */ } },
    isOpen() { try { return localStorage.getItem(ZK_OPEN) === '1'; } catch (e) { return false; } },
    setOpen(on) { try { if (on) localStorage.setItem(ZK_OPEN, '1'); else localStorage.removeItem(ZK_OPEN); } catch (e) { /* 同上 */ } },
  };

  G.data = { loadPublished, loadLocal, hasLocal, loadFiles, applyOverrides, zukan };
})(globalThis.HGW = globalThis.HGW || {});
