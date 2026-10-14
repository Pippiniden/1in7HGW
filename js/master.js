/* マスターのデータ構造
 *
 * 方針：
 *   - どの項目も「書いてあればそれを使い、無ければ出自に応じて抽選」する。
 *     だから後から設定を足していっても、書いていない部分は今まで通り自動で埋まる。
 *   - 能力値はランク文字列（"B+"）でも数値（0〜100）でも書ける。
 *   - スキルはサーヴァントと同じ効果ライブラリ（effects.js）を使う。
 *   - 決まった型に無い設定は custom に何でも入れてよい（ゲーム側で後から読む）。
 */
(function (G) {
  'use strict';
  const R = G.rank;

  // マスターの能力値
  const MASTER_STATS = {
    mana:  { name: '魔力量', desc: 'サーヴァントに送れる魔力。維持・宝具の上限になる' },
    craft: { name: '魔術',   desc: '魔術の腕。攻撃・防御・使い魔・工房づくり' },
    body:  { name: '体力',   desc: '直接狙われたときの生存力' },
    mind:  { name: '精神',   desc: '恐怖や魅了への抵抗、判断の冷静さ（オート時の選択にも影響）' },
    luck:  { name: '幸運',   desc: '偶然の判定' },
  };

  // 出自。w は抽選の重み、stats は基準ランク、catalyst は触媒を持っている確率
  const ORIGINS = {
    noble:     { name: '名門の魔術師',       w: 25, stats: { mana: 'B', craft: 'B', body: 'D', mind: 'C', luck: 'C' }, catalyst: 0.8, money: 'A' },
    newblood:  { name: '新興の魔術師',       w: 25, stats: { mana: 'C', craft: 'C', body: 'D', mind: 'C', luck: 'C' }, catalyst: 0.4, money: 'C' },
    mercenary: { name: '魔術使い',           w: 20, stats: { mana: 'C', craft: 'C', body: 'B', mind: 'B', luck: 'D' }, catalyst: 0.5, money: 'C' },
    civilian:  { name: '巻き込まれた一般人', w: 15, stats: { mana: 'E', craft: 'E', body: 'C', mind: 'C', luck: 'B' }, catalyst: 0.05, money: 'D' },
    irregular: { name: '異能者',             w: 15, stats: { mana: 'B', craft: 'D', body: 'C', mind: 'D', luck: 'C' }, catalyst: 0.2, money: 'D' },
  };
  const ORIGIN_WORDS = [
    ['noble', /名門|旧家|大家|宗家|本家|貴族/], ['newblood', /新興|二代目|三代目|数代/], ['mercenary', /魔術使い|傭兵|フリーランス|執行者|始末屋|ハンター/],
    ['civilian', /一般人|巻き込まれ|素人|偶然/], ['irregular', /異能|超能力|混血|魔眼|退魔/],
  ];

  // 抽選のゆらぎ（段階）
  const SPREAD = 0.75;
  const MASTERS = [];   // 登録済みのマスター（固定キャラ）

  // 0〜1 の乱数関数 rnd を使って、基準ランクから少し揺らした値を作る
  function drawStat(baseRank, rnd) {
    const r = R.parseRank(baseRank);
    const st = Math.max(0.5, Math.min(6.5, r.step + (rnd() + rnd() - 1) * SPREAD * 2));
    return Math.round(R.scoreAt(st) * 10) / 10;
  }
  function pickOrigin(rnd) {
    const ks = Object.keys(ORIGINS); let t = 0; for (const k of ks) t += ORIGINS[k].w;
    let x = rnd() * t; for (const k of ks) { x -= ORIGINS[k].w; if (x <= 0) return k; } return ks[0];
  }

  /**
   * マスターを作る。spec に書いた項目はそのまま、書いていない項目は抽選。
   * spec の例:
   *   { name: '遠野 灯', origin: 'noble', stats: { mana: 'A', mind: 70 }, skills: [{ name: '魔眼', rank: 'B', desc: '…' }],
   *     catalyst: { servant: 'saber:アルトリア' }, wish: '…', custom: { 好きな食べ物: 'プリン' } }
   */
  function createMaster(spec, rnd) {
    spec = spec || {}; rnd = rnd || Math.random;
    const origin = spec.origin && ORIGINS[spec.origin] ? spec.origin : spec.origin ? 'custom' : pickOrigin(rnd);
    const O = ORIGINS[origin] || { name: spec.originLabel || spec.origin, stats: { mana: 'C', craft: 'C', body: 'C', mind: 'C', luck: 'C' }, catalyst: 0.3, money: 'C' };
    const stats = {}, statSource = {};
    for (const k of Object.keys(MASTER_STATS)) {
      const v = spec.stats && spec.stats[k];
      const fixed = v == null ? null : R.toScore(v);
      stats[k] = fixed != null ? fixed : drawStat(O.stats[k] || 'C', rnd);
      statSource[k] = fixed != null ? 'spec' : 'random';
    }
    const skills = (spec.skills || []).map(s => {
      const sk = { name: s.name, rankRaw: s.rank || s.rankRaw || '', rank: R.parseRank(s.rank || s.rankRaw || ''), desc: s.desc || '' };
      if (s.effects) { sk.effects = s.effects.map(e => G.effects.instantiate(e, sk.rank, sk.name, 'spec')).filter(Boolean); sk.effectSource = 'spec'; }
      else { const r = G.effects.resolveSkill(sk, { trueName: spec.name }); sk.effects = r.effects; sk.effectSource = r.source; }
      return sk;
    });
    const m = {
      kind: 'master',
      id: spec.id || 'm:' + (spec.name || Math.floor(rnd() * 1e9).toString(36)),
      name: spec.name || null,              // null ならゲーム側で名前を生成
      sex: spec.sex || (rnd() < 0.5 ? '男' : '女'),
      age: spec.age != null ? spec.age : Math.round(16 + rnd() * 30),
      origin, originLabel: spec.originLabel || O.name,
      stats, statSource,
      skills,
      traits: spec.traits || [],            // 自由な特徴の文字列（「魔眼持ち」など）
      catalyst: spec.catalyst !== undefined ? spec.catalyst : (rnd() < O.catalyst ? { servant: null, kind: 'random' } : null),
      wish: spec.wish || null,
      commandSpells: spec.commandSpells != null ? spec.commandSpells : 3,
      resources: Object.assign({ money: R.toScore(O.money, 32), workshop: origin === 'noble' ? 1 : 0, familiars: 0 }, spec.resources || {}),
      relations: spec.relations || [],      // [{ name, text }] 他のマスターやサーヴァントとの因縁
      voice: spec.voice || {},
      profile: spec.profile || {},
      custom: spec.custom || {},            // 型の決まっていない設定は何でもここへ
      source: spec.source || (spec.name ? 'preset' : 'random'),
    };
    return m;
  }

  /** 固定キャラのマスターを登録（ゲームではまずこの中から、足りなければ抽選で埋める） */
  function registerMaster(spec) { MASTERS.push(spec); return spec; }

  /**
   * サーヴァントと同じ書式のWikiテキストからマスターを読む（任意）。
   * 対応する項目：【名前/氏名】【性別】【年齢】【出自/家系/立場】【願い】【触媒】【ステータス】魔力量：B 魔術：C …
   * スキルは【保有スキル】などの見出しの下に「**名前：ランク」
   */
  function parseMasterText(text) {
    const P = G.parser, page = P.parsePage(text);
    const spec = { stats: {}, skills: [], profile: {}, relations: [], voice: {}, custom: {}, source: 'wiki' };
    const LAB = [['mana', /魔力量|魔力|回路/], ['craft', /魔術|魔術師としての腕|技量/], ['body', /体力|身体|肉体/], ['mind', /精神|胆力/], ['luck', /幸運|運/]];
    for (const { key, value } of page.info) {
      const k = R.normalize(key);
      if (/^(名前|氏名|真名)$/.test(k)) spec.name = value;
      else if (/^性別$/.test(k)) spec.sex = value;
      else if (/^年齢$/.test(k)) spec.age = parseInt(R.normalize(value), 10) || value;
      else if (/^(出自|家系|立場|経歴|所属)$/.test(k)) { spec.originLabel = value; const hit = ORIGIN_WORDS.find(([, re]) => re.test(value)); spec.origin = hit ? hit[0] : 'custom'; }
      else if (/^願い/.test(k)) spec.wish = value;
      else if (/^触媒/.test(k)) spec.catalyst = { text: value, servant: null };
      else if (/^(ステータス|能力)$/.test(k)) {
        const t = R.normalize(value);
        for (const [sk, re] of LAB) { const m = t.match(new RegExp('(?:' + re.source + ')\\s*[:：]\\s*([^\\s]+)')); if (m) spec.stats[sk] = m[1]; }
      } else if (/^(魔術回路)$/.test(k)) spec.stats.mana = spec.stats.mana || (R.parseRank(value).base ? value : undefined);
      else spec.custom[key] = value;
    }
    for (const s of page.sections) {
      if (s.key === 'skills' || s.key === 'classSkills') spec.skills.push(...P.itemsToSkills(s).map(x => ({ name: x.name, rank: x.rankRaw, desc: x.desc })));
      const body = s.lines.concat(...s.items.map(i => [i.title, ...i.lines]));
      if (s.key === 'relations') for (const p of P.collectPairs(body)) spec.relations.push({ name: p.key, text: p.value });
      P.collectVoice(body, spec.voice);
    }
    if (!spec.origin) delete spec.origin;
    return spec; // createMaster(spec) に渡すと、書いていない部分が抽選で埋まる
  }

  G.master = { MASTER_STATS, ORIGINS, MASTERS, createMaster, registerMaster, parseMasterText, drawStat, pickOrigin };
})(globalThis.HGW = globalThis.HGW || {});
