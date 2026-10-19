/* 聖杯戦争で試す（js/simlab.js）の裏方：別スレッドで全自動の聖杯戦争を回す。
 * 受け取るもの：{ type: 'run', lean, overrides, patch, start, step, total, days }
 *   start, start+step, start+2·step, … < total 番目の戦争（種 'sv' + 番号）を回す。並列の各スレッドで start をずらす。
 * 返すもの：{ type: 'part' | 'done', tally }（前回からの分だけ。受け取る側が simLab.merge で足していく）
 * 一回の試しごとに作って捨てるので、設定の差し替え（patch）は戻さない。
 */
importScripts('config.js', 'rank.js', 'parser.js', 'effects.js', 'fgoskills.js', 'build.js', 'master.js', 'war.js',
  'names.js', 'scenes.js', 'personas.js', 'engine.js', 'survival.js', 'simlab.js');

self.onmessage = e => {
  const m = e.data, L = self.HGW.simLab;
  if (!m || m.type !== 'run') return;
  L.applyConfig(m.patch);
  const roster = L.buildRoster(m.lean, m.overrides);
  let part = L.emptyTally(m.days), t0 = Date.now();
  for (let i = m.start; i < m.total; i += m.step) {
    L.runOne(roster, i, part);
    if (Date.now() - t0 > 250) { self.postMessage({ type: 'part', tally: part }); part = L.emptyTally(m.days); t0 = Date.now(); }
  }
  self.postMessage({ type: 'done', tally: part });
};
