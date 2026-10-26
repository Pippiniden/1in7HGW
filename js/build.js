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
  const DERIVED = ['attack', 'ranks', 'score', 'allSkills', 'tags', 'effectSummary', 'power', 'npPeak', 'review', 'reviewDone', 'built', 'statSource', 'contentEdited', 'attrs', 'attrsUnknown', 'bossOnly'];

  // ---------- 内容の手直し（effects.js の CONTENT_OVERRIDES） ----------
  // Wiki から読んだスキル・宝具・セリフ・解説・プロフィール・因縁を、リストツールで直した内容に差し替える。
  // 差し替えた項目の Wiki の値は sv._wiki に取っておく（リストに保存したあとでも元に戻せるように）。
  // 公開用のデータ（toLean）は Wiki の値で書き出し、手直しは overrides.json の content に入る。
  const CONTENT_SECTIONS = { facts: ['origin', 'sex', 'alignment', 'attribute', 'traits', 'aliases', 'info'], skills: ['classSkills', 'skills'], nps: ['nps'], weapons: ['weapons'], voice: ['voice'], text: ['text'], profile: ['profile'], relations: ['relations'] };
  const CONTENT_JA = { identity: '真名・クラス', facts: '基本情報', skills: 'スキル', nps: '宝具', weapons: '武装', voice: 'セリフ', text: '解説・人物', profile: 'プロフィール', relations: '因縁' };
  /** 図鑑に出す 【key】 の項目（基本情報の編集でも同じものを扱う。これ以外の info は手直しの対象外） */
  const INFO_SHOWN = ['出典', '原典', '地域', '年代', '身長・体重', '身長', 'スリーサイズ', '髪色', '瞳色', '肌色', '外見・容姿', '容姿'];
  // 真名・クラスの手直し（CONTENT_OVERRIDES['Wikiの真名'].identity = { trueName?, cls? }）。
  //   内容の手直し表は Wiki の真名で引く。ほかの表（効果・ステータス・宝具の扱い・ページ名）は直したあとの真名で引く。
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  function restoreWiki(sv) {
    if (sv && sv._wiki) { for (const k of Object.keys(sv._wiki)) { if (sv._wiki[k] === undefined) delete sv[k]; else sv[k] = sv._wiki[k]; } delete sv._wiki; }
    return sv;
  }
  /** kagemiya のページ名（手直し表 pages → 取り込んだときのページ名 の順）。分からなければ null（真名で探す） */
  const pageOf = sv => (sv && (E.PAGE_OVERRIDES[E.okey(sv)] || sv.page || (sv._wiki && sv._wiki.trueName))) || null;
  // ページ名の代わりに http(s) のURLが入っているとき、それは kagemiya 以外のリンク先（取り直しはできない）
  const extLinkOf = v => { const t = String(v || '').trim(); return /^https?:\/\/\S+$/i.test(t) ? t : null; };
  const linkOf = sv => extLinkOf(pageOf(sv));
  const isManual = sv => !!(sv && (sv.manual || linkOf(sv)));   // Wikiから取り直せない騎（手書き・外部リンク）
  /** Wiki での真名・id（真名・クラスを手直ししていても、取り込んだときのもの。内容の手直し表と公開中のリストとの突き合わせに使う） */
  const wikiName = sv => (sv && sv._wiki && sv._wiki.trueName) || (sv && sv.trueName);
  const wikiId = sv => (sv && sv._wiki && sv._wiki.id) || (sv && sv.id);
  /** 内容の手直し表（CONTENT_OVERRIDES）で引く名前：Wiki の真名（印 key があれば '#印' 付き） */
  const wikiKey = sv => !sv ? '' : wikiName(sv) + (sv.key ? '#' + sv.key : '');

  // ---------- 同じ真名の別の騎を見分ける印（sv.key） ----------
  // 同じ真名・同じクラスの別人、同じ真名で別クラスの別人は、手直し表（真名で引く）を共有してしまう。
  // 後から入ってきたほうに印を付けて、id も手直し表の引き方も分ける。印は取り込むときに一度だけ決めて、公開用のデータに保存する（読み込みのたびには決めない）。
  const KEY_LEN = 5;
  /** kagemiya のページ名から決まる印（同じページなら、取り直しても同じ印になる） */
  function keyFromPage(page) {
    let h = 0x811c9dc5; const s = String(page || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000' + (h >>> 0).toString(36)).slice(-KEY_LEN);
  }
  /** ページ名が無い手書きの騎に付ける印（取り込みツールで一度だけ使う。ゲームの進行では使わない） */
  const randomKey = () => { let k = ''; while (k.length < KEY_LEN) k += Math.random().toString(36).slice(2); return k.slice(0, KEY_LEN); };
  /**
   * list（いま名簿にいる騎）に対して sv が持つべき印を返す。
   *   - 同じ真名がいなければ印なし。
   *   - 同じ真名・同じクラスで、ページ名が食い違わない騎がいれば同じ騎（取り直し）なので、その騎の印を引き継ぐ。
   *   - それ以外（ページが違う・クラスが違う）は別の騎なので、ページ名から決めた印（ページが無ければ乱数）。
   * sv が既に印を持っていればそのまま。
   */
  // 手書きの lean はクラスが { raw } だけのことがあるので、key が無ければ読み直す
  const classKeyOf = x => (x.class && (x.class.key || G.parser.parseClass(x.class.raw || x.class.label || '').key)) || 'extra';
  function keyFor(sv, list) {
    if (sv.key) return sv.key;
    const rivals = (list || []).filter(o => o && o !== sv && o.trueName === sv.trueName);
    if (!rivals.length) return '';
    const same = rivals.find(o => o.class && sv.class && classKeyOf(o) === classKeyOf(sv) && !(o.page && sv.page && o.page !== sv.page));
    if (same) return same.key || '';
    return sv.page ? keyFromPage(sv.page) : randomKey();
  }
  /** keyFor で決めた印を sv に付け、id を付け直す。付けたときだけ true */
  function assignKey(sv, list) {
    const k = keyFor(sv, list);
    if (k && !sv.key) sv.key = k;
    sv.id = classKeyOf(sv) + ':' + E.okey(sv);
    return !!k;
  }
  /** Wiki から読んだままの内容（手直しを外したもの）の写し */
  const wikiOf = sv => restoreWiki(clone(sv));
  /** 編集・比較に使う、項目ごとの内容（計算で出す値を除いたもの） */
  function contentOf(sv, sec) {
    const sk = (g, s) => ({ group: g, name: s.name || '', rankRaw: s.rankRaw || '', desc: s.desc || '' });
    if (sec === 'skills') return (sv.classSkills || []).map(s => sk('class', s)).concat((sv.skills || []).map(s => sk('own', s)));
    if (sec === 'nps') return (sv.nps || []).map(n => ({ name: n.name || '', reading: n.reading || '', rankRaw: n.rankRaw || '', typeRaw: n.typeRaw || '', rangeRaw: n.rangeRaw || '', maxRaw: n.maxRaw || '', desc: n.desc || '' }));
    if (sec === 'relations') return clone(sv.relations || []);
    if (sec === 'weapons') return (sv.weapons || []).map(w => ({ name: w.name || '', reading: w.reading || '', desc: w.desc || '' }));
    if (sec === 'facts') {
      const info = {}; for (const k of INFO_SHOWN) if (sv.info && sv.info[k]) info[k] = sv.info[k];
      return { origin: sv.origin || '', sex: sv.sex || '', alignment: sv.alignment || '', attribute: sv.attribute || '', aliases: (sv.aliases || []).slice(), traits: (sv.traits || []).slice(), info };
    }
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
    const c = E.CONTENT_OVERRIDES[E.okey(sv)];
    if (!c) return [];
    const wiki = {}, done = [];
    const idn = c.identity;
    if (idn && (idn.trueName || idn.cls)) {
      wiki.trueName = sv.trueName; wiki.class = clone(sv.class); wiki.id = sv.id;
      if (idn.trueName) sv.trueName = String(idn.trueName).trim();
      if (idn.cls) sv.class = G.parser.parseClass(String(idn.cls).trim());
      sv.id = E.idOf(sv);
      done.push('identity');
    }
    for (const sec of Object.keys(CONTENT_SECTIONS)) {
      if (c[sec] == null) continue;
      const base = c.base && c.base[sec];
      if (base && review && base !== hashOf(contentOf(sv, sec))) review.push({ kind: 'content', target: CONTENT_JA[sec], why: '手直しした後にWikiの内容が変わっています（「内容を編集」で見比べて、必要なら直し直してください）', ctx: hashOf(contentOf(sv, sec)) });
      for (const f of CONTENT_SECTIONS[sec]) wiki[f] = clone(sv[f]);
      if (sec === 'skills') {
        sv.classSkills = c.skills.filter(s => s.group === 'class').map(mkSkill).filter(s => s.name);
        sv.skills = c.skills.filter(s => s.group !== 'class').map(mkSkill).filter(s => s.name);
      } else if (sec === 'nps') sv.nps = c.nps.map(mkNP).filter(n => n.name);
      else if (sec === 'weapons') sv.weapons = c.weapons.map(w => ({ name: String(w.name || '').trim(), reading: String(w.reading || '').trim(), desc: String(w.desc || '') })).filter(w => w.name);
      else if (sec === 'facts') {
        const f = c.facts;
        for (const k of ['origin', 'sex', 'alignment', 'attribute']) sv[k] = String(f[k] || '').trim();
        sv.aliases = (f.aliases || []).map(x => String(x).trim()).filter(Boolean);
        sv.traits = (f.traits || []).map(x => String(x).trim()).filter(Boolean);
        const info = Object.assign({}, sv.info); for (const k of INFO_SHOWN) delete info[k];
        sv.info = Object.assign(info, f.info || {});
      } else sv[sec] = clone(c[sec]);
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

    if ((sv.class.key === 'extra' || def.slot === 'extra') && !E.resolveAttrs(sv).attrs.includes(E.BOSS_ATTR)) {   // ボス専用はクラスが何でもよいので、確認は要らない
      review.push({ kind: 'class', target: 'クラス', why: sv.class.unknown || sv.class.key === 'extra' ? `「${sv.class.raw || '不明'}」はどのクラスにも当てはまらないためエクストラ扱い（config.js の CLASS_DEFS に足せば専用クラスにできる）` : `エクストラクラス（${def.label}）` });
    }

    // ステータス（手直しがあればそれを優先）
    const so = E.STAT_OVERRIDES[E.okey(sv)] || {};
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
      rk = Object.assign({}, rk, { score: R.statScore(rk) }); // ステータスは STAT_SCORE で数える（宝具・マスターは RANK_SCORE のまま）
      sv.ranks[k] = rk; sv.score[k] = rk.score; sv.statSource[k] = src;
    }
    for (const a of sv.statsAlt || []) if (a.fromText && !Object.keys(so).length) review.push({ kind: 'stat', target: 'ステータス', why: `${a.label}、別のステータスが書かれています（どちらを使うか「ステータス編集」で選べます）` });

    // 属性タグ（特攻・弱点の判定に使う）。元の表記と正規化した表記の両方を持つ
    const tags = new Set([sv.class.key, sv.class.label, ...(def.tags || [])]);
    const addTag = t => { if (!t) return; tags.add(t); const c = E.canonTag(t); if (c) tags.add(c); };
    if (sv.attribute) addTag(sv.attribute.replace(/属性$/, ''));
    String(sv.alignment || '').split(/[・･、\/\s]+/).filter(Boolean).forEach(t => tags.add(t));
    // 属性（その他属性）：属性マスタで正規の名前にそろえたもの。ボス専用なら聖杯戦争には呼ばれない
    const ar = E.resolveAttrs(sv);
    sv.attrs = ar.attrs; sv.attrsUnknown = ar.unknown;
    if (sv.attrs.includes(E.BOSS_ATTR)) sv.bossOnly = true;
    sv.attrs.forEach(addTag);
    if (sv.sex) tags.add(/女/.test(sv.sex) ? '女性' : /男/.test(sv.sex) ? '男性' : sv.sex);
    // 城塞宝具・結界宝具を持つ英霊（「城の要素を持つ宝具にだけ使える」宝具の相手の目印）
    if ((sv.nps || []).some(n => /城塞|結界/.test(n.typeRaw || ''))) tags.add('城塞宝具');

    // スキル
    const ctx = { trueName: E.okey(sv) };
    const allSkills = sv.classSkills.map(s => Object.assign(s, { group: 'class' })).concat(sv.skills.map(s => Object.assign(s, { group: 'own' })));
    const WHY = {
      keyword: '辞書に無いため説明文から推定',
      compound: m => `説明文で参照されている「${m}」の効果を借りて推定`,
      default: '推定できず仮の効果（戦闘力+小）',
      fgo: m => `辞書にも説明文にも手がかりが無いため、FGO の同名スキル「${m}」の働き（Chaldea のデータ）から推定`,
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
      Object.assign(np, { mode: r.mode, modeBasis: r.modeBasis, attackAuto: r.attack, attackBasis: r.basis, power: r.power, burst: r.burst, cost: r.cost, exposure: r.exposure, multi: r.multi, disabled: r.disabled, useIf: r.useIf, effects: r.effects, effectSource: r.source, matched: r.matched || null });
      np.attackResolved = r.attack;
      if (r.disabled) review.push({ kind: 'np', target: np.name, why: '「今回の召喚では使えない」と読み取ったため使用不可' });
      else if (r.effects.some(e => e.id === 'self_retire')) { const p = E.retireP(r.effects.find(e => e.id === 'self_retire')); review.push({ kind: 'np', target: np.name, why: p >= 0.5 ? '使うと自分が脱落する宝具として扱い' : `使うと${Math.round(p * 100)}%の確率で自分が脱落する宝具として扱い` }); }
      else if (r.modeBasis === 'words') review.push({ kind: 'np', target: np.name, why: `説明文から${E.NP_MODE_JA[r.mode]}の宝具として扱い（効果は持っているだけで働き、毎日の魔力が増える）` });
      else if (r.basis === 'guess') review.push({ kind: 'np', target: np.name, why: '説明文に手がかりが無いため、種別どおり攻撃宝具として扱い' });
      else if (r.basis === 'support-effects') review.push({ kind: 'np', target: np.name, why: '攻撃の表現が見つからないため補助宝具として扱い' });
      if (np.rank && np.rank.base == null) review.push({ kind: 'np', target: np.name, why: 'ランク不明のためC扱い' });
    }

    sv.tags = Array.from(tags).filter(Boolean);
    sv.effectSummary = summarize(sv);
    sv.power = combatPower(sv);
    sv.npPeak = npPeak(sv);
    // 要確認：確認済みにしたもの（手直し表 reviewed）は外して reviewDone に。目印には対象の中身も入るので、取り直しで中身が変われば出直す
    const done = new Set(E.REVIEWED[E.okey(sv)] || []);
    for (const r of review) { r.sig = reviewSig(sv, r); delete r.ctx; }
    sv.review = review.filter(r => !done.has(r.sig));
    sv.reviewDone = review.filter(r => done.has(r.sig));
    sv.built = { at: Date.now() };
    return sv;
  }

  // 要確認の目印：種類・対象・理由と、対象の中身（スキル・宝具ならランク・種別・説明、ステータスなら表記）。
  // 取り直して同じ内容なら目印も同じなので、確認済みのまま。中身か理由が変われば別の目印になり、要確認に戻る
  function reviewCtx(sv, r) {
    if (r.ctx != null) return r.ctx;
    const items = l => (l || []).filter(x => x.name === r.target).map(x => [x.rankRaw || '', x.typeRaw || '', x.desc || '']);
    if (r.kind === 'skill') return items((sv.classSkills || []).concat(sv.skills || []));
    if (r.kind === 'np') return items(sv.nps);
    if (r.kind === 'stat') return [STAT_KEYS.map(k => sv.stats && sv.stats[k] ? sv.stats[k].raw : ''), (sv.statsAlt || []).map(a => a.label)];
    if (r.kind === 'class') return (sv.class && (sv.class.raw || sv.class.label)) || '';
    return '';
  }
  const reviewSig = (sv, r) => hashOf([r.kind, r.target, r.why, reviewCtx(sv, r)]);

  // 全スキル・宝具の効果を部品ごとに合計（宝具の効果は「宝具使用時」扱いで別集計）
  function summarize(sv) {
    const out = {};
    // kind：'skill'（スキル）／'use'（宝具を使ったその戦いの間）／'hold'（宝具を持っているだけで）
    // 発動のしかた（effects.js の TRIGGERS）があるものは常時に数えず、trig（スキル）・npTrig（宝具を使ったあと）に分ける
    const add = (e, kind) => {
      const p = e.params || {};
      const on = kind === 'skill' ? E.trigOf(e) : (p.on || '');
      const key = e.id + (p.tag ? ':' + p.tag : p.stat ? ':' + p.stat : '') + (p.cond ? '@' + (p.condNot ? '!' : '') + p.cond : '') + (p.vs ? '>' + (p.vsNot ? '!' : '') + p.vs : '') + (p.chance != null ? '%' + p.chance : '') + (p.name ? '#' + p.name : '') + (p.eff ? '~' + p.eff : '') + (p.self ? '^self' : '') + (p.nocure ? '^fix' : '') + (p.team > 0 ? '&' + p.team : '')
        + (p.dmin > 0 ? '[' + p.dmin : '') + (p.dmax > 0 ? ']' + p.dmax : '') + (p.grow ? '+g' + p.grow : '') + (p.turn > 0 ? '|t' + p.turn : '') + (p.decay ? '-d' + p.decay : '')
        + (on ? '!' + on : '') + (p.cost > 0 ? '$' + p.cost : '') + (p.uses > 0 ? '*' + p.uses : '');
      const o = out[key] || (out[key] = { id: e.id, name: E.EFFECTS[e.id].name, params: e.params, passive: 0, onNP: 0, from: [] });
      if (on) { o.on = on; if (kind === 'skill') o.trig = (o.trig || 0) + e.mag; else o.npTrig = (o.npTrig || 0) + e.mag; }
      else if (kind === 'use') o.onNP += e.mag;
      else { o.passive += e.mag; if (kind === 'skill') { o.by = o.by || {}; o.by[e.from] = (o.by[e.from] || 0) + e.mag; } }
      o.from.push(e.from + (e.persistent ? '(消滅後も持続)' : ''));
      return o;
    };
    for (const s of sv.allSkills || []) for (const e of s.effects || []) add(e, 'skill');
    // 宝具の効果：戦いの効果は「宝具を使ったその戦いの間」だけ（onNP）。昼・偵察・維持魔力などの効果は持っているだけで働く（passive）
    // 常時発動の宝具はスキルと同じに数える。自動で発動する宝具は「使ったとき」に数え、見積もり用に場面の重みを npAuto に足す
    for (const np of sv.nps || []) if (!np.disabled) for (const e of np.effects || []) {
      if (np.mode === 'always') { const k = G.CONFIG.ENGINE.npAlwaysScale; add(k == null || k === 1 ? e : Object.assign({}, e, { mag: e.mag * k }), 'skill'); continue; }
      const k = E.npOnUse(e) || (e.params && e.params.on) || E.INSTANT.includes(e.id) ? 'use' : 'hold';
      const o = add(e, k);
      if (k === 'use' && E.NP_MODE_W[np.mode] && !(e.params && e.params.on)) o.npAuto = (o.npAuto || 0) + e.mag * E.NP_MODE_W[np.mode];
    }
    const r3 = v => Math.round(v * 1000) / 1000;
    for (const k in out) { const o = out[k]; o.passive = r3(o.passive); o.onNP = r3(o.onNP); if (o.trig) o.trig = r3(o.trig); if (o.npTrig) o.npTrig = r3(o.npTrig); if (o.npAuto) o.npAuto = r3(o.npAuto); }
    return out;
  }
  // 見積もり（評価・戦闘力・試し戦い）での条件付き効果の重み（effects.js の効果の条件）。エンジンでは engine.js の condOk で本当に判定する
  //   場所：terrain と同じときだけ／拠点：o.home のときだけ／瀕死：0.3（戦いの一部でだけ働く）
  //   相手の属性：o.opp（相手のサーヴァント）が持つときだけ（相手が分からなければ数えない。「それ以外」は数える）／発動確率：強さ×確率
  //   日数・日ごとの変化：1〜EST_DAYS日目のならし（戦いの多い序盤〜中盤）
  const EST_DAYS = 12;
  function condW(p, terrain, o) {
    if (!p) return 1;
    let w = 1;
    if (p.cond) { const c = p.cond === '拠点' ? (o && o.home ? 1 : 0) : p.cond === '瀕死' ? 0.3 : p.cond === terrain ? 1 : 0; w *= p.condNot ? 1 - c : c; }
    if (p.vs) w *= o && o.opp ? ((o.opp.tags || []).includes(p.vs) !== !!p.vsNot ? 1 : 0) : p.vsNot ? 1 : 0;
    if (p.chance != null) w *= Math.max(0, Math.min(1, p.chance));
    if (p.dmin > 0 || p.dmax > 0 || p.grow || p.decay) { let s = 0; for (let d = 1; d <= EST_DAYS; d++) s += E.dayOk(p, d) ? E.dayMult(p, d) : 0; w *= s / EST_DAYS; }
    return w;
  }
  // 常時効果の合計。terrain を渡すと、その場所の条件付き効果も足す。o = { opp: 相手, home: 拠点で戦う }
  //   発動する効果（effects.js の TRIGGERS）は、その場面の起きやすさ（TRIG_W）を掛けて足す（回復・吸収などその場で働く効果は inst で別に数える）
  const trigW = x => (x.trig || 0) * (E.TRIG_W[x.on] || 0) + (x.npTrig || 0) * 0.4 * (E.TRIG_W[x.on] || 0) + (x.npAuto || 0);   // npAuto：自動で発動する宝具
  //   self：自分に掛ける不利な効果（params.self）だけを数える。ふだんは数えない
  const selfOf = (x, self) => !!(x.params && x.params.self) === !!self;
  const eff = (sv, id, terrain, o, self) => Object.values(sv.effectSummary || {}).filter(x => x.id === id && selfOf(x, self)).reduce((t, x) => t + (x.passive + (E.INSTANT.includes(id) ? 0 : trigW(x))) * condW(x.params, terrain, o), 0);
  // その場で働く効果（回復・吸収など）の見積もり：発動の起きやすさ × 強さ（宝具を使ったときのものは半分）
  const inst = (sv, id, terrain, o, self) => Object.values(sv.effectSummary || {}).filter(x => x.id === id && selfOf(x, self)).reduce((t, x) => t + (trigW(x) + x.onNP * 0.5) * condW(x.params, terrain, o), 0);

  // 基本戦闘力：重み付きのステータス平均 × (1 + 戦闘力上昇の合計)
  // sumOf を渡すと、戦闘力上昇の合計をそれで数える（エンジンが、その戦いで本当に働く効果だけを数えるため）
  function combatPower(sv, terrain, sumOf) {
    const W = G.CONFIG.STAT_W, CW = G.classWeights(sv.class.key);
    let s = 0, w = 0;
    for (const k of ['str', 'end', 'agi', 'mag', 'luk']) { const ww = W[k] * CW[k]; s += (sv.score[k] || 0) * ww; w += ww; }
    return Math.round(s / w * (1 + (sumOf ? sumOf('power') : eff(sv, 'power', terrain))) * 10) / 10;
  }
  // ステータスの偏差：C相当（32）を0、A相当を約+1とする（−1〜+1.6）。STAT_FX の係数に掛けて使う
  const statDev = v => Math.max(-1, Math.min(1.6, ((v == null ? 32 : v) - 32) / 30));
  // 魔力による宝具の威力の倍率（「宝具」ステータスは宝具そのものの評価なので、戦闘には使わない）
  // 守りの効果の合計を、重なるほど鈍らせる（config.js の ENGINE.defSoft。0 なら足したまま）。エンジンも同じ式を使う
  const softDef = x => { const k = G.CONFIG.ENGINE.defSoft; return x > 0 && k > 0 ? x / (1 + x * k) : x; };
  const npStatMult = sv => Math.max(0.5, 1 + G.CONFIG.STAT_FX.magNp * statDev(sv.score.mag));
  // 最強の攻撃宝具の威力（宝具強化・魔力込み。使用不可・自滅する宝具は除く）
  function npPeak(sv) {
    const atk = (sv.nps || []).filter(n => n.attackResolved && !n.disabled && !(n.effects || []).some(e => e.id === 'self_retire' && E.retireP(e) >= 0.5));
    if (!atk.length) return 0;
    const own = n => (n.effects || []).filter(e => e.id === 'np_boost').reduce((t, e) => t + e.mag, 0); // その宝具自身の「宝具強化」
    return Math.round(Math.max(...atk.map(n => n.power * (1 + eff(sv, 'np_boost') + own(n)))) * npStatMult(sv) * 10) / 10;
  }

  /**
   * 2騎の勝率の目安（本番の戦闘処理ができるまでの確認用）。
   * opts.np: 宝具を使う前提で比べる / opts.home: a が拠点で戦う / opts.terrain: 場所（'水辺' など）
   */
  function battleOdds(a, b, opts) {
    opts = opts || {};
    const K = G.CONFIG.BATTLE_K, T = opts.terrain;
    // 条件付き効果の場面：a から見た b、b から見た a（拠点は a の側だけ）
    const oa = { opp: b, home: !!opts.home }, ob = { opp: a, home: false };
    const ctxOf = x => x === a ? oa : ob;
    const sum = (x, id, y) => Object.values(x.effectSummary).filter(e => e.id === id && e.params && y.tags.includes(e.params.tag)).reduce((t, e) => t + e.passive * condW(e.params, T, ctxOf(x)), 0);
    const side = (x, y) => {
      const ox = ctxOf(x), oy = ctxOf(y);
      const pierce = Math.min(0.9, eff(y, 'pierce', T, oy));                       // 相手の防御無視で自分の守りが削られる
      const mg = y.class.key === 'caster' || (y.score.mag || 0) > (y.score.str || 0) ? softDef(eff(x, 'magic_guard', T, ox)) * 0.5 : 0;
      const sure = Math.min(1, Math.max(0, eff(y, 'sure_hit', T, oy)));                   // 相手の必中で回避が消える
      const EN0 = G.CONFIG.ENGINE;
      const def = Math.max(-0.5, Math.min(EN0.defCap, (softDef(eff(x, 'guard', T, ox)) * EN0.defPowerW + softDef(eff(x, 'evade', T, ox)) * 0.5 * (1 - sure) + mg) * (1 - pierce)));
      let p = combatPower(x, T, () => eff(x, 'power', T, ox)) * (1 + sum(x, 'power_vs', y)) * (1 + def) * (1 - sum(x, 'weakness', y) * 0.5);
      // 先手：宝具ありの見積もりでは、先手の付いた宝具（戦いの始めに切る）の先手も足す（engine.js の openingNP）
      const npIni = opts.np ? Math.max(0, ...(x.nps || []).filter(n => !n.disabled).map(n => (n.effects || []).filter(e => e.id === 'initiative')
        .reduce((t, e) => t + e.mag * condW(e.params, T, ox), 0))) : 0;
      const EM = G.CONFIG.ENGINE, mgOf = (z, oz) => Math.max(-0.5, Math.min(1.5, softDef(eff(z, 'mental_guard', T, oz))));   // 精神耐性（engine.js の power と同じ）
      p *= (1 + eff(x, 'crit', T, ox) * (EM.critMult - 1)) * (1 + Math.min(0.5, eff(x, 'initiative', T, ox) + npIni) * 0.08 * (1 - Math.max(0, Math.min(1, mgOf(y, oy) * EM.mentalSurprise))));
      // ステータスの役割（筋力で与える傷・耐久で受ける傷・幸運でクリティカル）を、打ち合いの強さにならして足す
      const F = G.CONFIG.STAT_FX;
      p *= 1 + (F.str * statDev(x.score.str) + F.end * statDev(x.score.end) + F.lukCrit * Math.max(0, statDev(x.score.luk))) * 0.5;
      // 相手の弱体化（種類ごとの防ぎ方は engine.js の power と同じ）と衰弱（戦いのなかで重なっていく分を、押し勝つ回数からならして2倍）
      const bodyX = Math.max(-0.5, Math.min(0.8, EM.bodyEndGuard * statDev(x.score.end) + softDef(Math.max(0, eff(x, 'magic_guard', T, ox))) * EM.bodyMagicGuard));
      const deb = eff(y, 'debuff', T, oy) * (1 - Math.max(-0.5, Math.min(0.6, mgOf(x, ox) * EM.mentalDebuff)))
        + eff(y, 'debuff_mind', T, oy) * (1 - Math.max(-0.5, Math.min(0.8, mgOf(x, ox) * EM.mindDebuffGuard)))
        + (eff(y, 'debuff_body', T, oy) + inst(y, 'wither', T, oy) * 2) * (1 - bodyX);
      p *= 1 - Math.min(0.5, deb);
      // 自分に掛かる不利な効果：弱体化・衰弱（日ごとのものは戦いまでに3回ほど重なるとみる）
      const selfDeb = eff(x, 'debuff', T, ox, true) + eff(x, 'debuff_mind', T, ox, true) + eff(x, 'debuff_body', T, ox, true) + inst(x, 'wither', T, ox, true) * 3;
      if (selfDeb) p *= 1 - Math.max(-0.5, Math.min(0.5, selfDeb));
      // 見切り・反撃：押し負けた一撃をかわす／傷を返す分を、打ち合いの強さにならして足す
      const dg = Math.min(EM.dodgeCap, Math.max(0, eff(x, 'dodge', T, ox))) * (1 - Math.min(1, Math.max(0, eff(y, 'sure_hit', T, oy))));
      p *= (1 + dg * 0.5) * (1 + Math.min(1, Math.max(0, eff(x, 'counter', T, ox))) * 0.3);
      // 傷を負っても心が折れない：戦いのあいだの平均の霊基をおよそ7割とみて、その落ち込みの分
      p *= (1 - 0.45 * 0.3 * (1 - Math.max(-0.5, Math.min(0.6, mgOf(x, ox) * EM.mentalWound)))) / (1 - 0.45 * 0.3);
      if (ox.home) p *= 1 + eff(x, 'territory', T, ox);
      // 固定値の傷の増減（1回の傷はおよそ40）と、回復・吸収（霊基100のうちどれだけ取り戻せるか）
      p *= (1 + Math.max(-0.5, eff(x, 'dmg_plus', T, ox)) / 40) * (1 + Math.max(-0.5, eff(x, 'dmg_cut', T, ox)) / 40);
      p *= 1 + Math.min(0.4, (inst(x, 'heal', T, ox) + inst(x, 'drain_hp', T, ox) * 2) / 200);
      // 相手から受ける状態異常（engine.js の tryAil）：スタン・混乱で戦闘力が下がり、毒で少し削られ、宝具封印・スタンで宝具を使いにくい
      const EN = G.CONFIG.ENGINE;
      const ail = id => Math.min(E.AIL_CAP[id], Math.max(0, eff(y, id, T, oy)))
        * (1 - Math.min(0.95, Math.max(0, eff(x, 'ail_guard', T, ox) + (id === 'confuse' ? eff(x, 'mental_guard', T, ox) : 0))))
        + Math.min(E.AIL_CAP[id], Math.max(0, eff(x, id, T, ox, true)));   // 自分に掛かる状態異常（防げない）
      const st = ail('stun'), cf = ail('confuse'), ps = ail('poison'), sl = ail('seal');
      p *= (1 - (1 - EN.stunPower) * st) * (1 - (1 - EN.confusePower) * cf) * (1 - 0.08 * ps);
      if (opts.np) p += x.npPeak * 0.5 * (1 - 0.6 * sl) * (1 - 0.5 * st) * (1 + Math.min(0.5, Math.max(-0.5, eff(x, 'np_charge', T, ox))));
      return p;
    };
    const ea = side(a, b), eb = side(b, a);
    let p = 1 / (1 + Math.exp(-(ea - eb) / K));
    // 即死は戦闘力と無関係に決着しうる
    const F = G.CONFIG.STAT_FX, kr = y => Math.max(0, 1 - F.lukInstakill * statDev(y.score.luk)) * (1 - Math.min(0.9, Math.max(-0.5, eff(y, 'luck', T, ctxOf(y)))));
    const ka = Math.min(0.5, eff(a, 'instakill', T, oa)) * kr(b), kb = Math.min(0.5, eff(b, 'instakill', T, ob)) * kr(a);
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
    sv.id = E.idOf(sv);
    return buildServant(sv);
  }

  /** 書き出したJSONに残っている手直し（上書き）を、上書き表に戻す。既にある表は書き換えない */
  function harvestOverrides(list) {
    let n = 0;
    for (const sv0 of list) {
      // リストツールで内容を直したまま書き出したJSON（_wiki あり）：直した内容を内容の手直し表に戻す
      if (sv0 && sv0._wiki && sv0.trueName && !E.CONTENT_OVERRIDES[wikiKey(sv0)]) {
        const wiki = wikiOf(sv0), c = { base: {} };
        if ('trueName' in sv0._wiki) {
          const idn = {};
          if (sv0.trueName !== wiki.trueName) idn.trueName = sv0.trueName;
          if (sv0.class && wiki.class && sv0.class.raw !== wiki.class.raw) idn.cls = sv0.class.raw || sv0.class.label;
          if (Object.keys(idn).length) c.identity = idn;
        }
        for (const [sec, fields] of Object.entries(CONTENT_SECTIONS)) {
          if (!fields.some(f => f in sv0._wiki)) continue;
          c[sec] = contentOf(sv0, sec); c.base[sec] = hashOf(contentOf(wiki, sec));
        }
        if (Object.keys(c).length > 1) { E.CONTENT_OVERRIDES[wikiKey(wiki)] = c; n++; }
      }
      // 宝具名の「名前(読み)」の分離などを済ませた名前で登録する
      const sv = G.parser.finalize(JSON.parse(JSON.stringify(sv0)));
      const items = (sv.allSkills || sv.classSkills.concat(sv.skills)).concat(sv.nps || []);
      for (const it of items) {
        if (it.effectSource !== 'servant-override' && it.effectSource !== 'override') continue;
        const specs = (it.effects || []).map(e => e.params ? [e.id, e.factor, e.params] : [e.id, e.factor]);
        const nm = E.normName(it.name);
        if (it.effectSource === 'override') { if (!E.SKILL_OVERRIDES[nm]) { E.SKILL_OVERRIDES[nm] = specs; n++; } }
        else { const k = E.okey(sv) + '/' + nm; if (!E.SERVANT_OVERRIDES[k]) { E.SERVANT_OVERRIDES[k] = specs; n++; } }
      }
    }
    return n;
  }

  /**
   * 公開用の軽いデータにする（計算で出せる項目を落とす）。fromJSON で元に戻せる。
   */
  // mode・modeBasis（宝具の発動のしかた）も手直し表と説明文から毎回決まるので落とす。残すと、公開用のデータが手直し表しだいで変わり、
  // リストツールが変えていない騎を「未公開の変更」と数えて、書き出しで公開側の更新を上書きしていた
  const ITEM_DERIVED = ['effects', 'effectSource', 'matched', 'group', 'attack', 'attackAuto', 'attackBasis', 'attackResolved', 'power', 'burst', 'cost', 'exposure', 'multi', 'disabled', 'useIf', 'mode', 'modeBasis'];
  function toLean(sv) {
    const o = restoreWiki(JSON.parse(JSON.stringify(sv)));
    for (const k of DERIVED) delete o[k];
    // skippedItems（読み取りで外した項目の記録。parser.js の cleanItems）は残す。外した後の内容と一緒に公開する
    for (const it of (o.classSkills || []).concat(o.skills || [], o.nps || [])) for (const k of ITEM_DERIVED) delete it[k];
    return o;
  }

  /**
   * 手書きの英霊（data/bosses.json の1騎の形。ランクは文字列のまま、スキル・宝具に effects・宝具に attack/mode/aoe を書ける）を、
   * 公開用の軽いデータ（lean）にする。手書きの効果などは手直し表に入れるものとして一緒に返す：
   *   { lean, servantOv: { '真名/名前': 効果の配列 }, npOv: { '真名/宝具名': { attack?, mode? } }, aoe: { 正規化した宝具名: 値 } }
   */
  function leanFromSpec(spec) {
    if (!spec || !spec.trueName || !spec.stats) throw new Error('trueName と stats が要ります');
    const P = G.parser, tn = String(spec.trueName).trim(), asStr = v => v == null ? '' : String(v).trim();
    const servantOv = {}, npOv = {}, aoe = {};
    const stats = {};
    for (const k of STAT_KEYS) { const raw = asStr(spec.stats[k] && spec.stats[k].raw != null ? spec.stats[k].raw : spec.stats[k]) || 'C'; stats[k] = { raw, rank: R.parseRank(raw) }; }
    const reg = (it, isNP) => {
      const n = E.normName(it.name);
      if (Array.isArray(it.effects)) servantOv[tn + '/' + n] = it.effects;
      if (isNP && (it.attack === true || it.attack === false || it.mode != null)) {
        const o = {}; if (it.attack === true || it.attack === false) o.attack = it.attack; if (it.mode != null) o.mode = it.mode;
        npOv[tn + '/' + n] = o;
      }
      if (isNP && it.aoe != null) aoe[n] = +it.aoe;
    };
    const skill = it => { reg(it, false); const rr = asStr(it.rankRaw != null ? it.rankRaw : it.rank); return { name: asStr(it.name), rankRaw: rr, rank: R.parseRank(rr), desc: asStr(it.desc) }; };
    const np = it => {
      reg(it, true);
      const g = f => asStr(it[f]);
      return { name: g('name'), reading: g('reading'), rankRaw: g('rankRaw'), rank: R.parseRank(g('rankRaw')), typeRaw: g('typeRaw'), typeKey: P.npTypeKey(g('typeRaw')),
        rangeRaw: g('rangeRaw'), range: P.parseRange(g('rangeRaw')), maxRaw: g('maxRaw'), maxTargets: P.parseNum(g('maxRaw')), desc: asStr(it.desc) };
    };
    const lean = {
      kind: 'servant', trueName: tn, aliases: spec.aliases || [], class: { raw: asStr(spec.class) || '？' }, origin: spec.origin || '', sex: spec.sex || '',
      alignment: spec.alignment || '', attribute: spec.attribute || '', traits: (spec.traits || []).filter(t => t !== E.BOSS_ATTR).concat(spec.plain ? [] : [E.BOSS_ATTR]), stats, statsAlt: [],
      classSkills: (spec.classSkills || []).map(skill), skills: (spec.skills || []).map(skill), nps: (spec.nps || []).map(np), weapons: [],
      profile: spec.profile || {}, relations: [], voice: spec.voice || {}, text: spec.text || {}, info: {}, warnings: [],
    };
    if (spec.plain) lean.manual = true;                  // 手書きの騎（Wikiから取り込んだものではない）。取り直しの対象にしない
    if (extLinkOf(spec.link)) lean.page = extLinkOf(spec.link);
    return { lean, servantOv, npOv, aoe };
  }

  /**
   * 解説の表示用の文章。Wikiのページの解説欄には、解説のほかに「セリフ集」の一覧・区切りの記号・TRPG用のキャラシートが
   * 続くことがある。表示（ゲームの解説ダイアログ）では、そういう枠を外して、解説の文章だけを残す。データは書き換えない
   *   - 「セリフ集」の見出しと「見出し：「セリフ」」の行の並び（間の空行も）
   *   - 「TRPGキャラシート」から終わりまで
   *   - ◆だけ・罫線だけの区切り行
   * 3行以上の空行は1つの空行にまとめる
   */
  const VOICE_LINE = /^[^「」：\n]{1,14}：「.*」\s*$/;
  function loreText(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n'), out = [];
    let skipping = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^TRPGキャラ(クター)?シート/.test(t)) break;
      if (/^(セリフ集?|台詞集?|ボイス集?)$/.test(t) || VOICE_LINE.test(t)) { skipping = true; continue; }
      if (skipping) { if (!t) continue; skipping = false; }
      if (t && /^[◆■□●○◎＊*・\-―─━=＝\s]+$/.test(t)) continue;
      out.push(lines[i].replace(/\s+$/, ''));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /** 解説を「最初に出す部分」と「続き」に分ける（文や行の切れ目で limit 字まで。続きは最初の部分と重ならない） */
  function loreLead(text, limit) {
    const t = loreText(text);
    let head = '', i = 0;
    const parts = t.split(/(?<=[。\n])/);
    for (; i < parts.length; i++) { if (head.trim() && (head + parts[i]).length > limit) break; head += parts[i]; }
    return { head: head.trim(), rest: parts.slice(i).join('').trim() };
  }
  G.build = { loreText, loreLead, leanFromSpec, reviewSig, toLean, buildServant, combatPower, npPeak, battleOdds, statDev, npStatMult, summarize, importServant, fromJSON, harvestOverrides, STAT_KEYS, STAT_JA,
    CONTENT_SECTIONS, CONTENT_JA, INFO_SHOWN, contentOf, hashOf, wikiOf, restoreWiki, pageOf, extLinkOf, linkOf, isManual, wikiName, wikiId, wikiKey, keyFromPage, keyFor, assignKey, softDef };
})(globalThis.HGW = globalThis.HGW || {});
