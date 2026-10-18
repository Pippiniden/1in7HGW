/* 解析結果（parser.js）を、ゲームで使える形に組み立てる
 *   - ステータスをスコア化（読めない値はC扱いにして要確認リストへ。手直しは STAT_OVERRIDES）
 *   - スキル・宝具に効果を割り当て
 *   - 戦闘力と、2騎の勝率の目安を計算
 */
(function (G) {
  'use strict';
  const R = G.rank, E = G.effects;
  const STAT_KEYS = ['str', 'end', 'agi', 'mag', 'luk', 'np'];
  const STAT_JA = { str: '筋力', end: '耐久', agi: '敏捷', mag: '魔力', luk: '幸運', np: '宝具' };
  // 再計算で作り直す項目（古いJSONから組み直すときに捨てる）
  const DERIVED = ['attack', 'ranks', 'score', 'allSkills', 'tags', 'effectSummary', 'power', 'npPeak', 'review', 'built', 'statSource', 'contentEdited'];

  // ---------- 内容の手直し（effects.js の CONTENT_OVERRIDES） ----------
  // Wiki から読んだスキル・宝具・セリフ・解説・プロフィール・因縁を、リストツールで直した内容に差し替える。
  // 差し替えた項目の Wiki の値は sv._wiki に取っておく（リストに保存したあとでも元に戻せるように）。
  // 公開用のデータ（toLean）は Wiki の値で書き出し、手直しは overrides.json の content に入る。
  const CONTENT_SECTIONS = { skills: ['classSkills', 'skills'], nps: ['nps'], voice: ['voice'], text: ['text'], profile: ['profile'], relations: ['relations'] };
  const CONTENT_JA = { skills: 'スキル', nps: '宝具', voice: 'セリフ', text: '解説・人物', profile: 'プロフィール', relations: '因縁' };
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  function restoreWiki(sv) {
    if (sv && sv._wiki) { for (const k of Object.keys(sv._wiki)) { if (sv._wiki[k] === undefined) delete sv[k]; else sv[k] = sv._wiki[k]; } delete sv._wiki; }
    return sv;
  }
  /** kagemiya のページ名（手直し表 pages → 取り込んだときのページ名 の順）。分からなければ null（真名で探す） */
  const pageOf = sv => (sv && (E.PAGE_OVERRIDES[sv.trueName] || sv.page)) || null;
  /** Wiki から読んだままの内容（手直しを外したもの）の写し */
  const wikiOf = sv => restoreWiki(clone(sv));
  /** 編集・比較に使う、項目ごとの内容（計算で出す値を除いたもの） */
  function contentOf(sv, sec) {
    const sk = (g, s) => ({ group: g, name: s.name || '', rankRaw: s.rankRaw || '', desc: s.desc || '' });
    if (sec === 'skills') return (sv.classSkills || []).map(s => sk('class', s)).concat((sv.skills || []).map(s => sk('own', s)));
    if (sec === 'nps') return (sv.nps || []).map(n => ({ name: n.name || '', reading: n.reading || '', rankRaw: n.rankRaw || '', typeRaw: n.typeRaw || '', rangeRaw: n.rangeRaw || '', maxRaw: n.maxRaw || '', desc: n.desc || '' }));
    if (sec === 'relations') return clone(sv.relations || []);
    return clone(sv[sec] || {});
  }
  function hashOf(x) { const s = JSON.stringify(x); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
  function mkSkill(s) { const rankRaw = String(s.rankRaw || '').trim(); return { name: String(s.name || '').trim(), rankRaw, rank: R.parseRank(rankRaw), desc: String(s.desc || '') }; }
  function mkNP(n) {
    const P = G.parser, g = k => String(n[k] || '').trim();
    return { name: g('name'), reading: g('reading'), rankRaw: g('rankRaw'), rank: R.parseRank(g('rankRaw')), typeRaw: g('typeRaw'), typeKey: P.npTypeKey(g('typeRaw')),
      rangeRaw: g('rangeRaw'), range: P.parseRange(g('rangeRaw')), maxRaw: g('maxRaw'), maxTargets: P.parseNum(g('maxRaw')), desc: String(n.desc || '') };
  }
  /** 手直しを掛ける。戻り値は差し替えた項目の一覧 */
  function applyContent(sv, review) {
    restoreWiki(sv);
    const c = E.CONTENT_OVERRIDES[sv.trueName];
    if (!c) return [];
    const wiki = {}, done = [];
    for (const sec of Object.keys(CONTENT_SECTIONS)) {
      if (c[sec] == null) continue;
      const base = c.base && c.base[sec];
      if (base && review && base !== hashOf(contentOf(sv, sec))) review.push({ kind: 'content', target: CONTENT_JA[sec], why: '手直しした後にWikiの内容が変わっています（「内容を編集」で見比べて、必要なら直し直してください）' });
      for (const f of CONTENT_SECTIONS[sec]) wiki[f] = clone(sv[f]);
      if (sec === 'skills') {
        sv.classSkills = c.skills.filter(s => s.group === 'class').map(mkSkill).filter(s => s.name);
        sv.skills = c.skills.filter(s => s.group !== 'class').map(mkSkill).filter(s => s.name);
      } else if (sec === 'nps') sv.nps = c.nps.map(mkNP).filter(n => n.name);
      else sv[sec] = clone(c[sec]);
      done.push(sec);
    }
    if (done.length) { sv._wiki = wiki; G.parser.finalize(sv); }
    return done;
  }

  function buildServant(parsed, opts) {
    opts = opts || {};
    const CFG = G.CONFIG;
    const sv = JSON.parse(JSON.stringify(parsed));
    for (const k of DERIVED) delete sv[k];
    sv.warnings = sv.warnings || [];
    const review = [];
    sv.contentEdited = applyContent(sv, review);
    const def = G.classDef(sv.class.key);

    if (sv.class.key === 'extra' || def.slot === 'extra') {
      review.push({ kind: 'class', target: 'クラス', why: sv.class.unknown || sv.class.key === 'extra' ? `「${sv.class.raw || '不明'}」はどのクラスにも当てはまらないためエクストラ扱い（config.js の CLASS_DEFS に足せば専用クラスにできる）` : `エクストラクラス（${def.label}）` });
    }

    // ステータス（手直しがあればそれを優先）
    const so = E.STAT_OVERRIDES[sv.trueName] || {};
    sv.ranks = {}; sv.score = {}; sv.statSource = {};
    for (const k of STAT_KEYS) {
      const st = sv.stats[k];
      let rk, src = 'wiki';
      if (so[k] != null && so[k] !== '') { rk = R.parseRank(so[k]); src = 'override'; }
      else rk = st && st.rank;
      if (!rk || (rk.base == null && !rk.none)) {
        rk = R.parseRank(CFG.MISSING_STAT); rk.substituted = true; src = 'missing';
        review.push({ kind: 'stat', target: STAT_JA[k], why: st ? `「${st.raw}」を読めないため${CFG.MISSING_STAT}扱い` : `値が無いため${CFG.MISSING_STAT}扱い` });
      } else if (rk.unknown && src === 'wiki') review.push({ kind: 'stat', target: STAT_JA[k], why: `「${st.raw}」は不確定表記` });
      if (rk.range) review.push({ kind: 'stat', target: STAT_JA[k], why: `範囲ランク「${rk.raw}」：戦争開始時に抽選` });
      sv.ranks[k] = rk; sv.score[k] = rk.score; sv.statSource[k] = src;
    }
    for (const a of sv.statsAlt || []) if (a.fromText && !Object.keys(so).length) review.push({ kind: 'stat', target: 'ステータス', why: `${a.label}、別のステータスが書かれています（どちらを使うか「ステータス編集」で選べます）` });

    // 属性タグ（特攻・弱点の判定に使う）。元の表記と正規化した表記の両方を持つ
    const tags = new Set([sv.class.key, sv.class.label, ...(def.tags || [])]);
    const addTag = t => { if (!t) return; tags.add(t); const c = E.canonTag(t); if (c) tags.add(c); };
    if (sv.attribute) addTag(sv.attribute.replace(/属性$/, ''));
    String(sv.alignment || '').split(/[・･、\/\s]+/).filter(Boolean).forEach(t => tags.add(t));
    (sv.traits || []).forEach(addTag);
    if (sv.sex) tags.add(/女/.test(sv.sex) ? '女性' : /男/.test(sv.sex) ? '男性' : sv.sex);

    // スキル
    const ctx = { trueName: sv.trueName };
    const allSkills = sv.classSkills.map(s => Object.assign(s, { group: 'class' })).concat(sv.skills.map(s => Object.assign(s, { group: 'own' })));
    const WHY = {
      keyword: '辞書に無いため説明文から推定',
      compound: m => `説明文で参照されている「${m}」の効果を借りて推定`,
      default: '推定できず仮の効果（戦闘力+小）',
      'dict-partial': m => `名前の一部が「${m}」に一致したので流用し、説明文で補足`,
      lost: 'ランク「-」で失われているため効果なし',
    };
    for (const s of allSkills) {
      const r = E.resolveSkill(s, ctx);
      s.effects = r.effects; s.effectSource = r.source; s.matched = r.matched || null;
      const w = WHY[r.source]; if (w) review.push({ kind: 'skill', target: s.name, why: typeof w === 'function' ? w(r.matched) : w });
      for (const e of r.effects) if (e.id === 'tag' && e.params && e.params.tag) tags.add(e.params.tag);
    }
    sv.allSkills = allSkills;
    // 同じ名前のスキル・宝具が複数ある（FGO風の表と本文を二重に読んだ、など）
    const dupOf = list => list.map(x => E.normName(x.name)).filter((n, i, a) => n && a.indexOf(n) !== i).filter((n, i, a) => a.indexOf(n) === i);
    for (const n of dupOf(allSkills)) review.push({ kind: 'skill', target: n, why: '同じ名前のスキルが複数あります（別の表などを二重に読んだ可能性。「内容を編集」で消せます）' });
    for (const n of dupOf(sv.nps)) review.push({ kind: 'np', target: n, why: '同じ名前の宝具が複数あります（「内容を編集」で消せます）' });

    // 宝具
    for (const np of sv.nps) {
      delete np.attack;
      const r = E.resolveNP(np, ctx);
      Object.assign(np, { attackAuto: r.attack, attackBasis: r.basis, power: r.power, burst: r.burst, cost: r.cost, exposure: r.exposure, multi: r.multi, disabled: r.disabled, effects: r.effects, effectSource: r.source, matched: r.matched || null });
      np.attackResolved = r.attack;
      if (r.disabled) review.push({ kind: 'np', target: np.name, why: '「今回の召喚では使えない」と読み取ったため使用不可' });
      else if (r.effects.some(e => e.id === 'self_retire')) { const p = r.effects.find(e => e.id === 'self_retire').mag; review.push({ kind: 'np', target: np.name, why: p >= 0.5 ? '使うと自分が脱落する宝具として扱い' : `使うと${Math.round(p * 100)}%の確率で自分が脱落する宝具として扱い` }); }
      else if (r.basis === 'guess') review.push({ kind: 'np', target: np.name, why: '説明文に手がかりが無いため、種別どおり攻撃宝具として扱い' });
      else if (r.basis === 'support-effects') review.push({ kind: 'np', target: np.name, why: '攻撃の表現が見つからないため補助宝具として扱い' });
      if (np.rank && np.rank.base == null) review.push({ kind: 'np', target: np.name, why: 'ランク不明のためC扱い' });
    }

    sv.tags = Array.from(tags).filter(Boolean);
    sv.effectSummary = summarize(sv);
    sv.power = combatPower(sv);
    sv.npPeak = npPeak(sv);
    sv.review = review;
    sv.built = { at: Date.now() };
    return sv;
  }

  // 全スキル・宝具の効果を部品ごとに合計（宝具の効果は「宝具使用時」扱いで別集計）
  function summarize(sv) {
    const out = {};
    const add = (e, np) => {
      const p = e.params || {};
      const key = e.id + (p.tag ? ':' + p.tag : p.stat ? ':' + p.stat : '') + (p.cond ? '@' + p.cond : '');
      const o = out[key] || (out[key] = { id: e.id, name: E.EFFECTS[e.id].name, params: e.params, passive: 0, onNP: 0, from: [] });
      if (np) o.onNP += e.mag; else o.passive += e.mag;
      o.from.push(e.from + (e.persistent ? '(消滅後も持続)' : ''));
    };
    for (const s of sv.allSkills || []) for (const e of s.effects || []) add(e, false);
    for (const np of sv.nps || []) if (!np.disabled) for (const e of np.effects || []) add(e, !(e.id === 'master_buff' || e.persistent));
    for (const k in out) { out[k].passive = Math.round(out[k].passive * 1000) / 1000; out[k].onNP = Math.round(out[k].onNP * 1000) / 1000; }
    return out;
  }
  // 常時効果の合計。terrain を渡すと、その場所の条件付き効果も足す
  const eff = (sv, id, terrain) => Object.values(sv.effectSummary || {}).filter(x => x.id === id && (!x.params || !x.params.cond || x.params.cond === terrain)).reduce((t, x) => t + x.passive, 0);

  // 基本戦闘力：重み付きのステータス平均 × (1 + 戦闘力上昇の合計)
  function combatPower(sv, terrain) {
    const W = G.CONFIG.STAT_W, CW = G.classWeights(sv.class.key);
    let s = 0, w = 0;
    for (const k of ['str', 'end', 'agi', 'mag', 'luk']) { const ww = W[k] * CW[k]; s += (sv.score[k] || 0) * ww; w += ww; }
    return Math.round(s / w * (1 + eff(sv, 'power', terrain)) * 10) / 10;
  }
  // ステータスの偏差：C相当（32）を0、A相当を約+1とする（−1〜+1.6）。STAT_FX の係数に掛けて使う
  const statDev = v => Math.max(-1, Math.min(1.6, ((v == null ? 32 : v) - 32) / 30));
  // 魔力による宝具の威力の倍率（「宝具」ステータスは宝具そのものの評価なので、戦闘には使わない）
  const npStatMult = sv => Math.max(0.5, 1 + G.CONFIG.STAT_FX.magNp * statDev(sv.score.mag));
  // 最強の攻撃宝具の威力（宝具強化・魔力込み。使用不可・自滅する宝具は除く）
  function npPeak(sv) {
    const atk = (sv.nps || []).filter(n => n.attackResolved && !n.disabled && !(n.effects || []).some(e => e.id === 'self_retire' && e.mag >= 0.5));
    if (!atk.length) return 0;
    return Math.round(Math.max(...atk.map(n => n.power)) * (1 + eff(sv, 'np_boost')) * npStatMult(sv) * 10) / 10;
  }

  /**
   * 2騎の勝率の目安（本番の戦闘処理ができるまでの確認用）。
   * opts.np: 宝具を使う前提で比べる / opts.home: a が拠点で戦う / opts.terrain: 場所（'水辺' など）
   */
  function battleOdds(a, b, opts) {
    opts = opts || {};
    const K = G.CONFIG.BATTLE_K, T = opts.terrain;
    const sum = (x, id, y) => Object.values(x.effectSummary).filter(e => e.id === id && e.params && y.tags.includes(e.params.tag)).reduce((t, e) => t + e.passive, 0);
    const side = (x, y, home) => {
      const pierce = Math.min(0.9, eff(y, 'pierce', T));                       // 相手の防御無視で自分の守りが削られる
      const mg = y.class.key === 'caster' || (y.score.mag || 0) > (y.score.str || 0) ? eff(x, 'magic_guard', T) * 0.5 : 0;
      const def = Math.max(-0.5, Math.min(0.6, (eff(x, 'guard', T) * 0.5 + eff(x, 'evade', T) * 0.5 + mg) * (1 - pierce)));
      let p = combatPower(x, T) * (1 + sum(x, 'power_vs', y)) * (1 + def) * (1 - sum(x, 'weakness', y) * 0.5);
      p *= 1 + eff(x, 'crit', T) * 0.5;
      // ステータスの役割（筋力で与える傷・耐久で受ける傷・幸運でクリティカル）を、打ち合いの強さにならして足す
      const F = G.CONFIG.STAT_FX;
      p *= 1 + (F.str * statDev(x.score.str) + F.end * statDev(x.score.end) + F.lukCrit * Math.max(0, statDev(x.score.luk))) * 0.5;
      p *= 1 - Math.min(0.5, eff(y, 'debuff', T));
      if (home) p *= 1 + eff(x, 'territory', T);
      if (opts.np) p += x.npPeak * 0.5;
      return p;
    };
    const ea = side(a, b, opts.home), eb = side(b, a, false);
    let p = 1 / (1 + Math.exp(-(ea - eb) / K));
    // 即死は戦闘力と無関係に決着しうる
    const F = G.CONFIG.STAT_FX, kr = y => Math.max(0, 1 - F.lukInstakill * statDev(y.score.luk));
    const ka = Math.min(0.5, eff(a, 'instakill', T)) * kr(b), kb = Math.min(0.5, eff(b, 'instakill', T)) * kr(a);
    p = ka + (1 - ka) * (1 - kb) * p;
    return { a: Math.round(ea * 10) / 10, b: Math.round(eb * 10) / 10, pA: Math.round(p * 1000) / 1000 };
  }

  // 解析から組み立てまで一度に
  function importServant(text, opts) { return buildServant(G.parser.parseServant(text, opts), opts); }

  /**
   * 書き出したJSON（hgw-servants 形式）から組み直す。
   * クラスは CLASS_DEFS で判定し直すので、後からクラスを足しても古いデータに反映される。
   */
  function fromJSON(obj) {
    const sv = restoreWiki(JSON.parse(JSON.stringify(obj))); // 内容の手直しは buildServant で掛け直す
    if (sv.class) sv.class = G.parser.parseClass(sv.class.raw || sv.class.label || '');
    G.parser.finalize(sv);
    sv.id = sv.class.key + ':' + sv.trueName;
    return buildServant(sv);
  }

  /** 書き出したJSONに残っている手直し（上書き）を、上書き表に戻す。既にある表は書き換えない */
  function harvestOverrides(list) {
    let n = 0;
    for (const sv0 of list) {
      // リストツールで内容を直したまま書き出したJSON（_wiki あり）：直した内容を内容の手直し表に戻す
      if (sv0 && sv0._wiki && sv0.trueName && !E.CONTENT_OVERRIDES[sv0.trueName]) {
        const wiki = wikiOf(sv0), c = { base: {} };
        for (const [sec, fields] of Object.entries(CONTENT_SECTIONS)) {
          if (!fields.some(f => f in sv0._wiki)) continue;
          c[sec] = contentOf(sv0, sec); c.base[sec] = hashOf(contentOf(wiki, sec));
        }
        if (Object.keys(c).length > 1) { E.CONTENT_OVERRIDES[sv0.trueName] = c; n++; }
      }
      // 宝具名の「名前(読み)」の分離などを済ませた名前で登録する
      const sv = G.parser.finalize(JSON.parse(JSON.stringify(sv0)));
      const items = (sv.allSkills || sv.classSkills.concat(sv.skills)).concat(sv.nps || []);
      for (const it of items) {
        if (it.effectSource !== 'servant-override' && it.effectSource !== 'override') continue;
        const specs = (it.effects || []).map(e => e.params ? [e.id, e.factor, e.params] : [e.id, e.factor]);
        const nm = E.normName(it.name);
        if (it.effectSource === 'override') { if (!E.SKILL_OVERRIDES[nm]) { E.SKILL_OVERRIDES[nm] = specs; n++; } }
        else { const k = sv.trueName + '/' + nm; if (!E.SERVANT_OVERRIDES[k]) { E.SERVANT_OVERRIDES[k] = specs; n++; } }
      }
    }
    return n;
  }

  /**
   * 公開用の軽いデータにする（計算で出せる項目を落とす）。fromJSON で元に戻せる。
   */
  const ITEM_DERIVED = ['effects', 'effectSource', 'matched', 'group', 'attack', 'attackAuto', 'attackBasis', 'attackResolved', 'power', 'burst', 'cost', 'exposure', 'multi', 'disabled'];
  function toLean(sv) {
    const o = restoreWiki(JSON.parse(JSON.stringify(sv)));
    for (const k of DERIVED) delete o[k];
    // skippedItems（読み取りで外した項目の記録。parser.js の cleanItems）は残す。外した後の内容と一緒に公開する
    for (const it of (o.classSkills || []).concat(o.skills || [], o.nps || [])) for (const k of ITEM_DERIVED) delete it[k];
    return o;
  }

  G.build = { toLean, buildServant, combatPower, npPeak, battleOdds, statDev, npStatMult, summarize, importServant, fromJSON, harvestOverrides, STAT_KEYS, STAT_JA,
    CONTENT_SECTIONS, CONTENT_JA, contentOf, hashOf, wikiOf, restoreWiki, pageOf };
})(globalThis.HGW = globalThis.HGW || {});
