/* 聖杯戦争の組み合わせを決める（名簿から7騎＋α）
 * ルールは config.js の WAR で変えられる。 */
(function (G) {
  'use strict';
  /**
   * roster: 組み立て済みサーヴァントの配列 / rnd: 0〜1 の乱数関数
   * 戻り値: [{ slot: 'saber', servant, substitute: bool }]
   */
  function composeWar(roster, rnd, cfg) {
    rnd = rnd || Math.random;
    cfg = Object.assign({}, G.CONFIG.WAR, cfg || {});
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const used = new Set(), out = [];
    const pool = cls => roster.filter(s => !used.has(s.id) && s.class.key === cls);
    const extras = () => roster.filter(s => !used.has(s.id) && G.classDef(s.class.key).slot === 'extra');
    const slots = cfg.slots.slice();
    // エクストラクラスが紛れ込む
    let extraN = 0;
    if (cfg.maxExtra > 0 && rnd() < cfg.extraChance && extras().length) {
      const i = Math.floor(rnd() * slots.length), s = pick(extras());
      out[i] = { slot: slots[i], servant: s, substitute: false, extra: true }; used.add(s.id); extraN++;
    }
    slots.forEach((cls, i) => {
      if (out[i]) return;
      let cand = pool(cls), substitute = false;
      if (!cand.length) {
        substitute = true;
        if (cfg.fillWith === 'extra') cand = extras();
        else if (cfg.fillWith === 'any') cand = roster.filter(s => !used.has(s.id));
        else cand = [];
      }
      const s = cand.length ? pick(cand) : null;
      if (s) used.add(s.id);
      out[i] = { slot: cls, servant: s, substitute: substitute && !!s, extra: !!s && G.classDef(s.class.key).slot === 'extra' };
    });
    return out;
  }
  // クラスごとの人数（名簿の偏りの確認用）
  function classCounts(roster) {
    const c = {};
    for (const k of Object.keys(G.CONFIG.CLASS_DEFS)) c[k] = 0;
    for (const s of roster) c[s.class.key] = (c[s.class.key] || 0) + 1;
    return c;
  }
  G.war = { composeWar, classCounts };
})(globalThis.HGW = globalThis.HGW || {});
