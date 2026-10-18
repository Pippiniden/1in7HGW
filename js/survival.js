/* 生存曲線：英霊ごとに「何日目まで生き残れるか」
 *
 * リストから毎回ランダムに七騎を選んで、全自動の聖杯戦争をたくさん回し（既定の設定：30日・クラスごとに一騎・
 * エクストラときどき・マスターはいない観測者として）、英霊ごとに脱落した日を数える。
 * ある一回の戦争ではなく、どんな顔ぶれに呼ばれても、という総合的な見込み。
 *
 * 集計は data/survival.json に置いておける（tools/survival.js で作る）。リストが変わっていれば（指紋が違えば）
 * ゲームの画面が手元で少しずつ回して作り直す。
 *
 * 集計の形（JSONのまま保存できる）：
 *   { format:'hgw-survival', version:1, fp, wars, days, seedBase,
 *     servants: { '<クラス>:<真名>': { n: 登場回数, w: 聖杯を手にした回数, d: [1日目に脱落した回数, 2日目…] } } }
 *   脱落しなかった回数（勝者と、決着がつかずに残った騎）は n − Σd。
 */
(function (G) {
  'use strict';

  /** リストの指紋（index.html の記録の照合と同じ式）。リストの顔ぶれと強さが変われば変わる */
  function fingerprint(roster) {
    let h = 2166136261;
    for (const s of roster) { const t = s.id + '|' + s.power + '|' + (s.npPeak || 0) + ';'; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } }
    return roster.length + ':' + (h >>> 0).toString(36);
  }

  /** 空の集計 */
  function empty(roster, days) {
    return { format: 'hgw-survival', version: 1, fp: fingerprint(roster), wars: 0, days: days || G.CONFIG.ENGINE.maxDays, seedBase: 'sv', servants: {} };
  }

  /** 1回の戦争の結果を集計に足す。脱落した日は、記録の写し（snap）で初めて消えていた日 */
  function tally(stats, res) {
    const fell = {};
    for (const e of res.entries) {
      if (!e.snap) continue;
      for (const c of e.snap) if (!c.alive && fell[c.id] == null) fell[c.id] = e.day || 1;
    }
    for (const c of res.camps) {
      const t = stats.servants[c.servantId] || (stats.servants[c.servantId] = { n: 0, w: 0, d: [] });
      t.n++;
      if (c.id === res.winner) t.w++;
      const d = fell[c.id];
      if (d != null) { const i = Math.max(1, Math.min(stats.days, d)) - 1; while (t.d.length <= i) t.d.push(0); t.d[i]++; }
    }
    stats.wars++;
  }

  /** 集計を少しずつ進める。step(k) で k 回ぶん戦争を回す（画面を止めないように、呼ぶ側が間を空ける） */
  function runner(roster, opts) {
    opts = opts || {};
    const stats = opts.stats && opts.stats.fp === fingerprint(roster) ? opts.stats : empty(roster, opts.days);
    const masters = opts.masters || [];
    return {
      stats,
      step(k) {
        for (let i = 0; i < k; i++) {
          const seed = stats.seedBase + stats.wars;
          let res;
          try { res = G.engine.runWar({ roster, seed, player: 'none', masters: masters.slice(), engine: { maxDays: stats.days } }); }
          catch (e) { stats.wars++; continue; }
          tally(stats, res);
        }
        return stats;
      },
    };
  }

  /** 生存曲線：s[d] = d日目の終わりにまだ脱落していない割合（s[0] = 1） */
  function curveOf(t, days) {
    const s = [1];
    if (!t || !t.n) return null;
    let gone = 0;
    for (let d = 1; d <= days; d++) { gone += t.d[d - 1] || 0; s.push(1 - gone / t.n); }
    return s;
  }
  /** リスト全体（登場回数で重み付け）の生存曲線。比べる目安に使う */
  function overall(stats) {
    const all = { n: 0, w: 0, d: [] };
    for (const t of Object.values(stats.servants)) {
      all.n += t.n; all.w += t.w;
      t.d.forEach((v, i) => { all.d[i] = (all.d[i] || 0) + v; });
    }
    return all;
  }
  /** 半分が脱落する日（最後まで半分以上が残るなら null） */
  function median(s) { for (let d = 1; d < s.length; d++) if (s[d] < 0.5) return d; return null; }

  G.survival = { fingerprint, empty, tally, runner, curveOf, overall, median };
})(globalThis.HGW = globalThis.HGW || {});
