/* 聖杯戦争の進行
 *
 * 2つの使い方がある。
 *
 *   全自動：  const war = HGW.engine.runWar({ roster, seed });
 *   対話式：  const out = {};
 *             const gen = HGW.engine.warGen({ roster, seed, ask: 'sometimes', out });
 *             let r = gen.next();                // out.entries に記録がたまる
 *             while (!r.done) {                  // r.value が「判断を求める問い」
 *               r = gen.next(選んだ k か 'auto');
 *             }
 *             r.value が結果
 *
 * 判断を求めるのはプレイヤーの陣営だけ。他の陣営は同じ問いを自動で決める。
 * 同じシード・同じデータ・同じ選択なら、毎回同じ戦争になる。
 * 数値の調整は config.js の ENGINE、文章は names.js。
 */
(function (G) {
  'use strict';
  const B = G.build, R = G.rank, E = G.effects;

  // ---------- シード付き乱数 ----------
  function makeRng(seed) {
    let h = 1779033703 ^ String(seed).length;
    for (let i = 0; i < String(seed).length; i++) { h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    let a = h >>> 0;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const r1 = x => Math.round(x * 10) / 10;
  const firstSentence = (t, max) => { const s = String(t || '').split(/[。\n]/).map(x => x.trim()).filter(x => x.length >= 8)[0] || ''; return s.length > (max || 60) ? s.slice(0, max || 60) + '…' : s; };

  // 戦略（陣営ごとの性格）。昼の行動の重みと、夜に出撃する確率を変える
  const POLICIES = {
    aggressive: { label: '攻めの戦略', day: { scout: 1.5, fortify: 0.6, hide: 0.4 }, hunt: 0.2 },
    defensive:  { label: '守りの戦略', day: { fortify: 2, rest: 1.3 }, hunt: -0.12 },
    intel:      { label: '情報戦の戦略', day: { scout: 2, hide: 1.5 }, hunt: -0.05 },
    diplomacy:  { label: '同盟重視の戦略', day: { ally: 3 }, hunt: -0.1 },
    balanced:   { label: '臨機応変', day: {}, hunt: 0 },
  };

  // 方針：プレイヤーがいつでも切り替えられる、その日の動き方。次の日の朝から反映される
  //   day: 昼の行動 / night: 夜に出撃するか（null は戦略どおり） / stance: 戦い方
  const FOCUS = {
    auto:   { code: 'o', label: 'おまかせ', desc: '戦略に沿って臨機応変に動く', day: null, night: null, stance: null },
    attack: { code: 'a', label: '攻め', desc: '昼は偵察し、夜は敵を探して戦う。戦いでは宝具も惜しまない', day: 'scout', night: true, stance: 'all' },
    defend: { code: 'd', label: '守り', desc: '工房を強化し、夜は拠点で迎え撃つ', day: 'fortify', night: false, stance: 'careful' },
    scout:  { code: 's', label: '偵察', desc: '敵の拠点と真名を探る。夜の動きは戦略どおり', day: 'scout', night: null, stance: 'careful' },
    rest:   { code: 'r', label: '休養', desc: '傷と魔力の回復に努め、夜は動かない', day: 'rest', night: false, stance: 'careful' },
    hide:   { code: 'h', label: '潜伏', desc: '気配を断って見つからないようにする。戦いになればすぐ退く', day: 'hide', night: false, stance: 'retreat' },
    ally:   { code: 'l', label: '交渉', desc: '他の陣営に同盟を持ちかける', day: 'ally', night: null, stance: 'careful' },
  };

  function* warGen(opts) {
    opts = opts || {};
    const ENG = Object.assign({}, G.CONFIG.ENGINE, opts.engine || {});
    const seed = opts.seed || Math.random().toString(36).slice(2, 8);
    const rnd = makeRng(seed);
    const chance = p => rnd() < p;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const wpick = o => { let t = 0; for (const k in o) t += Math.max(0, o[k]); let x = rnd() * t; for (const k in o) { x -= Math.max(0, o[k]); if (x <= 0) return k; } return Object.keys(o)[0]; };
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const askLevel = opts.ask || 'never'; // 'never' 以外なら、プレイヤーの陣営で大きな決断のたびに止まる

    const roster = (opts.roster || []).filter(s => s && s.score && !s.bossOnly);   // ボス専用の英霊（特異点のボス）は聖杯戦争に呼ばない
    if (roster.length < 2) throw new Error('サーヴァントが2騎以上必要です');
    // 特異点（singularity.js）：舞台・陣営・進行を差し替える。聖杯戦争では null で、ここから下の動きは何も変わらない
    const SG = opts.sing || null;
    const sInit = SG ? SG.init({ rnd, chance, pick, wpick, shuffle, ENG, seed, roster }) : null;

    // ---------- 舞台と陣営 ----------
    const W = G.WORLD, N = G.NAMES;
    const city = SG ? sInit.city : opts.city || pick(W.cities);
    const places = SG ? sInit.places : shuffle(W.places);
    const comp = SG ? [] : G.war.composeWar(roster, rnd, opts.war).filter(x => x.servant);
    const labelCount = {};
    const masterPool = (opts.masters || []).slice();
    const camps = SG ? sInit.camps : comp.map((x, i) => {
      const sv = JSON.parse(JSON.stringify(x.servant));
      for (const k of B.STAT_KEYS) if (sv.ranks[k] && sv.ranks[k].range) { sv.ranks[k] = R.rollRange(sv.ranks[k], rnd, G.CONFIG.STAT_SCORE); sv.score[k] = sv.ranks[k].score; }
      sv.power = B.combatPower(sv);
      const def = G.classDef(sv.class.key);
      const base = sv.class.key === 'extra' ? sv.class.label : def.label;
      labelCount[base] = (labelCount[base] || 0) + 1;
      const preset = masterPool.length && chance(0.5) ? masterPool.splice(Math.floor(rnd() * masterPool.length), 1)[0] : null;
      const m = G.master.createMaster(preset || {}, rnd);
      if (!m.name) m.name = makeName(m);
      // 性格：設定があればそれ、無ければ出自に合わせて抽選
      m.persona = preset && preset.persona && G.PERSONAS[preset.persona] ? preset.persona
        : wpick(Object.fromEntries(Object.entries(G.PERSONAS).map(([k, p]) => [k, (p.origins && p.origins[m.origin]) || 1])));
      // 願い：出自と性格に合った候補から
      m.wish = m.wish || pick(G.wishPool ? G.wishPool(m.origin, m.persona) : G.WISHES);
      const c = {
        id: i, slot: x.slot, substitute: x.substitute, extra: x.extra, sv, master: m, labelBase: base, label: base,
        hp: 100, mhp: 0, mhpMax: 0, mana: 0, manaMax: 0, cs: m.commandSpells,
        alive: true, masterAlive: true, out: false, fate: null, soloLeft: null, inChurch: false, merged: false,
        base: places[i % places.length], workshop: m.resources.workshop || 0, items: 0, pact: null, op: null,
        knowName: new Set([i]), knowLoc: new Set([i]), temp: [], npBoost: 0, kills: [], npUses: 0, battles: 0,
        hunting: false, hidden: false, wander: false, fought: false, stance: null, usedSup: new Set(),
        bond: 30 + (m.catalyst ? 10 : 0), policy: 'balanced', plan: null, warned: 0, bounty: false, dreams: 0, lifeSeen: new Set(),
        knowPersona: new Set([i]), clues: {},
      };
      c.mhpMax = c.mhp = Math.round(50 + m.stats.body * 0.8);
      c.manaMax = Math.round(ENG.manaBase + m.stats.mana);
      c.mana = c.manaMax;
      for (const e of Object.values(sv.effectSummary || {})) if (e.id === 'master_buff' && e.params && e.params.stat && e.passive) m.stats[e.params.stat] = (m.stats[e.params.stat] || 0) + e.passive;
      return c;
    });
    const seenLabel = {};
    for (const c of camps) if (labelCount[c.labelBase] > 1) { seenLabel[c.labelBase] = (seenLabel[c.labelBase] || 0) + 1; c.label = c.labelBase + '（' + '一二三四五六七'[seenLabel[c.labelBase] - 1] + '）'; }
    let youTaken = null;   // { master, day }：あなたのマスターが死んだあと、サーヴァントが他のマスターと契約した
    let you = SG ? sInit.you : opts.player === 'none' ? null : camps[opts.player != null ? opts.player : Math.floor(rnd() * camps.length)];
    if (you) you.you = true;
    // プレイヤーが付けた名前（乱数は使わない。名前は文面にしか出ないので、展開は変わらない）
    const pName = opts.playerName ? String(opts.playerName).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) : '';
    if (you && pName) { you.master.name = pName; you.master.named = true; }
    // プレイヤーが決めた性別・年齢（これも乱数は使わない。性別を変えて名前を付けていないときは、名前の下の名を種から決め直す）
    if (you) {
      const m = you.master, sx = opts.playerSex === '男' || opts.playerSex === '女' ? opts.playerSex : '', ag = Math.round(Number(opts.playerAge));
      if (isFinite(ag) && ag >= 10 && ag <= 99) m.age = ag;
      if (sx && sx !== m.sex) {
        m.sex = sx;
        if (!pName && N && m.source !== 'preset') {
          const h = (() => { let x = 2166136261; for (const ch of seed + ':性別:' + m.name) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; })();
          const L = a => a[h % a.length], fem = sx === '女', nm = String(m.name || '');
          if (nm.includes('・')) m.name = L(fem ? N.westFemale : N.westMale) + '・' + nm.split('・').slice(1).join('・');
          else if (nm.includes(' ') && N.jpSurname) m.name = nm.split(' ')[0] + ' ' + L(fem ? N.jpFemale : N.jpMale);
        }
      }
    }
    const pubName = new Set();
    // 因縁：Wikiの「因縁キャラ」に、この戦争にいる別のサーヴァントの名前があるか
    const rel = {};
    for (const a of camps) for (const r of a.sv.relations || []) for (const b of camps) {
      if (a === b || !r.name || r.name.length < 2) continue;
      const tn = b.sv.trueName.replace(/[(（].*$/, '');
      if (tn.length >= 2 && (tn.includes(r.name) || r.name.includes(tn))) (rel[a.id] = rel[a.id] || {})[b.id] = r.text;
    }
    const related = (a, b) => (rel[a.id] && rel[a.id][b.id]) || (rel[b.id] && rel[b.id][a.id]);
    // 性格（マスターに付く。再契約すれば新しい陣営に移る）
    const PER = c => (G.PERSONAS && G.PERSONAS[c.master.persona]) || {};
    const perv = (c, k) => PER(c)[k] || 0;
    // 手がかり：相手の真名に近づく材料（戦う・宝具を見る・偵察する）
    const clue = (c, t, n) => { if (c === t || c.knowName.has(t.id)) return; c.clues[t.id] = (c.clues[t.id] || 0) + n; };

    function makeName(m) {
      const west = m.origin === 'noble' ? chance(0.5) : m.origin === 'civilian' ? chance(0.1) : chance(0.35);
      const female = /女/.test(m.sex);
      return west ? pick(female ? N.westFemale : N.westMale) + '・' + pick(N.westSurname) : pick(N.jpSurname) + ' ' + pick(female ? N.jpFemale : N.jpMale);
    }

    // ---------- 記録 ----------
    const out = opts.out || {};
    const entries = out.entries = [];
    out.seed = seed; out.city = city; out.camps = camps.map(c => ({ id: c.id, label: c.label }));
    // 画面に出す固定の情報（ステータス・スキル・宝具の名前）
    out.meta = camps.map(c => ({
      id: c.id, trueName: c.sv.trueName, cls: c.sv.class.label,
      ranks: B.STAT_KEYS.map(k => [B.STAT_JA[k], R.label(c.sv.ranks[k])]),
      skills: (c.sv.allSkills || []).map(x => x.name).join('、'),
      nps: (c.sv.nps || []).map(n => '『' + n.name + '』').join(' '),
    }));
    let day = 0, phase = 'prologue';
    let tonight = {};   // その夜の天候など（雨・満月・祭り）
    const known = c => !you || c.you || you.knowName.has(c.id) || pubName.has(c.id);
    const nm = c => known(c) ? `${c.label}「${c.sv.trueName}」` : c.label;
    const sn = c => known(c) ? c.sv.trueName : c.label;           // 文中で短く呼ぶとき
    const mn = c => c.master.name;
    // 記録ごとの各陣営の様子（特異点では singularity.js が自分の形で作る）
    const snap = () => SG ? SG.snap() : camps.map(c => ({
      id: c.id, label: c.label, name: known(c) ? c.sv.trueName : null, cls: c.sv.class.label,
      hp: Math.max(0, Math.round(c.hp)), mhp: Math.max(0, Math.round(c.mhp / c.mhpMax * 100)), mana: Math.round(c.mana / c.manaMax * 100),
      alive: c.alive, masterAlive: c.masterAlive, master: mn(c), cs: c.cs, ally: c.pact == null ? null : (allies(c)[0] || { id: null }).id, allies: c.pact == null ? [] : allies(c).map(x => x.id), workshop: c.workshop, you: !!c.you, out: c.out,
      fate: c.fate ? c.fate.text : null, soloLeft: c.soloLeft, bond: Math.round(c.bond), bounty: c.bounty,
      origin: c.master.originLabel, wish: c.master.wish, base: c.base.name, scene: c.base.scene,
      persona: !you || c.you || you.knowPersona.has(c.id) ? (PER(c).label || null) : null,
      clues: you && !c.you && !known(c) ? (you.clues[c.id] || 0) : 0,
    }));
    function log(kind, text, ids, extra) {
      ids = ids || [];
      const e = Object.assign({ day, phase, kind, text, ids, you: SG ? ids.some(i => camps[i] && camps[i].you) : !!you && ids.includes(you.id) }, extra || {});
      if (phase === 'night' && tonight.rain) e.weather = 'rain';
      else if (phase === 'night' && tonight.moon) e.weather = 'moon';
      else if (phase === 'night' && tonight.fog) e.weather = 'fog';
      e.snap = snap();
      entries.push(e);
      if (you && ids.includes(you.id) && /battle|death|cs/.test(kind)) you.notable = true;
      return e;
    }
    // 文面（names.js の LINES）から1つ選んで {…} を埋める。乱数は使わず、シードと記録の位置で決まるので、
    // 文面を足しても戦争の展開は変わらない
    let lineN = 0;
    function line(key, vars) {
      const list = (G.LINES && G.LINES[key] && G.LINES[key].length) ? G.LINES[key] : [key];
      let h = 2166136261; const t = seed + ':' + (lineN++) + ':' + entries.length;
      for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
      return list[(h >>> 0) % list.length].replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? vars[k] : m);
    }
    // セリフ（config.js の VOICE_SLOTS の場面ごと。別名の見出しの行も使う）。選び方は乱数ではなく、シード・記録の位置・
    // 陣営・場面で決まるので、セリフを足したり直したりしても戦争の展開は変わらない
    const vpick = (lines, c, key) => {
      let h = 2166136261; const t = seed + ':v:' + entries.length + ':' + c.id + ':' + key;
      for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
      return lines[(h >>> 0) % lines.length];
    };
    const voice = (c, keys) => { for (const k of keys) { const v = G.voiceLines(c.sv, k); if (v.length) return vpick(v, c, k); } return null; };
    const say = (c, keys) => { const v = voice(c, keys); return v ? { who: nm(c), text: v } : null; };
    const bondUp = (c, n) => { c.bond = clamp(c.bond + (n > 0 ? n * (PER(c).bond || 1) : n), 0, 100); };
    // 宝具のセリフは、その宝具の名前を含むものを優先。別の宝具の名前を叫んでいるものは使わない
    const sayNP = (c, np) => {
      const pool = G.npVoiceLines(c.sv, np).lines;
      return pool.length ? { who: nm(c), text: vpick(pool, c, '宝具:' + np.name) } : null;
    };

    // ---------- 判断 ----------
    // プレイヤーの陣営なら問いを出して止まる。それ以外（と「おまかせ」）は auto() で決める
    function* ask(c, kind, q, auto) {
      if (!c || !c.you || askLevel === 'never' || c.retired) return auto();
      const options = q.options.filter(Boolean);
      const ans = yield { type: 'decision', kind, day, phase, title: q.title, body: q.body || '', note: q.note || '', options, camp: c.id };
      const chosen = options.find(o => o.k === ans);
      const k = chosen ? chosen.k : auto();
      const o = options.find(x => x.k === k);
      // 決断の一覧（結末の画面）に使うので、何を問われたか（q）と種類（dk）も残す
      log('choice', `${chosen ? '' : 'おまかせ：'}${o ? o.label : k}`, [c.id], { q: q.title, dk: kind, auto: !chosen });
      return k;
    }

    // ---------- 効果の参照 ----------
    // 条件付きの効果：水辺・森・山はその場所（雨の夜は水辺）、夜（夜間・暗闇）は夜の戦い（満月の夜を除く）か地下
    // 効果の条件（effects.js の params）：cond＝場面、vs＝相手の属性、chance＝戦いごとの発動確率
    //   c.bx は戦いの間だけある { opp: 相手の陣営, home: 自分の拠点で戦う, rolls: { 効果の集計キー: 当たったか } }
    // 場所の条件（水辺・森・山）：場所を渡されなければ、戦いの最中ならその戦いの場所（致命傷・撤退・マスター狙いなど）、
    //   戦いの外なら自分の拠点の場所で判定する（「水辺で偵察に長ける」なら水辺に拠点があるとき）
    //   condNot／vsNot＝「それ以外のとき」、dmin〜dmax＝その日だけ。相手の属性は、戦いの外では o（偵察・推理・索敵・交渉の相手）で判定する（o が無ければ働かない）
    const condOk = (c, p, terrain0, o) => {
      if (!p) return true;
      const k = p.cond;
      const terrain = terrain0 != null ? terrain0 : c.bx && c.bx.ctx ? c.bx.ctx.terrain : c.base ? c.base.terrain : null;
      if (k) {
        const hit = k === '拠点' ? (c.bx ? !!c.bx.home : true)   // 戦いの外（昼の行動など）は拠点にいる
          : k === '瀕死' ? c.hp < ENG.pinchAt
          : k === terrain || (k === '夜' && phase === 'night' && !tonight.moon);
        if (hit === !!p.condNot) return false;
      }
      if (p.vs) { const t = o || (c.bx && c.bx.opp); if (!t || t.sv.tags.includes(p.vs) === !!p.vsNot) return false; }
      if ((p.dmin > 0 || p.dmax > 0) && !E.dayOk(p, day)) return false;
      return true;
    };
    // 日ごとの強さの変化（effects.js の dayMult。params.grow／decay の無い効果は1）
    const dm = p => p && (p.grow || p.decay) ? E.dayMult(p, day) : 1;
    // 発動確率：戦いの間は戦いの始めの判定どおり、戦い以外では強さ×確率
    const chanceW = (c, key, p) => !p || p.chance == null ? 1 : c.bx ? (c.bx.rolls[key] ? 1 : 0) : clamp(p.chance, 0, 1);
    // effS：スキル・宝具の常時の効果だけ（戦闘力の計算用）／eff：それに、この戦いだけの効果（c.temp）を足したもの
    // 止めた効果（自己強化解除 self_strip・特定の効果の強化解除 strip）：c.off は '名前'（その源のすべて）／'名前|効果'（その源のその効果）／
    //   '|効果'（どの源のものでもその効果）の集合。常時の効果からはその分を引き、その戦いだけの効果（c.temp）からは外す
    const offMatch = (c, from, id) => !!c.off && (c.off.has('|' + id) || (from ? c.off.has(E.normName(from)) || c.off.has(E.normName(from) + '|' + id) : false));
    const offW = (c, x) => { if (!c.off || !x.by || (x.params && x.params.nocure)) return 0; let t = 0; for (const n in x.by) if (offMatch(c, n, x.id)) t += x.by[n]; return t; };
    // 止めた効果を、その戦いだけの効果（と次の朝までの効果）から外す
    const keepOff = (c, e) => (e.params && e.params.nocure) || !offMatch(c, e.from, e.id);   // 解除で消えない効果は残す
    const dropOff = c => { if (c.temp) c.temp = c.temp.filter(e => keepOff(c, e)); if (c.dayTemp) c.dayTemp = c.dayTemp.filter(e => keepOff(c, e)); };
    // 相手がその効果を持っているか（常時の分か、その戦いだけの分）
    const holds = (c, id) => (c.temp || []).some(e => e.id === id) || Object.values(c.sv.effectSummary || {}).some(x => x.id === id && x.passive);
    // self：自分に掛ける不利な効果（params.self）だけを数える。ふだん（false）は相手に掛ける分・自分のための分だけ
    const isSelf = p => !!(p && p.self);
    //   o：戦いの外で相手のいる場面（偵察・推理・索敵・交渉）の相手。相手の属性の条件（params.vs）に使う
    function effS(c, id, terrain, self, o) {
      let t = 0;
      for (const [k, x] of Object.entries(c.sv.effectSummary || {})) if (x.id === id && isSelf(x.params) === !!self && condOk(c, x.params, terrain, o)) t += (x.passive - offW(c, x)) * chanceW(c, k, x.params) * dm(x.params);
      return t;
    }
    function eff(c, id, terrain, self, o) {
      let t = effS(c, id, terrain, self, o);
      // 戦いの外では、毎朝発動した効果（c.dayTemp）も数える（戦いの中では戦いの始めに c.temp へ写してある）
      for (const e of c.bx || !c.dayTemp ? c.temp : c.temp.concat(c.dayTemp)) if (e.id === id && isSelf(e.params) === !!self && condOk(c, e.params, terrain, o)) t += e.mag;
      return t;
    }
    const effO = (c, id, o) => eff(c, id, undefined, false, o);   // 戦いの外で相手のいる場面
    const effVs = (c, id, o, terrain) => {
      let t = 0;
      for (const [k, x] of Object.entries(c.sv.effectSummary || {})) if (x.id === id && x.params && o.sv.tags.includes(x.params.tag) && condOk(c, x.params, terrain)) t += (x.passive - offW(c, x)) * chanceW(c, k, x.params) * dm(x.params);
      for (const e of c.temp) if (e.id === id && e.params && o.sv.tags.includes(e.params.tag) && condOk(c, e.params, terrain)) t += e.mag;
      return t;
    };
    // ---------- 状態異常（effects.js の AILMENTS：魅了・毒・スタン・混乱・宝具封印。防ぐのは ail_guard ほか） ----------
    // ailInfo：その効果の強さの合計と、いちばん強いものの params（表示名 name・記録の文 msg）
    function ailInfo(c, id, terrain, self) {
      let t = 0, top = null, best = -Infinity;
      for (const [k, x] of Object.entries(c.sv.effectSummary || {})) if (x.id === id && isSelf(x.params) === !!self && condOk(c, x.params, terrain)) { const m = (x.passive - offW(c, x)) * chanceW(c, k, x.params) * dm(x.params); t += m; if (m > best) { best = m; top = x.params; } }
      for (const e of c.temp) if (e.id === id && isSelf(e.params) === !!self && condOk(c, e.params, terrain)) { t += e.mag; if (e.mag > best) { best = e.mag; top = e.params; } }
      return { t, p: top };
    }
    // 防ぐ確率：状態異常耐性＋（魅了・混乱は精神耐性とマスターの精神／毒・スタンは耐久）
    const ailResist = (y, id, T) => clamp(eff(y, 'ail_guard', T)
      + (id === 'confuse' || id === 'charm' ? eff(y, 'mental_guard', T) + FX.mMindCharm * md(y, 'mind') : 0)
      + (id === 'stun' || id === 'poison' ? 0.05 * Math.max(0, sd(y, 'end')) : 0), 0, 0.95);
    // 記録の文：掛けたときの文は、効果に params.msg があればそれ（{S} 掛けた側・{O} 掛けられた側・{N} 状態の名前）、
    // 無ければ names.js の G.LINES。どちらも乱数ではなく選ぶので、文を変えても展開は変わらない
    const AIL_KEY = { charm: 'ailCharm', poison: 'ailPoison', stun: 'ailStun', confuse: 'ailConfuse', seal: 'ailSeal' };
    // 自分に掛かる状態異常の記録の文（params.msg があればそれ）
    const SELF_AIL = ['stun', 'confuse', 'poison', 'seal'];
    const SELF_AIL_LINE = { stun: '{O}の体が、不意に言うことを聞かなくなった。{N}だ。', confuse: '{O}の意識が揺らぎ、刃先が定まらない。{N}だ。',
      poison: '{O}の霊基を、内側からの{N}が蝕み始めた。', seal: '{O}の宝具が、己の内に閉ざされた。{N}だ。' };
    const fillT = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m);
    const ailText = (key, id, p, x, y) => {
      const v = { S: x ? sn(x) : '', O: sn(y), N: (p && p.name) || E.AILMENTS[id] };
      return p && p.msg && key === AIL_KEY[id] ? fillT(p.msg, v) : line(key, v);
    };
    // 掛ける：強さ（上限つき）で判定し、相手の耐性で防がれることもある。強さが0なら乱数を使わない
    function tryAil(x, y, id, T) {
      const { t, p } = ailInfo(x, id, T);
      if (!(t > 0) || !chance(Math.min(E.AIL_CAP[id], t) * (1 - (y.cleanse || 0)))) return null;   // 弱体解除（cleanse）した戦いでは掛かりにくい
      const r = ailResist(y, id, T);
      if (r > 0 && chance(r)) { log('battle', ailText('ailResist', id, p, x, y), [y.id, x.id]); return null; }
      return p || {};
    }
    // 戦いの始め：相手・拠点を覚え、発動確率のある効果をこの戦いの分だけ判定する（確率のある効果を持たない英霊では rnd を使わない）
    const enterBattle = (c, opp, home) => {
      c.bx = { opp, home, rolls: {} };
      for (const [k, x] of Object.entries(c.sv.effectSummary || {})) if (x.params && x.params.chance != null && !x.on) c.bx.rolls[k] = x.params.chance >= 1 || chance(x.params.chance);   // 発動する効果（x.on）は発動のたびに判定
    };
    // ---------- 発動する効果（effects.js の TRIGGERS：params.on）----------
    //   スキルの発動する効果は effectSummary の trig（x.on の場面）、使った宝具の効果で場面つきのものは c.armed（その戦いの間）。
    //   魔力（cost）を払えないとき・回数（uses）を使い切ったとき・確率（chance）に外れたとき・スキル封印されているときは発動しない。
    //   回復・吸収・解除・スキル封印はその場で働き、ほかの効果は c.temp（その戦いの終わりまで。打ち合いのたびのものはその打ち合いだけ）か、
    //   毎朝・相手を倒したときのものは c.dayTemp（次の朝まで。夜の戦いの始めに c.temp へ写す）に入る。同じ効果は重ねない。
    //   発動する効果を持たない英霊では何もしない（乱数も使わない）ので、いままでの展開は変わらない
    const isBuff = e => { const inf = E.EFFECT_INFO[e.id] || {}; return !!inf.bad === (e.mag < 0) && inf.who !== 'enemy' && inf.who !== 'enemyMaster'; };
    const isHex = e => { const inf = E.EFFECT_INFO[e.id] || {}; return !!inf.bad === (e.mag < 0) && (inf.who === 'enemy' || inf.who === 'enemyMaster') && !(e.params && e.params.self); };
    function trigList(c, on) {
      const out = [];
      for (const [k, x] of Object.entries(c.sv.effectSummary || {})) if (x.trig && x.on === on) out.push([k, x.id, x.trig, x.params, (x.from[0] || '').replace(/\(消滅後も持続\)$/, '')]);
      for (const a of c.armed || []) if (a.on === on) out.push([a.k, a.id, a.mag, a.params, a.from]);
      return out;
    }
    function fireTrig(c, o, on, T) {
      if (!c.alive) return;
      const list = trigList(c, on); if (!list.length) return;
      if (on !== 'day' && c.ail && c.ail.skseal) return;   // スキル封印
      for (const [k, id, mag, p0, from] of list) {
        const p = p0 || {};
        if (!condOk(c, p, T) || offMatch(c, from, id)) continue;   // 止めた効果は発動しない
        // 回数：戦いの中の発動は1回の戦いで、毎朝の発動は戦争を通して（「最初のN日」）
        const U = on === 'day' ? (p.uses > 0 ? (c.dUsed = c.dUsed || {}) : null) : c.tUsed;
        const used = (U && U[k]) || 0;
        const lim = p.uses > 0 ? p.uses : on === 'start' || on === 'pinch' || on === 'kill' ? 1 : 0;
        if (U && lim && used >= lim) continue;
        const m = mag * dm(p); if (!m) continue;   // 日ごとの変化で強さが0になった効果は発動しない
        if (p.cost > 0 && c.mana < p.cost) continue;
        if (p.chance != null && p.chance < 1 && !chance(Math.max(0, p.chance))) continue;
        if (p.cost > 0) c.mana -= p.cost;
        if (U) U[k] = used + 1;
        applyTrig(c, o, k, id, m, p, from, on, T);
      }
    }
    // 発動した効果を働かせる。記録は、その戦いで（毎朝のものはその戦争で）その効果が初めて発動したときだけ
    function applyTrig(c, o, k, id, mag, p, from, on, T) {
      const src = from ? `『${from}』` : 'スキル';
      const say = txt => {
        if (on === 'day') { if (!c.you || (c.dLog && c.dLog.has(k))) return; (c.dLog = c.dLog || new Set()).add(k); log('day', txt, [c.id]); return; }
        if (c.tLog && c.tLog.has(k)) return;
        if (c.tLog) c.tLog.add(k);
        log('battle', txt, [c.id].concat(o ? [o.id] : []));
      };
      if (id === 'heal') { const v = Math.min(mag, 100 - c.hp); if (v > 0) { c.hp += v; say(`${sn(c)}の${src}が、傷ついた霊基を癒やした。`); } return; }
      if (id === 'drain_hp') { if (!o || !o.alive) return; const v = Math.min(mag, Math.max(0, o.hp - 1)); if (v > 0) { o.hp -= v; c.hp = Math.min(100, c.hp + v); say(`${sn(c)}の${src}が、${sn(o)}の霊基を吸い上げた。`); } return; }
      if (id === 'mana_gain') { const v = Math.min(mag, c.manaMax - c.mana); if (v > 0) { c.mana += v; say(`${sn(c)}の${src}が、魔力を満たした。`); } return; }
      if (id === 'drain_mana') { if (!o) return; const v = Math.min(mag, Math.max(0, o.mana)); if (v > 0) { o.mana -= v; c.mana = Math.min(c.manaMax, c.mana + v); say(`${sn(c)}の${src}が、${sn(o)}の魔力を奪い取った。`); } return; }
      if (id === 'strip') {
        // 効果を指定したもの（params.eff）：相手のその効果を、常に持っている分も含めてその戦いの間止める
        if (p.eff) {
          if (!o || !o.temp || (o.off && o.off.has('|' + p.eff)) || !holds(o, p.eff)) return;
          if (mag < 1 && !chance(Math.max(0, mag))) return;
          (o.off = o.off || new Set()).add('|' + p.eff); dropOff(o);
          say(`${sn(c)}の${src}が、${sn(o)}の${(E.EFFECTS[p.eff] || {}).name || '力'}を打ち消した。`); return;
        }
        if (!o || !o.temp || !(o.temp.some(isBuff) || o.surprise)) return;
        if (mag < 1 && !chance(Math.max(0, mag))) return;
        o.temp = o.temp.filter(e => !isBuff(e)); o.surprise = 0;
        say(`${sn(c)}の${src}が、${sn(o)}の強化を打ち消した。`); return;
      }
      if (id === 'wither') {
        // 衰弱：相手（params.self なら自分）の戦闘力を少しずつ削り、重なって残る。相手からのものは耐久と対魔力で防ぐ
        const tg = p.self ? c : o; if (!tg || !tg.alive) return;
        const key = p.self ? (p.nocure ? 'witherFix' : 'witherSelf') : 'wither', before = tg[key] || 0;
        const v = p.self ? mag : mag * (1 - bodyRes(tg, T)) * (1 - (tg.cleanse || 0));
        if (!(v > 0)) return;
        tg[key] = Math.min(ENG.witherCap, before + v);
        if (tg[key] > before) say(p.self ? `${sn(c)}の${src}が、その身を少しずつ蝕んでいく。` : `${sn(c)}の${src}が、${sn(tg)}の霊基をじわじわと蝕んでいく。`);
        return;
      }
      if (id === 'cleanse') {
        // 自分に掛けた状態異常のうち、解除で消えないもの（params.nocure：ail.〇〇Fix・poison.fix）は残す
        const cure = id => c.ail && c.ail[id] && !c.ail[id + 'Fix'];
        const had = !!((c.poison && !c.poison.fix) || c.wither || c.witherSelf || cure('stun') || cure('confuse') || cure('seal') || (c.ail && c.ail.skseal) || (o && o.temp && o.temp.some(isHex)));
        if (c.poison && !c.poison.fix) c.poison = null;
        c.wither = 0; c.witherSelf = 0; if (c.ail) { for (const a of ['stun', 'confuse', 'seal']) if (cure(a)) c.ail[a] = false; c.ail.skseal = false; }
        if (o && o.temp) o.temp = o.temp.filter(e => !isHex(e));
        if (on !== 'day') c.cleanse = clamp(Math.max(c.cleanse || 0, mag), 0, 1);
        if (had) say(`${sn(c)}の${src}が、身を蝕むものを祓った。`); return;   // 消すものが無ければ記録しない（守りは掛かっている）
      }
      if (id === 'self_strip') {
        // tag＝止めるスキル・宝具の名前、eff＝止める効果（どちらか、または両方）。どちらも無ければ、その戦いで得た強化を消す
        const tag = p.tag ? E.normName(p.tag) : '', ef = p.eff || '';
        const effName = ef ? (E.EFFECTS[ef] || {}).name || ef : '';
        if (tag || ef) { (c.off = c.off || new Set()).add(tag + (ef ? '|' + ef : '')); dropOff(c); }
        else if (c.temp) c.temp = c.temp.filter(e => !isBuff(e));
        say(tag ? `${sn(c)}の${src}が発動し、『${p.tag}』の${effName || '力'}を収めた。` : ef ? `${sn(c)}の${src}が発動し、${effName}を収めた。` : `${sn(c)}の${src}が発動し、まとっていた力を解いた。`); return;
      }
      if (id === 'skill_seal') {
        if (!o || !o.ail || o.ail.skseal) return;
        if (!chance(Math.min(0.8, Math.max(0, mag)) * (1 - (o.cleanse || 0)))) return;
        const r = clamp(eff(o, 'ail_guard', T), 0, 0.95);
        if (r > 0 && chance(r)) { log('battle', `${sn(o)}は、${sn(c)}の${src}を振り払った。`, [o.id, c.id]); return; }
        o.ail.skseal = true; log('battle', `${sn(c)}の${src}が、${sn(o)}のスキルを封じた。`, [o.id, c.id]); return;
      }
      // 強化・弱体などの効果：発動の場面に応じた間だけ働く（同じ効果は重ねない）
      const q = Object.assign({}, p); delete q.on; delete q.cost; delete q.uses; delete q.chance;
      const e = { id, mag, params: Object.keys(q).length ? q : null, from, src: k, rnd: on === 'round' };
      if (on === 'day') { c.dayTemp = (c.dayTemp || []).filter(x => x.src !== k); c.dayTemp.push(e); }
      else if (on === 'kill') { c.carry = (c.carry || []).filter(x => x.src !== k); c.carry.push(e); }   // 相手を倒したときの強化：次の戦いの終わりまで
      else { if (!c.temp || c.temp.some(x => x.src === k)) return; c.temp.push(e); }
      say(`${sn(c)}の${src}が発動した。`);
    }

    // ステータスの役割（config.js の STAT_FX）。sd：サーヴァントの偏差、md：マスターの偏差（C相当を0、A相当を約+1）
    const FX = G.CONFIG.STAT_FX, dev = B.statDev;
    const sd = (c, k) => dev(c.sv.score[k]);
    const md = (c, k) => c.masterAlive ? dev(c.master.stats[k]) : 0;
    // スキルの効果だけを足す（宝具の効果は宝具ごとに読む）。止めた効果・条件も見る
    const skillFx = (c, id, T) => { let t = 0; for (const sk of c.sv.allSkills || []) for (const e of sk.effects || []) if (e.id === id && !(e.params && e.params.on) && condOk(c, e.params, T) && !offMatch(c, sk.name, id)) t += e.mag * dm(e.params); return t; };
    // 宝具の魔力：宝具の基本の消費 ×（スキルの宝具消費＋その宝具の条件付きの宝具消費）
    const npCostOf = (c, n) => {
      let mod = skillFx(c, 'np_cost');
      for (const e of n.effects || []) if (e.id === 'np_cost' && e.params && e.params.cond && condOk(c, e.params)) mod += e.mag * dm(e.params);
      return n.cost * ENG.npCost * Math.max(0.5, 1 - FX.magCost * sd(c, 'mag')) * (mod ? Math.max(0.3, 1 + mod) : 1);
    };
    const active = () => camps.filter(c => c.alive);
    // ---------- 同盟（c.pact：同じ番号の陣営どうしが同盟。最大 ENG.allianceMax 騎）----------
    let pactSeq = 0, leader = null, leaderSeen = new Set();
    const supLog = {};   // 支え合いの記録は、種類ごとに3日に一度まで
    const allies = c => c.pact == null ? [] : camps.filter(x => x !== c && x.alive && x.pact === c.pact);
    const isAlly = (a, b) => a !== b && a.pact != null && a.pact === b.pact;
    const pactOf = c => c.pact == null ? [c] : camps.filter(x => x.alive && x.pact === c.pact);
    const pactNames = list => list.map(x => nm(x)).join('と');
    // 手を組めるか：どちらかが同盟の外で、合わせて上限以内、同盟の外に2騎以上残る（残りが少なくなったら組まない）
    const canPact = (a, b, alive) => a !== b && a.alive && b.alive && a.masterAlive && b.masterAlive && !isAlly(a, b) && (a.pact == null || b.pact == null)
      && alive.length > ENG.allianceBreakAt + 1 && pactOf(a).length + pactOf(b).length <= ENG.allianceMax && alive.length - pactOf(a).length - pactOf(b).length >= 2;
    // 手を組む（一方が同盟にいれば、もう一方がそこに加わる）。同盟の中では互いの真名を知らせ合う
    function formPact(a, b) {
      const id = a.pact != null ? a.pact : b.pact != null ? b.pact : ++pactSeq;
      a.pact = id; b.pact = id;
      const m = pactOf(a);
      for (const x of m) for (const y of m) if (x !== y) x.knowName.add(y.id);
      return m;
    }
    function leavePact(c) {
      const id = c.pact; if (id == null) return; c.pact = null;
      const rest = camps.filter(x => x.pact === id && x.alive);
      if (rest.length <= 1) for (const x of rest) x.pact = null;
    }
    // 裏切るなら、いちばん討ちやすい同盟相手を
    const betrayTarget = c => allies(c).reduce((a, b) => (a.hp / Math.max(5, a.sv.power) <= b.hp / Math.max(5, b.sv.power) ? a : b));
    // 包囲網の的：討った数（＋討伐令）がいちばん多く ENG.coalitionAt 以上の陣営（並んでいれば無し）
    function leaderOf(alive) {
      let best = null, bs = -1, tie = false;
      for (const c of alive) { const s = c.kills.length + (c.bounty ? 1 : 0); if (s > bs) { best = c; bs = s; tie = false; } else if (s === bs) tie = true; }
      return !tie && bs >= ENG.coalitionAt ? best : null;
    }
    // 包囲網に加わる2騎か（的がいて、どちらも的でも的の同盟でもない）
    const coalition = (a, b) => !!leader && leader !== a && leader !== b && !isAlly(leader, a) && !isAlly(leader, b);
    let lastMutual = null;   // 最後に相討ちがあった日（結末の書き分けに使う）
    const isBerserk = c => c.sv.class.key === 'berserker';
    // 維持魔力の倍率：クラス（バーサーカーは重い）× 燃費のスキル
    // 制御の利かない英霊（バーサーカーと、制御困難の強い英霊）：魔力が尽きても止まらず、足りない分をマスターの生命力から食う
    const wildOf = c => c.masterAlive && (isBerserk(c) || eff(c, 'uncontrolled') >= ENG.wildAt);
    const upk = c => (G.classDef(c.sv.class.key).upkeep || 1) * Math.max(0.3, 1 + eff(c, 'upkeep_up') - eff(c, 'upkeep_down'));
    // 魔力が足りない分は、マスターの生命力から吸い上げる（燃費の悪い英霊・魔力の乏しいマスターほど危うい）。
    // マスターが倒れそうなら令呪一画を魔力に換えてしのぐ。令呪も無ければマスターが力尽きる
    function drain(c) {
      if (c.mana >= 0) return;
      if (SG) return SG.hooks.drain(c);   // 特異点：魔力の蓄えは六騎で共有。足りない分はマスターではなく英霊の霊基が削れる
      const short = -c.mana; c.mana = 0;
      if (!c.masterAlive) return;
      c.mhp -= short * ENG.drainLife;
      c.hp -= Math.min(8, short * 0.3);
      if (c.mhp > 0) { if (c.you || c.mhp < c.mhpMax * 0.35) log(phase === 'night' ? 'battle' : 'day', `魔力が足りず、${sn(c)}の現界が${mn(c)}の生命力を削っている。`, [c.id]); return; }
      if (c.cs > 0) {
        c.cs--; c.mhp = Math.max(5, Math.round(c.mhpMax * 0.15)); c.mana = ENG.sealMana;
        log('cs', `生命力まで吸い尽くされかけた${mn(c)}は、令呪一画を魔力に換えて${sn(c)}をつなぎ止めた。（残り${c.cs}画）`, [c.id], { big: true });
      } else masterDown(c, `${sn(c)}に魔力を吸い尽くされ、${day}日目に力尽きた`);
    }

    // 体への干渉（肉体弱体・衰弱）を防ぐ割合：耐久と対魔力（魔術耐性。重なると鈍る）
    const bodyRes = (y, T) => clamp(ENG.bodyEndGuard * sd(y, 'end') + B.softDef(Math.max(0, eff(y, 'magic_guard', T))) * ENG.bodyMagicGuard, -0.5, 0.8);
    function power(c, o, ctx) {
      const T = ctx.terrain;
      let p = B.combatPower(c.sv, T, id => effS(c, id, T)) * (1 + c.temp.filter(e => e.id === 'power' && condOk(c, e.params, T)).reduce((t, e) => t + e.mag, 0));
      p *= (1 + effVs(c, 'power_vs', o, T)) * (1 - effVs(c, 'weakness', o, T) * 0.5);
      const magHeavy = o.sv.class.key === 'caster' || (o.sv.score.mag || 0) > (o.sv.score.str || 0);
      const sure = clamp(eff(o, 'sure_hit', T), 0, 1);   // 相手の必中は回避を打ち消す
      // 守り：被ダメージ軽減・回避・魔術耐性（重なると鈍る：ENGINE.defSoft）。被ダメージ軽減は受ける傷の軽減（下の打ち合い）とは別に、ここでも効く
      const sd0 = B.softDef;
      const def = clamp(sd0(eff(c, 'guard', T)) * ENG.defPowerW + sd0(eff(c, 'evade', T)) * 0.5 * (1 - sure) + (magHeavy ? sd0(eff(c, 'magic_guard', T)) * 0.5 : 0), -0.5, ENG.defCap) * (1 - Math.min(0.9, eff(o, 'pierce', T)));
      p *= 1 + def;
      // 精神耐性：精神への干渉（弱体化・不意打ち）に動じず、傷を負っても心が折れない（ENGINE.mental*）。魅了・混乱は ailResist／魅了の判定で
      const mgd = clamp(B.softDef(eff(c, 'mental_guard', T)), -0.5, 1.5);   // 重なると鈍る（守りの効果と同じ defSoft）
      // 相手の弱体化：種類なし（精神耐性で少し防ぐ）・精神弱体（精神耐性とマスターの精神）・肉体弱体（耐久と対魔力）。合わせて最大5割
      const rMind = clamp(1 - FX.mMindDebuff * md(c, 'mind'), 0.4, 1.5);
      let deb = eff(o, 'debuff', T) * rMind * (1 - clamp(mgd * ENG.mentalDebuff, -0.5, 0.6));
      const dm = eff(o, 'debuff_mind', T), db = eff(o, 'debuff_body', T);
      if (dm) deb += dm * rMind * (1 - clamp(mgd * ENG.mindDebuffGuard, -0.5, 0.8));
      if (db) deb += db * (1 - bodyRes(c, T));
      p *= 1 - Math.min(0.5, deb * (1 - (c.cleanse || 0)));
      // 自分に掛かる弱体化（デメリット）と衰弱（重なって残る）
      const selfDeb = eff(c, 'debuff', T, true) + eff(c, 'debuff_mind', T, true) + eff(c, 'debuff_body', T, true);
      if (selfDeb) p *= 1 - clamp(selfDeb, -0.5, 0.5);
      if (c.wither || c.witherSelf || c.witherFix) p *= 1 - Math.min(ENG.witherCap, (c.wither || 0) + (c.witherSelf || 0) + (c.witherFix || 0));
      if (ctx.home === c) p *= 1 + eff(c, 'territory', T) + c.workshop * 0.05;
      if (c.knowName.has(o.id)) p *= ENG.knowNameMult;   // 真名を知っている相手には、弱点や伝承を突いて有利に戦える
      p *= 1 - 0.45 * (1 - Math.max(0, c.hp) / 100) * (1 - clamp(mgd * ENG.mentalWound, -0.5, 0.6));
      if (!c.masterAlive) p *= 0.9;
      else p *= 1 + FX.mCraftPower * md(c, 'craft');
      if (c.mana < 10 && !wildOf(c)) p *= 0.85;   // 魔力切れで鈍る（狂った英霊は鈍らない。代わりにマスターが削られる）
      if (c.stance === 'all') p *= 1.05;
      if (c.boostUntil != null && c.boostUntil >= day) p *= 1 + 0.2 * (1 + FX.mMindCs * md(c, 'mind'));
      if (c.surprise) p *= 1 + c.surprise * (1 - clamp(eff(o, 'mental_guard', T) * ENG.mentalSurprise, 0, 1));
      p += c.npBoost;
      return p * (0.9 + rnd() * 0.2);
    }

    // ---------- 脱落 ----------
    // fin：戦いで決着がついたとき、何が勝敗を決めたか { how: 'np'|'np-earlier'|'instakill'|'blow', np }
    //   脱落の記録は「とどめ」と一緒に書く（宝具が決め手なら「〇〇の宝具が勝敗を決定づけた」）
    function servantDown(c, text, by, fin) {
      c.alive = false; c.out = true; c.hp = 0;
      c.fate = { day, text };
      if (by) { by.kills.push(c.id); if (c.bounty && by.masterAlive) { by.cs++; log('event', `討伐令の標的を倒した${mn(by)}に、監督役から追加の令呪が一画与えられた。`, [by.id], { big: true }); } }
      leavePact(c);
      // 消えた英霊の真名は、まだ知られていなくても記録に残す（あとでログだけ読んでも誰だったか分かるように）
      const dn = nm(c) === c.label ? `${c.label}（${c.sv.trueName}）` : nm(c);
      const head = !by || !fin ? `${dn}が消滅した。${text}。`
        : fin.how === 'np' ? `${nm(by)}の宝具『${fin.np}』が勝敗を決定づけた。${dn}は消滅した。`
        : fin.how === 'np-earlier' ? `宝具『${fin.np}』で追い詰めた${nm(by)}が、とどめを刺した。${dn}は消滅した。`
        : fin.how === 'instakill' ? `${nm(by)}の一撃が霊核を穿ち、勝敗は決した。${dn}は消滅した。`
        : fin.how === 'mutual' ? `${nm(by)}を討った${dn}もまた、受けた傷に崩れ落ちた。相討ちだった。`
        : line('blow', { by: nm(by), c: dn, c0: nm(c) });
      log('death', head, [c.id].concat(by ? [by.id] : []), { quote: say(c, ['戦闘不能']), big: true, fin: by && fin ? { by: by.id, how: fin.how, np: fin.np || null } : null });
      pubName.add(c.id);
      if (SG) return SG.hooks.down(c, by);   // 特異点：倒れた英霊はその場で消える（マスターは巻き込まれない）
      if (c.you && c.masterAlive) {
        // プレイヤーのマスターは、運が悪ければその場で巻き込まれる
        if (chance(ENG.fallenDeath)) { c.masterAlive = false; c.mhp = 0; c.gameOver = true; log('death', `崩れ落ちる${sn(c)}のすぐそばで、マスターの${mn(c)}もまた命を落とした。`, [c.id].concat(by ? [by.id] : []), { big: true }); }
        else c.fallenPending = true;
        return;
      }
      if (c.masterAlive) {
        if (c.cs > 0 && chance(0.8)) { c.inChurch = true; log('event', `マスターの${mn(c)}は${W.church}に保護を求めた。残る令呪は${c.cs}画。`, [c.id], { place: W.church, scene: 'church' }); }
        else log('event', `マスターの${mn(c)}は姿を消した。`, [c.id]);
      }
    }
    function masterDown(c, text, by) {
      c.masterAlive = false; c.mhp = 0;
      if (SG) { log('death', `マスターの${mn(c)}が倒れた。${text}。`, [c.id].concat(by ? [by.id] : []), { big: true }); return SG.hooks.masterDown(c, by); }   // 特異点：マスターの死は即座に失敗
      c.soloLeft = Math.floor(eff(c, 'solo'));
      log('death', `マスターの${mn(c)}が倒れた。${text}。`, [c.id].concat(by ? [by.id] : []), { big: true });
      if (c.you) c.gameOver = true;
      log('event', c.soloLeft > 0 ? `${nm(c)}は単独行動でしばらく現界を保てる（あと${c.soloLeft}日）。` : `要を失った${nm(c)}の現界は長くはもたない。`, [c.id]);
    }

    // 致命傷：踏みとどまる / 令呪 / 消滅
    function* lethal(l, w, cause, round) {
      // 特異点のボス：ブレイクゲージが残っていれば、霊基を組み直して立ち上がる
      if (SG) { const g = SG.hooks.gauge(l, w); if (g) return g; }
      // 致命傷を受けた瞬間に自動で発動する宝具（回復・踏みとどまりなど）。霊基が戻れば、そのまま踏みとどまる
      if (l.bx && l.bx.ctx && autoNP(l, w, 'lethal', l.bx.ctx, round) && l.hp > 0) {
        log('battle', `宝具の力が、消えかけた${sn(l)}の霊基をつなぎ止めた。`, [l.id, w.id]);
        return 'guts';
      }
      const pierced = chance(Math.min(0.9, eff(w, 'pierce')));
      // 会心の一撃（クリティカルヒット）で受けた致命傷は、踏みとどまりにくい（ENG.critGuts）
      const gutsK = l.critHit ? 1 - ENG.critGuts : 1; l.critHit = false;
      if (!pierced && chance(clamp(eff(l, 'guts') + eff(l, 'luck') * 0.5 + l.bond / 500 + FX.endGuts * sd(l, 'end') + FX.lukGuts * sd(l, 'luk'), 0, 0.85) * gutsK)) {
        l.hp = 5 + rnd() * 10;
        log('battle', sd(l, 'end') >= 0.9 ? `致命の一撃を受けながら、${sn(l)}の頑強な霊基は崩れなかった。` : `致命の一撃を受けながら、${sn(l)}は踏みとどまった。`, [l.id, w.id]);
        return 'guts';
      }
      if (SG) { const r = yield* SG.hooks.seal(l, w); if (r) return r; }   // 特異点：消滅寸前に令呪で霊基を癒やすか
      else if (l.masterAlive && l.cs > 0) {
        const use = yield* ask(l, 'cs', {
          title: `${sn(l)}が倒れかけている`,
          body: `このままでは${sn(l)}は消滅する。令呪は残り${l.cs}画。`,
          options: [
            { k: 'escape', label: '令呪で退かせる', sub: '戦場から離脱させる' },
            { k: 'rally', label: '令呪で奮い立たせる', sub: '霊基をつなぎ止め、戦いを続けさせる' },
            { k: 'none', label: '令呪は使わない', sub: '残りの令呪を温存する' },
          ],
        }, () => chance(ENG.csEmergency + perv(l, 'cs')) ? 'escape' : 'none');
        if (use !== 'none') {
          l.cs--;
          // 抗うスキルは絆で和らぎ、マスターの心の強さは別に効く（心が弱いと、抗うスキルが無くても揺らぐ）
          const resist = clamp(Math.max(0, eff(l, 'cs_resist') - l.bond / 300) - FX.mMindSeal * md(l, 'mind'), 0, 0.9);
          if (chance(resist)) { log('cs', eff(l, 'cs_resist') > 0 ? `${mn(l)}が令呪を切ったが、${sn(l)}には届かなかった。（残り${l.cs}画）` : `${mn(l)}の令呪は、揺らぐ心のままに光を失った。（残り${l.cs}画）`, [l.id, w.id]); }
          else if (use === 'escape') { l.hp = 5; log('cs', `「令呪をもって命ずる——退け！」${mn(l)}の令呪が輝き、${sn(l)}は戦場から消えた。（残り${l.cs}画）`, [l.id, w.id], { big: true }); return 'escaped'; }
          else { const mind = 1 + FX.mMindCs * md(l, 'mind'); l.hp = Math.round(30 * mind); l.temp.push({ id: 'power', mag: 0.3 * mind, params: null }); bondUp(l, 5); log('cs', `「令呪をもって命ずる——立て、${sn(l)}！」砕けかけた霊基に、令呪の魔力が満ちる。（残り${l.cs}画）`, [l.id, w.id], { big: true }); return 'rallied'; }
        }
      }
      // 決め手：この打ち合いで宝具を使っていれば宝具、同じ戦いの前の打ち合いで使っていれば「宝具で追い詰めた」
      const ln = w.lastNP;
      const fin = cause === 'mutual' ? { how: 'mutual' } : ln && ln.round === round ? { how: 'np', np: ln.name } : ln ? { how: 'np-earlier', np: ln.name } : { how: cause === 'instakill' ? 'instakill' : 'blow' };
      if (cause === 'mutual') lastMutual = day;
      servantDown(l, `${day}日目の${phase === 'day' ? '昼' : '夜'}、${nm(w)}${cause === 'mutual' ? 'と相討ちになった' : fin.how === 'np' ? 'の宝具『' + ln.name + '』に倒れた' : cause === 'instakill' ? 'の即死の一撃に倒れた' : 'との戦いに敗れた'}`, w, fin);
      return 'dead';
    }

    // ---------- 宝具 ----------
    function useNP(c, o, round, ctx) {
      if (!c.masterAlive && c.mana < 5) return;
      if (c.ail && (c.ail.stun || c.ail.seal)) return;   // スタンした打ち合い・宝具を封じられた戦いでは使えない
      // 制御の利かない英霊は、魔力が足りなくても宝具を放つ（足りない分はマスターの生命力から）
      const wild = wildOf(c);
      const nps = (c.sv.nps || []).filter(n => !n.disabled && !n.mode && (c.mana >= npCostOf(c, n) || (wild && !c.overUsed)));   // 常時発動・自動で発動する宝具は AI が選ばない   // 魔力を顧みない宝具は1回の戦いに一度まで
      if (!nps.length) return;
      const losing = power(c, o, ctx) < power(o, c, ctx);
      let p = 0.1 + (c.hp < 50 ? 0.25 : 0) + (round >= 2 ? 0.1 : 0) + (isBerserk(c) ? 0.15 : 0) + (losing ? 0.2 : 0) + (day > ENG.maxDays - ENG.finaleDays ? 0.2 : 0);
      if (c.stance === 'all') p += 0.35; else if (c.stance === 'careful') p -= 0.05; else if (c.stance === 'retreat') p -= 0.1;
      p += perv(c, 'np') + eff(c, 'np_charge', ctx.terrain);   // 宝具チャージ
      if (!chance(p)) return;
      // どの宝具を使うか：威力だけで決めず、状況で重みを付けて選ぶ（複数の宝具を使い分ける）
      //   劣勢・瀕死・終盤 → 最大火力を優先 / 相手が弱っている・魔力が心もとない → 軽い宝具で足りる
      //   真名を知られていなければ、正体が露見しやすい宝具は控えめ / 自滅する宝具は追い詰められたときだけ
      const fx = npFx;
      const desperate = c.hp < 25, pressed = losing || c.hp < 40 || day > ENG.maxDays - ENG.finaleDays;
      const atkAll = nps.filter(n => n.attackResolved);
      const maxP = Math.max(1, ...atkAll.map(n => n.power)), minCost = Math.min(...nps.map(n => n.cost));
      const hidden = !o.knowName.has(c.id);
      const weight = n => {
        const retire = E.npRetire(n);
        if (retire >= 0.5 && !desperate) return 0;
        let w;
        if (n.attackResolved) {
          const rel = n.power / maxP;
          w = pressed ? Math.pow(rel, 3) * 1.4 : o.hp < 35 ? 0.6 + (1 - rel) : 0.35 + rel * 0.65;
          if (c.mana - npCostOf(c, n) < c.manaMax * 0.25 && n.cost > minCost && !pressed) w *= 0.5;  // 魔力を使い切りたくない
        } else {
          if (c.usedSup.has(n.name) || !(n.effects || []).some(e => ['battle', 'damage', 'lethal', 'retreat'].includes(e.phase))) return 0;
          w = losing ? 0.7 : 0.45;
        }
        if (hidden && !pressed) w *= 1 - Math.min(0.6, (n.exposure || 0) * 0.4);
        if (retire > 0 && retire < 0.5) w *= 1 - retire;
        if (fx(n, 'backfire') > 0 && !pressed) w *= 0.6;
        if (retire >= 0.5) w *= 0.3;   // 追い詰められても、使うのはまれ
        return Math.max(0, w);
      };
      const ws = {}; nps.forEach((n, i) => { const w = weight(n); if (w > 0) ws[i] = w; });
      if (!Object.keys(ws).length) return;
      fireNP(c, o, nps[+wpick(ws)], round, ctx);
    }
    // 宝具の効果の強さ（その宝具が持つ id の効果の合計）
    const npFx = (n, id) => (n.effects || []).filter(e => e.id === id).reduce((t, e) => t + e.mag, 0);
    // 選んだ宝具を放つ（魔力の支払い・宝具の威力・使ったときの効果・真名の露見・記録・反動）
    function fireNP(c, o, np, round, ctx, costMul) {
      const fx = npFx, cost = npCostOf(c, np) * (costMul || 1);
      const over = c.mana < cost;
      c.mana -= cost; c.npUses++;
      // 宝具強化：常時の効果（と、先に使った補助宝具の効果）＋この宝具自身の効果
      if (np.attackResolved) { c.npBoost = np.power * ENG.npPowerK * B.npStatMult(c.sv) * (1 + eff(c, 'np_boost') + fx(np, 'np_boost')) * (np.burst > 1 ? 1 + (np.burst - 1) * rnd() * 0.5 : 1); c.lastNP = { name: np.name, round }; if (SG) c.lastNP.aoe = SG.aoeOf(c, np); }
      else c.usedSup.add(np.name);
      // 宝具を使ったその戦いの間だけ働く効果（昼・偵察などの効果は持っているだけで常に働くので、ここでは足さない）
      for (const e of np.effects || []) if (E.npOnUse(e) && !['np_cost', 'self_retire', 'backfire', 'disabled', 'np_charge'].includes(e.id) && (e.id !== 'np_boost' || !np.attackResolved)
        && !(e.params && e.params.on) && !E.INSTANT.includes(e.id) && !offMatch(c, e.from || np.name, e.id)
        && (!e.params || e.params.chance == null || e.params.chance >= 1 || chance(e.params.chance))) c.temp.push(e);   // 発動確率のある効果は、使ったときに判定
      // 回復・吸収・解除など、その場で働く効果（発動のしかたの無いもの）は使ったときに働かせ、
      // 発動のしかたのある効果は、この戦いの残りでその場面のたびに発動する（c.armed）
      (np.effects || []).forEach((e, i) => {
        const p = e.params || {};
        if (p.on) { const k = 'np:' + np.name + ':' + i; if (c.armed && !c.armed.some(a => a.k === k)) c.armed.push({ k, on: p.on, id: e.id, mag: e.mag, params: p, from: np.name }); }
        else if (E.INSTANT.includes(e.id) && (p.chance == null || p.chance >= 1 || chance(Math.max(0, p.chance)))) applyTrig(c, o, 'np:' + np.name + ':' + i, e.id, e.mag, p, np.name, 'np', ctx.terrain);
      });
      if (chance(0.3 + np.exposure * 0.7)) o.knowName.add(c.id); else clue(o, c, 2);
      if (np.exposure >= 1) pubName.add(c.id);
      if (np.exposure >= 0.8) witnessed.push(c.id);
      log('np', `${nm(c)}が宝具を解放した——『${np.name}』${np.reading ? '（' + np.reading + '）' : ''}！`, [c.id, o.id], { quote: sayNP(c, np), big: true });
      fireTrig(c, o, 'np', ctx.terrain);   // 宝具を使ったときに発動するスキル
      if (over) { c.overUsed = true; // 魔力を肩代わりする主がいない（はぐれ）か、特異点で蓄えを英霊の霊基が肩代わりするときは、自分自身の霊基を削る文面にする
        log('battle', SG || !c.masterAlive ? `${sn(c)}は残りの魔力も顧みずに宝具を放った——足りない分を賄うように、自らの霊基が削り取られていく。` : `${sn(c)}は残りの魔力も顧みずに宝具を放った——${mn(c)}の体から、生命力が引きずり出されていく。`, [c.id, o.id]); drain(c); }
      const bf = (np.effects || []).filter(e => e.id === 'backfire' && condOk(c, e.params, ctx.terrain)).reduce((t, e) => t + e.mag, 0) + skillFx(c, 'backfire', ctx.terrain);   // スキルの反動も
      if (bf > 0) { c.hp -= bf * 40; log('battle', `反動が${sn(c)}自身を蝕む。`, [c.id]); }
      const sr = (np.effects || []).find(e => e.id === 'self_retire');
      if (sr && chance(E.retireP(sr))) c.pendingRetire = np.name;
    }

    // 自動で発動する宝具（effects.js の NP_MODES）：その場面になった瞬間に、AI の判断を待たずに発動する（1回の戦いに一度）。
    //   魔力消費は宝具の魔力消費 × ENGINE.npAutoCost。払えなければ発動しない（制御の利かない英霊は、1回だけ生命力から払える）。
    //   攻撃宝具は威力が次の打ち合いに乗るように、次の打ち合いの頭で放つ（c.autoQ）。補助宝具はその場で効果が働く。
    //   自動で発動する宝具を持たない英霊では何もしない（乱数も使わない）
    const AUTO_LINE = { start: '戦いの気配に応じて', win: '押し勝った勢いのまま', lose: '押し込まれた瞬間', pinch: '霊基が砕けかけたその時', lethal: '致命の一撃を受けたその瞬間' };
    function autoNP(c, o, ev, ctx, round) {
      if (!c.alive || !c.autoUsed) return false;
      let fired = false;
      for (const np of c.sv.nps || []) {
        if (np.mode !== ev || np.disabled || c.autoUsed.has(np.name)) continue;
        if (c.ail && c.ail.seal) continue;
        if (!(c.mana >= npCostOf(c, np) * ENG.npAutoCost || (wildOf(c) && !c.overUsed))) continue;
        c.autoUsed.add(np.name);
        if (np.attackResolved && ev !== 'lethal') { c.autoQ.push({ np, ev }); continue; }   // 記録は放つときに
        log('battle', `${AUTO_LINE[ev] || ''}、${sn(c)}の宝具『${np.name}』がひとりでに目を覚ました。`, [c.id].concat(o ? [o.id] : []));
        fireNP(c, o, np, round || 1, ctx, ENG.npAutoCost); fired = true;
      }
      return fired;
    }

    // 戦いの始めに切れる先手の宝具：{ np, ini（その宝具の先手の強さ） } または null
    //   使える宝具（封じられていない・魔力が足りる／魔力を顧みない英霊・自滅する宝具でない）のうち、先手のいちばん強いもの
    //   先手の付いた宝具を持たない英霊では何もしない（乱数も引かない）
    function openingNP(c, terrain) {
      if (c.stance === 'retreat' || (!c.masterAlive && c.mana < 5)) return null;
      const wild = wildOf(c);
      let best = null;
      for (const n of c.sv.nps || []) {
        if (n.disabled || n.mode || E.npRetire(n) >= 0.5) continue;
        let ini = 0;
        for (const e of n.effects || []) if (e.id === 'initiative' && condOk(c, e.params, terrain)) ini += e.mag * dm(e.params) * (e.params && e.params.chance != null ? clamp(e.params.chance, 0, 1) : 1);
        if (ini <= 0 || !(c.mana >= npCostOf(c, n) || wild)) continue;
        if (!best || ini > best.ini) best = { np: n, ini };
      }
      return best;
    }

    // ---------- 戦闘 ----------
    let witnessed = [];
    // ctx.helpA / ctx.helpB：同盟相手の加勢（a・b の味方として並んで戦う）。聖杯戦争では一騎まで、特異点では前衛の仲間など数騎の配列
    function* battle(a, b, ctx) {
      const helpers0 = [].concat(ctx.helpA || [], ctx.helpB || []);
      const help = new Map([[a, [].concat(ctx.helpA || [])], [b, [].concat(ctx.helpB || [])]]);
      const side = x => [x].concat(help.get(x));
      const all = () => side(a).concat(side(b));
      for (const c of all()) {
        c.fought = true; c.battles++; c.temp = (c.dayTemp || []).concat(c.carry || []); c.carry = null; c.usedSup = new Set(); c.lastNP = null; c.npBoost = 0; c.overUsed = false; c.ail = {}; c.openNP = null;
        c.tUsed = {}; c.tLog = new Set(); c.armed = []; c.pinched = false; c.cleanse = 0; c.off = null;   // 発動する効果（fireTrig）の、この戦いの分
        c.autoUsed = new Set(); c.autoQ = [];   // 自動で発動する宝具（autoNP）の、この戦いの分
      }
      const opp = x => (side(a).includes(x) ? b : a);
      const LK = k => (ctx.lines && ctx.lines[k]) || k;   // 文面の差し替え（特異点の昼の戦いなど。聖杯戦争では使わない）
      // 瀕死になったときに発動する効果（1回の戦いに一度）
      const pinch = () => { for (const x of all()) if (x.alive && !x.pinched && x.hp > 0 && x.hp < ENG.pinchAt) { x.pinched = true; fireTrig(x, opp(x), 'pinch', ctx.terrain); autoNP(x, opp(x), 'pinch', ctx); } };
      for (const x of side(a)) enterBattle(x, b, ctx.home === x);
      for (const x of side(b)) enterBattle(x, a, ctx.home === x);
      for (const x of all()) x.bx.ctx = ctx;   // 致命傷の瞬間に自動で発動する宝具（lethal）が、戦いの場所を引けるように
      // 並んで戦う味方どうしの効果：味方にも効く効果（params.team）と統率（rally）を、その戦いの間だけ分け合う（乱数は使わない）。
      //   加勢がいない一騎どうしの戦いでは何も起きない
      for (const s of [side(a), side(b)]) if (s.length > 1) for (const x of s) for (const y of s) if (x !== y) shareTeam(y, x);
      const where = ctx.home ? `${mn(ctx.home)}の拠点「${ctx.place.name}」` : ctx.place.name;
      log('battle', line(LK('clash'), { where: (ctx.rain ? '雨の' : '') + where, A: nm(a), B: nm(b) }), [a.id, b.id], { quote: say(a, ['開始']), head: true, place: ctx.place.name, scene: ctx.place.scene });
      clue(a, b, 1); clue(b, a, 1);
      for (const [x, o] of [[a, b], [b, a]]) for (const y of help.get(x)) {
        y.stance = 'careful'; clue(y, o, 1); clue(o, y, 1); y.knowName.add(x.id);
        if (!SG) log('ally', `同盟を結ぶ${nm(y)}が加勢に現れた。${sn(x)}と${sn(y)}、二騎がかりで${sn(o)}に挑む。`, [y.id, x.id, o.id], { big: true });
      }
      if (SG) SG.hooks.lineup(a, b, help.get(a), help.get(b));
      const rt = related(a, b);
      if (rt) {
        a.knowName.add(b.id); b.knowName.add(a.id);
        const who = rel[a.id] && rel[a.id][b.id] ? a : b, other = who === a ? b : a;
        log('event', `因縁の再会だった。${nm(who)}は${nm(other)}をよく知っている——「${rt}」`, [a.id, b.id], { big: true });
      }
      // 戦い方：プレイヤーは方針から、他の陣営は戦略から決まる
      for (const c of [a, b]) {
        const F = focusOf(c);
        c.stance = F && F.stance ? F.stance : c.hp < 25 && chance(0.5) ? 'retreat' : wpick({ all: c.policy === 'aggressive' ? 2.5 : 1.5, careful: c.policy === 'defensive' ? 1.5 : 1 });
        if (c.stance === 'retreat' && c.hp > 60 && !c.you) c.stance = 'careful';
      }
      // 戦いのための魔力（霊基を全力で動かす分。燃費の悪い英霊ほど重い）
      for (const c of all()) if (c.masterAlive) { c.mana -= ENG.battleMana * upk(c); drain(c); }
      // 用意していた道具 / 先手
      for (const [c, o] of [[a, b], [b, a]]) {
        if (c.items > 0) { c.items--; c.temp.push({ id: 'guard', mag: 0.2, params: null }, { id: 'power', mag: 0.05, params: null }); if (c.you || o.you) log('battle', `${sn(c)}は用意していた道具で身を固めた。`, [c.id, o.id]); }
        // 先手の付いた宝具は、戦いの始めに切れる（いちばん先手の強い1つ。魔力が足りること、退く戦い方でないこと）
        const op = openingNP(c, ctx.terrain);
        const ini = Math.min(0.5, eff(c, 'initiative', ctx.terrain) + (op ? op.ini : 0));
        if (ini > 0 && chance(ini)) {
          c.surprise = (c.surprise || 0) + 0.08;
          if (op) { c.openNP = op.np; log('battle', `${sn(c)}が宝具『${op.np.name}』で先手を取った。`, [c.id, o.id]); }
          else log('battle', `${sn(c)}が先手を取った。`, [c.id, o.id]);
        }
      }
      // 戦いの始めに発動する効果
      for (const x of all()) fireTrig(x, opp(x), 'start', ctx.terrain);
      for (const x of all()) autoNP(x, opp(x), 'start', ctx);   // 戦いの始めに自動で発動する宝具
      // 加勢の力：味方の戦闘力（傷の具合）＋宝具の一部。統率が連携を強める
      const assist = (x, o) => {
        let t = 0;
        for (const y of help.get(x)) {
          if (!y.alive) continue;
          const T = ctx.terrain;
          t += (B.combatPower(y.sv, T, id => effS(y, id, T)) * (0.55 + 0.45 * Math.max(0, y.hp) / 100) + y.npBoost) * ENG.allyAssist * (y.assistK != null ? y.assistK : 1) * (1 + Math.max(-0.5, eff(x, 'rally', T) + eff(y, 'rally', T)));
        }
        return t;
      };
      const leave = (y, text) => { for (const [x, h] of help) if (h.includes(y)) help.set(x, h.filter(z => z !== y)); y.stance = null; y.temp = []; y.npBoost = 0; y.lastNP = null; y.bx = null; y.ail = null; y.armed = null; y.off = null; y.cleanse = 0; y.tUsed = null; y.tLog = null; y.autoUsed = null; y.autoQ = null; if (text) log('battle', text, [y.id]); };
      for (let round = 1; round <= ENG.rounds; round++) {
        for (const c of all()) { c.npBoost = 0; if (c.temp.some(e => e.rnd)) c.temp = c.temp.filter(e => !e.rnd); }   // 打ち合いのたびの効果はその打ち合いだけ
        // バーサーカーは、打ち合いのたびに魔力を食う
        for (const c of all()) if (c.alive && c.masterAlive && isBerserk(c)) { c.mana -= ENG.wildMana * upk(c); drain(c); }
        // 退く戦い方なら最初に離脱を試みる
        for (const [c, o] of [[a, b], [b, a]]) if (c.stance === 'retreat' && round === 1 && chance(clamp(ENG.retreatBase + 0.25 + eff(c, 'escape', ctx.terrain) + eff(c, 'luck') * 0.3 - eff(o, 'pin', ctx.terrain) * 0.8 + c.bond / 500 + FX.agiRetreat * (sd(c, 'agi') - sd(o, 'agi')), 0.05, 0.9))) {
          log('battle', `${sn(c)}は刃を交えずに退いた。`, [c.id, o.id]); cleanup(); return;
        }
        // 状態異常：毒は打ち合いのたびに霊基を削る（毒では倒れない）。スタン・混乱はこの打ち合いの始めに判定する
        for (const c of all()) { c.ail.stun = c.ail.confuse = c.ail.stunFix = c.ail.confuseFix = false; }
        for (const c of [a, b]) if (c.poison && c.alive) {
          c.hp = Math.max(1, c.hp - ENG.poisonTick);
          if (!c.ail.ticked) { c.ail.ticked = true; log('battle', ailText('ailPoisonTick', 'poison', c.poison.p, null, c), [c.id]); }
        }
        // 打ち合いのたびに発動する効果（魔力を払えるかぎり毎回、など）と、瀕死になったときの効果
        for (const x of all()) if (x.alive) fireTrig(x, opp(x), 'round', ctx.terrain);
        pinch();
        for (const [x, y] of [[a, b], [b, a]]) for (const id of ['stun', 'confuse']) {
          const p = tryAil(x, y, id, ctx.terrain);
          if (p) { y.ail[id] = true; y.ail[id + 'P'] = p; log('battle', ailText(AIL_KEY[id], id, p, x, y), [y.id, x.id]); }
        }
        // 自分に掛かる状態異常（デメリット）：打ち合いのたびに判定する。防げない（持っていない英霊では乱数を使わない）
        for (const y of [a, b]) for (const id of SELF_AIL) {
          if (id === 'poison' ? y.poison : y.ail[id]) continue;
          const si = ailInfo(y, id, ctx.terrain, true);
          if (!(si.t > 0) || !chance(Math.min(E.AIL_CAP[id], si.t))) continue;
          const sp = si.p || {};
          if (id === 'poison') y.poison = { p: sp, day, fix: !!sp.nocure }; else { y.ail[id] = true; y.ail[id + 'P'] = sp; y.ail[id + 'Fix'] = !!sp.nocure; }
          log('battle', sp.msg ? fillT(sp.msg, { S: sn(y), O: sn(y), N: sp.name || E.AILMENTS[id] }) : fillT(SELF_AIL_LINE[id], { O: sn(y), N: sp.name || E.AILMENTS[id] }), [y.id]);
        }
        // 開幕の宝具：先手を取った宝具は、1回目の打ち合いの頭で放つ（その打ち合いでは、ほかの宝具は使わない）
        const opened = new Set();
        for (const [c, o] of [[a, b], [b, a]]) if (c.openNP) {
          const np = c.openNP; c.openNP = null;
          if (c.alive && !(c.ail.stun || c.ail.seal) && (c.mana >= npCostOf(c, np) || (wildOf(c) && !c.overUsed))) { fireNP(c, o, np, round, ctx); opened.add(c); }
        }
        // 自動で発動した攻撃宝具：この打ち合いの頭で放つ（その打ち合いでは、ほかの宝具は使わない）
        for (const c of all()) if (c.autoQ && c.autoQ.length) {
          const q = c.autoQ; c.autoQ = [];
          for (const { np, ev } of q) if (c.alive && !c.ail.seal && (c.mana >= npCostOf(c, np) * ENG.npAutoCost || (wildOf(c) && !c.overUsed))) {
            log('battle', `${AUTO_LINE[ev] || ''}、${sn(c)}の宝具『${np.name}』がひとりでに目を覚ました。`, [c.id, opp(c).id]);
            fireNP(c, opp(c), np, round, ctx, ENG.npAutoCost); opened.add(c);
          }
        }
        if (!opened.has(a)) useNP(a, b, round, ctx);
        if (!opened.has(b)) useNP(b, a, round, ctx);
        for (const [x, o] of [[a, b], [b, a]]) for (const y of help.get(x)) if (y.alive && !opened.has(y)) useNP(y, o, round, ctx);
        for (const c of all()) if (c.pendingRetire) {
          const n = c.pendingRetire; c.pendingRetire = null; servantDown(c, `宝具『${n}』の代償で脱落した`);
          if (c === a || c === b) { cleanup(); return; } else leave(c);
        }
        let ea = power(a, b, ctx) + assist(a, b), eb = power(b, a, ctx) + assist(b, a);
        // スタン・混乱：その打ち合いの戦闘力が下がる。混乱は自分を傷つけることもある（これでは倒れない）
        for (const y of [a, b]) {
          let f = 1;
          if (y.ail.stun) f *= ENG.stunPower;
          if (y.ail.confuse) {
            f *= ENG.confusePower;
            if (chance(ENG.confuseSelf)) { y.hp = Math.max(1, y.hp - ENG.confuseSelfDmg); log('battle', ailText('ailConfuseSelf', 'confuse', y.ail.confuseP, null, y), [y.id]); }
          }
          if (y === a) ea *= f; else eb *= f;
        }
        // 魅了：マスターの精神が強いと、呼びかけで正気を取り戻しやすい
        for (const [x, y] of [[a, b], [b, a]]) {
          const ci = ailInfo(x, 'charm', ctx.terrain);
          if (!chance(ci.t)) continue;
          if (!chance(clamp(eff(y, 'mental_guard', ctx.terrain) + eff(y, 'ail_guard', ctx.terrain) + FX.mMindCharm * md(y, 'mind'), 0, 0.95))) { if (y === b) eb *= 0.6; else ea *= 0.6; log('battle', ailText('ailCharm', 'charm', ci.p, x, y), [x.id, y.id]); }
          else if (md(y, 'mind') >= 0.45 && !eff(y, 'mental_guard', ctx.terrain)) log('battle', `${(ci.p && ci.p.name) || '魅了'}に呑まれかけた${sn(y)}を、${mn(y)}の呼びかけが引き戻した。`, [y.id, x.id]);
        }
        const p = 1 / (1 + Math.exp(-(ea - eb) / G.CONFIG.BATTLE_K));
        const [w, l, ew, el] = chance(p) ? [a, b, ea, eb] : [b, a, eb, ea];
        // 負けた側に加勢がいれば、その一撃を味方が受けることもある
        // かばうのは、加勢のうちいちばん前に出たがる者（かばうスキル→霊基の残り。乱数は使わない）
        const lhs = help.get(l).filter(y => y.alive);
        const lh = lhs.length > 1 ? lhs.reduce((p, q) => (eff(q, 'taunt', ctx.terrain) + q.hp / 1000 > eff(p, 'taunt', ctx.terrain) + p.hp / 1000 ? q : p)) : lhs[0] || null;
        const cover = lh && chance(clamp(ENG.allyCover + eff(lh, 'taunt', ctx.terrain), 0, 0.9));   // かばう（taunt）
        const tg = cover ? lh : l;
        if (cover) log('battle', `${sn(lh)}が${sn(l)}をかばって前に出た。`, [lh.id, l.id, w.id]);
        let outcome = null, o3 = null;
        // 攻撃を受ける直前に発動する効果（ここで得た守り・見切りはこの一撃から効く）と、見切り（一撃をかわす。必中で減る）
        if (tg.alive) fireTrig(tg, w, 'hit', ctx.terrain);
        const dg = eff(tg, 'dodge', ctx.terrain);
        const dodged = dg > 0 && chance(Math.min(ENG.dodgeCap, dg) * (1 - clamp(eff(w, 'sure_hit', ctx.terrain), 0, 1)));
        if (dodged) log('battle', `${sn(w)}が押し込んだ一撃を、${sn(tg)}は紙一重で見切った。`, [tg.id, w.id]);
        else if (chance(Math.min(0.4, eff(w, 'instakill', ctx.terrain)) * Math.max(0, 1 - FX.lukInstakill * sd(tg, 'luk')) * (1 - clamp(eff(tg, 'luck'), -0.5, 0.9)))) {
          log('battle', `${sn(w)}の一撃が、${sn(tg)}の霊核を捉えた。`, [w.id, tg.id]);
          tg.hp = 0; o3 = yield* lethal(tg, w, 'instakill', round);
        } else {
          let dmg = (ENG.dmgBase + rnd() * ENG.dmgVar) * (1 + clamp((ew - el) / (ew + el + 1), -0.3, 0.6));
          // 筋力の高い側ほど深く斬り込み、耐久の高い側ほど持ちこたえる
          dmg *= clamp(1 + FX.str * sd(w, 'str') - FX.end * sd(tg, 'end'), 0.6, 1.5);
          const crit = chance(Math.max(0, eff(w, 'crit', ctx.terrain) + FX.lukCrit * sd(w, 'luk')));
          if (crit) { dmg *= ENG.critMult; tg.critHit = true; }
          if (!chance(eff(w, 'pierce', ctx.terrain))) dmg *= 1 - clamp(B.softDef(eff(tg, 'guard', ctx.terrain)) * ENG.guardDmgW, -0.5, ENG.guardDmgCap);
          const flat = eff(w, 'dmg_plus', ctx.terrain) - eff(tg, 'dmg_cut', ctx.terrain);   // ダメージプラス・ダメージカット（固定値）
          if (flat) dmg = Math.max(1, dmg + flat);
          // 負けた側も一矢報いる：戦闘力が拮抗しているほど返す傷は大きい（rnd は増やさない）
          tg.hp -= dmg; w.hp -= rnd() * 8 + dmg * ENG.counterDmg * (el / (ew + 1));
          // 反撃：傷を受けても立っていれば、その傷の一部を返す
          const ctr = tg.hp > 0 ? eff(tg, 'counter', ctx.terrain) : 0;
          if (ctr > 0) { w.hp -= dmg * Math.min(1, ctr); if (tg.tLog && !tg.tLog.has('#counter')) { tg.tLog.add('#counter'); log('battle', `${sn(tg)}は退かず、すかさず反撃を返した。`, [tg.id, w.id]); } }
          log('battle', `${round === 1 ? '' : round === ENG.rounds ? '最後の打ち合い。' : '再び刃が交わる。'}${crit ? 'クリティカルヒット。' : ''}${sn(w)}が押し勝ち、${sn(tg)}は${dmg > 32 ? '深手を負った' : '傷を負った'}。`, [w.id, tg.id]);
          if (tg.hp <= 0) o3 = yield* lethal(tg, w, 'battle', round);
          tg.critHit = false;
          // 特異点：全体攻撃の宝具で押し勝った打ち合いでは、傷が相手の側の全員に広がる（聖杯戦争では起きない）
          if (SG && w.alive && w.lastNP && w.lastNP.round === round && w.lastNP.aoe > 0) {
            const hit = side(l).filter(y => y !== tg && y.alive);
            if (hit.length) log('battle', `宝具の奔流は${sn(tg)}だけでは止まらず、${hit.map(sn).join('・')}をも呑み込んだ。`, [w.id].concat(hit.map(y => y.id)));
            for (const y of hit) {
              y.hp -= dmg * w.lastNP.aoe;
              if (y.hp > 0) continue;
              const r = yield* lethal(y, w, 'battle', round);
              if (y !== l && (r === 'dead' || r === 'escaped')) leave(y);
            }
          }
          // 押し勝った側も深手で倒れることがある（相手を討ち取った打ち合いなら相討ち）
          if (w.hp <= 0 && w.alive) { const o2 = yield* lethal(w, tg, o3 === 'dead' ? 'mutual' : 'battle', round); if (o2 !== 'guts' && o2 !== 'rallied') outcome = o2; }
        }
        // 押し勝った一撃に乗る状態異常：毒（翌日まで残る）・宝具封印（この戦いの間）
        if (tg.alive && w.alive && o3 !== 'escaped' && tg.ail && !dodged) {
          if (!tg.poison) { const p = tryAil(w, tg, 'poison', ctx.terrain); if (p) { tg.poison = { p, day }; log('battle', ailText('ailPoison', 'poison', p, w, tg), [tg.id, w.id]); } }
          if (!tg.ail.seal) { const p = tryAil(w, tg, 'seal', ctx.terrain); if (p) { tg.ail.seal = true; log('battle', ailText('ailSeal', 'seal', p, w, tg), [tg.id, w.id]); } }
        }
        // 押し勝ったとき・押し負けたとき・相手を倒したときに発動する効果、瀕死になったときの効果
        if (w.alive && tg.alive && o3 !== 'escaped') { fireTrig(w, tg, 'win', ctx.terrain); fireTrig(tg, w, 'lose', ctx.terrain); autoNP(w, tg, 'win', ctx, round); autoNP(tg, w, 'lose', ctx, round); }
        if (o3 === 'dead' && w.alive) fireTrig(w, tg, 'kill', ctx.terrain);
        if (w.alive && (tg.alive || w.alive)) pinch();
        if (cover) { if (o3 === 'dead' || o3 === 'escaped') leave(lh); else if (lh.alive && lh.hp < 25) leave(lh, `深手を負った${sn(lh)}は、戦いの場を離れた。`); }
        else outcome = outcome || o3;
        if (outcome === 'dead' || outcome === 'escaped' || !a.alive || !b.alive) break;
        // まれに、勝った側の刃が相手のマスターに届く（気配を断てるサーヴァントや暗殺を好むマスターほど起きやすい）
        if (l.masterAlive && w.alive && !l.noMaster) {   // noMaster：特異点の敵（聖杯が呼んだ英霊）には狙えるマスターがいない
          const pm = (ENG.masterStrike + eff(w, 'anti_master') * 0.3 + Math.max(0, perv(w, 'ambush')) * 0.03) * (1 - clamp(eff(l, 'master_guard') + (ctx.home === l ? l.workshop * 0.04 : 0) + FX.mLuckHide * md(l, 'luck'), 0, 0.8));
          if (chance(Math.min(0.15, pm))) {
            l.mhp -= 30 + rnd() * 50 - l.master.stats.body * 0.3;
            if (l.mhp <= 0) {
              if (!SG && l.cs > 0 && chance(clamp(ENG.csSaveMaster + FX.mMindSeal * md(l, 'mind'), 0, 0.95))) { l.cs--; l.mhp = 6; log('cs', `${sn(w)}の刃がマスターの${mn(l)}に迫る——令呪の光が、すんでのところで${mn(l)}を守った。（残り${l.cs}画）`, [l.id, w.id], { big: true }); }
              else { log('battle', `乱戦の中、${sn(w)}の刃がマスターの${mn(l)}に届いた。`, [w.id, l.id], { big: true }); masterDown(l, `${day}日目の${phase === 'day' ? '昼' : '夜'}、${nm(w)}との戦いの最中だった`, w); break; }
            } else log('battle', `${sn(w)}の一撃がマスターの${mn(l)}をかすめた。${mn(l)}は深手を負った。`, [w.id, l.id]);
          }
        }
        // 撤退（加勢がいれば一緒に退く）
        const weaker = a.hp < b.hp ? a : b, other = weaker === a ? b : a;
        const threshold = (weaker.stance === 'careful' ? ENG.retreatAt + 10 : weaker.stance === 'all' ? ENG.retreatAt - 15 : ENG.retreatAt) + perv(weaker, 'retreat') * 30;
        if (weaker.hp < threshold || (weaker === l && p < 0.3 && weaker.hp < 60) || weaker.stance === 'retreat') {
          const ctrl = isBerserk(weaker) && chance(0.5) ? -0.2 : 0;
          const agi = sd(weaker, 'agi') - sd(other, 'agi');
          if (chance(clamp(ENG.retreatBase + eff(weaker, 'escape', ctx.terrain) + eff(weaker, 'luck') * 0.3 - eff(other, 'pin', ctx.terrain) * 0.8 + ctrl + weaker.bond / 500 + (weaker.stance === 'careful' ? 0.1 : 0) + perv(weaker, 'retreat') * 0.5 + FX.agiRetreat * agi, 0.05, 0.9))) {
            log('battle', agi >= 0.6 ? `${sn(weaker)}は持ち前の速さで${sn(other)}を振り切った。` : line(LK('retreat'), { W: sn(weaker), O: sn(other) }), [weaker.id, other.id]); break;
          } else if (eff(other, 'pin', ctx.terrain) > 0.1) log('battle', `退こうとした${sn(weaker)}の行く手を、${sn(other)}が阻んだ。`, [weaker.id, other.id]);
          else if (agi <= -0.6) log('battle', `退こうとした${sn(weaker)}に、${sn(other)}の速さが追いすがった。`, [weaker.id, other.id]);
        }
        if (round === ENG.rounds) log('battle', line(LK('dawn')), [a.id, b.id]);
      }
      if (ctx.home) a.knowLoc.add(ctx.home.id);
      // 戦いぶりから、相手のマスターの性格が見えてくる
      for (const [x, y] of [[a, b], [b, a]]) if (y.masterAlive && !x.knowPersona.has(y.id) && chance(ENG.personaReveal)) {
        x.knowPersona.add(y.id);
        if (x.you && PER(y).reveal) log('scout', PER(y).reveal.replace('{m}', mn(y)), [x.id, y.id]);
      }
      for (const [x, y] of [[a, b], [b, a]]) if (x.alive && y.alive && chance(0.1 + eff(x, 'reveal') - eff(y, 'conceal') * 0.6)) {
        if (!x.knowName.has(y.id)) { x.knowName.add(y.id); if (x.you) log('scout', `剣を交えるうちに、${y.label}の真名に思い至った——「${y.sv.trueName}」。`, [x.id, y.id]); }
      }
      cleanup();
      function cleanup() { for (const c of [a, b].concat(helpers0)) if (c) { c.temp = []; c.npBoost = 0; c.stance = null; c.surprise = 0; c.lastNP = null; c.bx = null; c.ail = null; c.openNP = null; c.armed = null; c.off = null; c.cleanse = 0; c.tUsed = null; c.tLog = null; c.autoUsed = null; c.autoQ = null; } }
    }

    // y の常時の効果のうち、味方にも効くもの（params.team）を x の c.temp へ（強さ×割合）。統率は x の戦闘力を 統率×rallyPower 上げる
    function shareTeam(y, x) {
      for (const [k, e] of Object.entries(y.sv.effectSummary || {})) {
        const p = e.params;
        if (!p || !(p.team > 0) || e.on || !e.passive || isSelf(p) || !E.TEAM_IDS.includes(e.id)) continue;
        const q = Object.assign({}, p); delete q.team;
        x.temp.push({ id: e.id, mag: e.passive * Math.min(1, p.team) * dm(p), params: Object.keys(q).length ? q : null, from: (e.from[0] || '').replace(/\(消滅後も持続\)$/, ''), src: '#team:' + y.id + ':' + k });
      }
      const r = eff(y, 'rally');
      if (r > 0 && ENG.rallyPower) x.temp.push({ id: 'power', mag: r * ENG.rallyPower, params: null, from: '統率', src: '#rally:' + y.id });
    }

    function* ambushMaster(h, t) {
      const guard = eff(t, 'master_guard') + eff(t, 'detect') * 0.5 + t.workshop * 0.06 + FX.mLuckHide * md(t, 'luck');
      if (chance(clamp(guard, 0, 0.85))) { log('battle', `${mn(t)}を狙った刃は、${sn(t)}に阻まれた。`, [h.id, t.id]); return false; }
      t.mhp -= 40 + rnd() * 60 - t.master.stats.body * 0.3;
      if (t.mhp <= 0) {
        if (t.cs > 0 && chance(clamp(ENG.csSaveMaster + FX.mMindSeal * md(t, 'mind'), 0, 0.95))) { t.cs--; t.mhp = 8; log('cs', `瀕死の${mn(t)}が令呪で${sn(t)}を呼び戻した。（残り${t.cs}画）`, [t.id, h.id], { big: true }); return false; }
        masterDown(t, `${nm(h)}の奇襲だった`, h); return true;
      }
      log('battle', `${nm(h)}の奇襲で、${mn(t)}が深手を負った。`, [h.id, t.id]);
      return true;
    }

    // ---------- 日常 ----------
    // プレイヤーの陣営で時々起きる。Wikiの好物・苦手・セリフ・解説を使う
    function* lifeEvent(c) {
      const sv = c.sv, pf = sv.profile || {}, has = k => G.voiceLines(sv, k).length > 0;
      const opt = {};
      if (pf.likes) opt.meal = 3;
      if (has('会話')) opt.talk = 3;
      if (sv.text && sv.text.commentary && c.dreams < 2) opt.dream = c.dreams === 0 ? 3 : 1.5;
      if (pf.dislikes && !c.lifeSeen.has('dislike')) opt.dislike = 1.5;
      if (has('聖杯について') || pf.wish) opt.grail = c.lifeSeen.has('grail') ? 0.3 : 2;
      if (has('好きなこと') || has('嫌いなこと')) opt.likes = 1.5;
      if (c.bond >= 70 && has('絆') && !c.lifeSeen.has('bondv')) opt.bondv = 3;
      opt.outing = 1; opt.master = 1.5;
      opt.train = 1; opt.watch = 1; opt.stars = 0.8; opt.quarrel = 0.5;
      if (sv.text && firstSentence(sv.text.personality, 70) && (c.tales || 0) < 2) opt.tale = 1.2;
      if (c.hp < 70) opt.care = 2;
      const k = wpick(opt); c.lifeSeen.add(k === 'bondv' ? 'bondv' : k);
      const S = sn(c), M = mn(c);
      const V = { S, M, likes: pf.likes, dislikes: pf.dislikes };
      if (k === 'meal') { bondUp(c, 5); c.hp = Math.min(100, c.hp + 5); log('life', line('meal', V), [c.id]); }
      else if (k === 'talk') { bondUp(c, 4); log('life', line('talk', V), [c.id], { quote: say(c, ['会話']) }); }
      else if (k === 'dream') { c.dreams++; bondUp(c, 8); log('life', line('dream', Object.assign({ dream: firstSentence(sv.text.commentary, 70) }, V)), [c.id]); }
      else if (k === 'dislike') { bondUp(c, 1); log('life', line('dislike', V), [c.id]); }
      else if (k === 'grail') { bondUp(c, 3); const q = say(c, ['聖杯について']); log('life', line('grail', V) + (q ? '' : `答えは「${pf.wish}」だった。`), [c.id], { quote: q }); }
      else if (k === 'likes') { bondUp(c, 3); log('life', line('likes', V), [c.id], { quote: say(c, ['好きなこと', '嫌いなこと']) }); }
      else if (k === 'bondv') { bondUp(c, 5); log('life', line('bondv', V), [c.id], { quote: say(c, ['絆']) }); }
      else if (k === 'master') {
        const key = { civilian: 'masterCivilian', noble: 'masterNoble', mercenary: 'masterMercenary', newblood: 'masterNewblood', irregular: 'masterIrregular' }[c.master.origin] || 'masterOther';
        c.mana = Math.min(c.manaMax, c.mana + 5); log('life', line(key, V), [c.id]);
      } else if (k === 'outing') {
        if (chance(0.6)) { bondUp(c, 8); c.wander = true; log('life', line('outing', V), [c.id]); }
        else { bondUp(c, -2); log('life', line('outingNo', V), [c.id]); }
      }
      // 増やした日常
      else if (k === 'train') { bondUp(c, 3); log('life', line('train', V), [c.id]); }
      else if (k === 'tale') { c.tales = (c.tales || 0) + 1; bondUp(c, 4); log('life', line('tale', Object.assign({ tale: firstSentence(sv.text.personality, 70) }, V)), [c.id]); }
      else if (k === 'care') { bondUp(c, 3); c.hp = Math.min(100, c.hp + 8); log('life', line('care', V), [c.id]); }
      else if (k === 'quarrel') { bondUp(c, -3); log('life', line('quarrel', V), [c.id]); }
      else if (k === 'watch') { bondUp(c, 4); log('life', line('watch', V), [c.id]); }
      else if (k === 'stars') { bondUp(c, 4); log('life', line('stars', V), [c.id]); }
    }

    // ---------- 街の出来事 ----------
    function* worldEvent() {
      const alive = active();
      const o = { leyline: 2, rain: 2, moon: 1.5, familiar: 2, festival: 0.8, fog: 1.2, tremor: day >= 3 ? 1 : 0, disturb: 0.8, patrol: day >= 3 ? 0.8 : 0 };
      if (witnessed.length) o.witness = 4;
      const bountyCand = alive.filter(c => !c.bounty && (c.kills.length >= 2 || c.warned >= 2));
      if (day >= 4 && bountyCand.length && !camps.some(c => c.bounty && c.alive)) o.bounty = 3;
      if (you && you.alive && you.masterAlive && alive.length > 2) o.spot = 1.2;
      // 噂：まだ拠点の分からない敵がいれば、その拠点にまつわる噂が流れてくる
      const rumorT = you && you.alive && you.masterAlive ? alive.filter(x => x !== you && !you.knowLoc.has(x.id)) : [];
      if (rumorT.length) o.rumor = 1;
      const k = wpick(o);
      if (k === 'leyline') { for (const c of alive) c.mana = Math.min(c.manaMax, c.mana + 25); log('world', line('leyline', { city }), []); }
      else if (k === 'rain') { tonight.rain = true; log('world', line('rain', { city }), []); }
      else if (k === 'moon') { tonight.moon = true; log('world', line('moon', { city }), []); }
      else if (k === 'festival') { tonight.calm = true; log('world', line('festival', { city }), []); }
      // 霧：今夜は互いを見つけにくい / 鳴動：今夜はどの陣営も出撃しやすい / 霊脈の乱れ：魔力が減る / 巡回：今夜は出撃を控える
      else if (k === 'fog') { tonight.fog = true; log('world', line('fog', { city }), []); }
      else if (k === 'tremor') { tonight.stir = true; log('world', line('tremor', { city }), []); }
      else if (k === 'disturb') { for (const c of alive) c.mana = Math.max(0, c.mana - 15); log('world', line('disturb', { city }), []); }
      else if (k === 'patrol') { tonight.patrol = true; log('world', line('patrol', { city }), []); }
      else if (k === 'rumor') {
        const t = pick(rumorT);
        const a = yield* ask(you, 'event', {
          title: '街の噂',
          body: `「夜中に${t.base.name}のあたりで、妙な光を見た」——そんな噂を耳にした。`,
          options: [{ k: 'chase', label: '噂をたどる', sub: '敵の拠点かもしれない。こちらが見つかる危険もある' }, { k: 'ignore', label: '聞き流す', sub: '関わらない' }],
        }, () => chance(0.5) ? 'chase' : 'ignore');
        if (a === 'chase') {
          if (chance(clamp(0.55 + effO(you, 'intel', t) * 0.5 + FX.mCraftScout * md(you, 'craft') - effO(t, 'stealth', you) * 0.5, 0.1, 0.9))) { you.knowLoc.add(t.id); log('scout', `噂をたどった先は、${t.label}の拠点「${t.base.name}」だった。`, [you.id, t.id]); }
          else if (chance(0.3)) { t.knowLoc.add(you.id); log('event', '噂の場所には何もなかった。帰り道、誰かに見られていた気がする。', [you.id, t.id]); }
          else log('event', '噂は噂にすぎなかった。', [you.id]);
        } else log('event', `${mn(you)}は噂を聞き流した。`, [you.id]);
      }
      else if (k === 'familiar') {
        const a = pick(alive), t = pick(alive.filter(x => x !== a));
        if (t) { a.knowLoc.add(t.id); if (a.you) log('scout', `放っていた使い魔が、${t.label}の拠点「${t.base.name}」を見つけた。`, [a.id, t.id]); else if (t.you) log('world', `拠点の周りを使い魔がうろついていた。どこかの陣営に見つかったかもしれない。`, [t.id]); else log('world', line('familiar'), []); }
      } else if (k === 'witness') {
        const id = pick(witnessed); witnessed = [];
        const c = camps[id];
        if (c && c.alive) { c.warned++; log('world', line('witness', { label: c.label }), [c.id]); }
      } else if (k === 'bounty') {
        const t = pick(bountyCand); t.bounty = true;
        log('world', line('bounty', { name: nm(t) }), [t.id], { big: true });
        if (you && you.alive && you !== t) {
          const a = yield* ask(you, 'event', {
            title: `${t.label}への討伐令`,
            body: '討伐に加われば追加の令呪を狙えるが、敵の多い戦いに飛び込むことになる。',
            options: [{ k: 'join', label: '討伐に加わる', sub: `しばらく${t.label}を優先して狙う` }, { k: 'ignore', label: '静観する', sub: '他の陣営に任せる' }],
          }, () => chance(0.5) ? 'join' : 'ignore');
          if (a === 'join') you.targetPref = t.id;
        }
      } else if (k === 'spot') {
        const t = pick(alive.filter(x => x !== you));
        const a = yield* ask(you, 'event', {
          title: '昼の街で',
          body: `人混みの中に、${t.label}のマスターらしき人物を見かけた。`,
          options: [
            { k: 'talk', label: '声をかける', sub: canPact(you, t, alive) ? (t.pact != null ? `${t.label}たちの同盟に加わる話を持ちかける` : '同盟の話を持ちかける') : '探りを入れる' },
            { k: 'follow', label: '尾行する', sub: '拠点を突き止めたい。気づかれる危険もある' },
            { k: 'ignore', label: '見逃す', sub: '関わらない' },
          ],
        }, () => wpick({ talk: 1, follow: 1, ignore: 1 }));
        if (a === 'talk') {
          if (canPact(you, t, alive) && chance(clamp(0.2 + effO(you, 'negotiate', t) + effO(t, 'negotiate', you) * 0.5 + (coalition(you, t) ? ENG.coalitionAlly : 0), 0, 0.85))) {
            const m = formPact(you, t); log('ally', `${mn(you)}と${mn(t)}は喫茶店で向かい合い、手を組むことにした。${pactNames(m)}の同盟だ。`, m.map(x => x.id), { big: true });
          } else { if (chance(0.4)) you.knowName.add(t.id); log('event', `${mn(you)}は${mn(t)}と言葉を交わした。${you.knowName.has(t.id) ? `話の端々から、${t.label}の真名は「${t.sv.trueName}」だと察しがついた。` : '腹の探り合いに終わった。'}`, [you.id, t.id]); }
        } else if (a === 'follow') {
          if (chance(0.7 - effO(t, 'detect', you) * 0.5)) { you.knowLoc.add(t.id); log('scout', `尾行は成功した。${t.label}の拠点は「${t.base.name}」だ。`, [you.id, t.id]); }
          else { t.knowLoc.add(you.id); log('event', `尾行は気づかれた。逆にこちらの拠点を知られたかもしれない。`, [you.id, t.id]); }
        } else log('event', `${mn(you)}は見なかったことにした。`, [you.id]);
      }
    }

    // ---------- 昼 ----------
    let lastCouncil = 0;
    const focusOf = c => SG ? SG.hooks.focus(c) : c.you && c.focus && c.focus !== 'auto' && FOCUS[c.focus] ? FOCUS[c.focus] : null;

    const deduceP = (c, t) => clamp(0.08 + (c.clues[t.id] || 0) * 0.12 + effO(c, 'reveal', t) + effO(c, 'intel', t) * 0.5 + c.master.stats.craft / 500 - effO(t, 'conceal', c) * 0.5, 0.03, 0.9);

    // はぐれサーヴァント（c）と、サーヴァントを失ったマスター（m）の再契約
    function contract(c, m, how) {
      // あなたのマスターが死んだ陣営のサーヴァントが、あなた以外のマスターと契約する：もうあなたの陣営ではない
      const taken = c.you && !m.you ? { master: c.master.name, day } : null;
      c.master = m.master; c.masterAlive = true; c.mhp = m.mhp || Math.round(m.mhpMax * 0.7); c.mhpMax = m.mhpMax; c.cs = m.cs; c.manaMax = m.manaMax; c.mana = Math.round(m.manaMax * 0.5); c.soloLeft = null; c.bond = 20;
      m.merged = true; m.inChurch = false; m.fate = { day, text: (m.fate ? m.fate.text + '。' : '') + `${day}日目、マスターは${c.label}と再契約した` };
      if (m.you) moveYou(m, c);
      else if (taken) releaseYou(c, taken);
      log('ally', how || `主を失った${nm(c)}と、サーヴァントを失った${mn(c)}が手を結んだ。再契約だ。`, [c.id, m.id], { big: true });
    }
    // 死んだあなたのマスターのサーヴァントが他人のものになった：「あなた」の印を外す（これまでに知ったことは残す）
    // あなたの陣営は失われた扱いで、のちにそのサーヴァントが勝っても、あなたの勝ちにはならない（result.youTaken）
    function releaseYou(c, taken) {
      c.you = false; c.retired = false; c.spectate = null; c.gameOver = false;
      c.knowName.add(c.id); c.knowPersona.add(c.id);
      youTaken = taken;
    }
    // プレイヤーの陣営を移す（知っていることも引き継ぐ）
    function moveYou(from, to) {
      to.you = true; from.you = false; you = to;
      to.knowName = new Set([...to.knowName, ...from.knowName]); to.knowLoc = new Set([...to.knowLoc, ...from.knowLoc]); to.knowPersona = new Set([...to.knowPersona, ...from.knowPersona, to.id]);
      to.clues = Object.assign({}, to.clues, from.clues);
      to.focus = from.focus; to.policy = from.policy;
    }

    // プレイヤーのサーヴァントが消滅した・マスターが倒れたときの選択
    function* checkFallen() {
      if (!you) return;
      if (you.gameOver && !you.gameOverAsked) {
        you.gameOverAsked = true; you.retiredAsk = true;
        const k = yield* ask(you, 'gameover', {
          title: 'ゲームオーバー',
          body: `マスター${mn(you)}は命を落とした。聖杯戦争は、あなたを置いて続いていく。`,
          options: [{ k: 'watch', label: '最後まで見届ける', sub: '残りの戦いを観戦する' }, { k: 'skip', label: '結末まで早送りする', sub: 'すぐに結末を見る' }],
        }, () => 'watch');
        you.retired = true; you.spectate = k;
        return;
      }
      if (!you.fallenPending) return;
      you.fallenPending = false;
      const c = you;
      const strays = camps.filter(t => t.alive && !t.masterAlive);
      const targets = camps.filter(t => t !== c && t.alive && t.masterAlive);
      const k = yield* ask(c, 'fallen', {
        title: `${c.label}を失った`,
        body: `${sn(c)}は消滅した。マスター${mn(c)}はまだ生きている。令呪は残り${c.cs}画。`,
        options: [
          { k: 'watch', label: '教会に保護を求め、戦いを見届ける', sub: '残りの聖杯戦争を観戦する。主を失ったサーヴァントが現れれば、再契約の機会もある' },
          { k: 'skip', label: '教会に保護を求め、結末まで早送りする', sub: 'ここで聖杯戦争から降りる' },
          ...strays.slice(0, 2).map(t => ({ k: 'stray:' + t.id, label: `主を失った${t.label}${known(t) ? '「' + t.sv.trueName + '」' : ''}と契約する`, sub: `現界していられるのはあと${t.soloLeft}日。すぐに契約すれば戦いに戻れる` })),
          targets.length ? { k: 'steal', label: '他のマスターから令呪を奪う', sub: '成功の見込みはごくわずか。失敗すれば命はない' } : null,
        ],
      }, () => strays.length && chance(ENG.recontract) ? 'stray:' + strays[0].id : 'watch');
      if (k.startsWith('stray:')) { contract(camps[+k.split(':')[1]], c, `${mn(c)}は、主を失った${nm(camps[+k.split(':')[1]])}に手を差し伸べた。再契約だ。`); return; }
      if (k === 'steal') {
        const t = targets.reduce((a, b) => (a.mhp - a.master.stats.body * 0.3 <= b.mhp - b.master.stats.body * 0.3 ? a : b));
        const p = ENG.stealBase + c.master.stats.craft / 800 + c.master.stats.luck / 1500 + (t.mhp < t.mhpMax * 0.5 ? 0.04 : 0) - eff(t, 'master_guard') * 0.1;
        log('council', `${mn(c)}は夜陰に紛れ、${t.label}のマスター、${mn(t)}を狙った。`, [c.id, t.id]);
        if (chance(Math.max(0.01, p))) {
          const old = mn(t);
          t.fate = null; t.cs = Math.max(1, t.cs);
          t.master = c.master; t.mhp = c.mhp; t.mhpMax = c.mhpMax; t.manaMax = c.manaMax; t.mana = Math.round(c.manaMax * 0.6); t.bond = 10;
          c.merged = true; c.fate = { day, text: (c.fate ? c.fate.text + '。' : '') + `${day}日目、マスターは${t.label}の令呪を奪った` };
          moveYou(c, t);
          log('cs', `${mn(t)}は${old}の腕から令呪を奪い取った。${nm(t)}の新たなマスターだ。`, [t.id], { big: true });
        } else if (chance(0.6)) {
          c.masterAlive = false; c.mhp = 0; c.gameOver = true;
          log('death', `試みは露見した。${nm(t)}の刃が、マスター${mn(c)}の命を奪った。`, [c.id, t.id], { big: true });
          yield* checkFallen();
        } else {
          c.inChurch = true; c.retired = false; c.spectate = 'watch';
          log('event', `試みは失敗した。深手を負った${mn(c)}は、からくも${W.church}へ逃げ込んだ。`, [c.id], { place: W.church, scene: 'church' });
        }
        return;
      }
      c.inChurch = true; c.spectate = k;
      if (k === 'skip') c.retired = true;
      log('event', `マスターの${mn(c)}は${W.church}に保護を求めた。${k === 'skip' ? 'ここから先は、結末だけを見届ける。' : '戦いの行方を見届ける。'}`, [c.id], { place: W.church, scene: 'church' });
    }

    // 作戦会議：状況に合う選択肢を最大3つ出す
    function* council() {
      const c = you, alive = active();
      const enemies = alive.filter(t => t !== c && !isAlly(t, c));
      const cand = [];
      const knownT = enemies.filter(t => c.knowLoc.has(t.id));
      if (knownT.length) {
        const t = knownT.reduce((a, b) => (a.hp / Math.max(5, a.sv.power) < b.hp / Math.max(5, b.sv.power) ? a : b));
        cand.push({ w: 3, o: { k: 'assault:' + t.id, label: `${t.label}${known(t) ? '「' + t.sv.trueName + '」' : ''}の拠点に総攻撃をかける`, sub: `今夜、準備を整えて「${t.base.name}」へ攻め込む（戦闘力+15%）` } });
      }
      if (c.cs >= 2) cand.push({ w: 1.5, o: { k: 'boost', label: '令呪を一画使い、霊基を強化する', sub: `3日間、戦闘力+20%（令呪 残り${c.cs}画）` } });
      if (camps.some(t => t !== c && t.alive && t.knowLoc.has(c.id))) cand.push({ w: 2.5, o: { k: 'move', label: '拠点を移す', sub: '居場所を知られている。工房は一から作り直し' } });
      {
        const ok = enemies.filter(x => canPact(c, x, alive)), pool = leader && leader !== c ? ok.filter(x => x !== leader) : ok;
        const t = pool.length ? pick(pool) : null;
        if (t) cand.push({ w: coalition(c, t) ? 3 : 2, o: { k: 'ally:' + t.id, label: `${t.label}${known(t) ? '「' + t.sv.trueName + '」' : ''}${t.pact != null ? 'たちの同盟に加わる' : c.pact != null ? 'を同盟に誘う' : 'に同盟を申し込む'}`,
          sub: (coalition(c, t) ? `勝ちすぎている${leader.label}への包囲網。` : '') + '残り3騎になるまで互いを襲わず、共に戦い、魔力や手当てを分け合う' } });
      }
      if (c.pact != null && alive.length <= ENG.allianceBreakAt + 1) { const t = betrayTarget(c); cand.push({ w: 3, o: { k: 'betray', label: `同盟を破り、${t.label}に奇襲をかける`, sub: '今夜、油断した同盟相手を討つ（戦闘力+20%）' } }); }
      // 真名は手がかりから推理する。手がかりの多い相手ほど当たりやすい
      const unk = enemies.filter(t => !c.knowName.has(t.id));
      if (unk.length) {
        const t = unk.reduce((a, b) => ((c.clues[a.id] || 0) >= (c.clues[b.id] || 0) ? a : b)), n = c.clues[t.id] || 0, p = deduceP(c, t);
        cand.push({ w: n >= 2 ? 3 : 1.2, o: { k: 'deduce:' + t.id, label: `${t.label}の真名を推理する`, sub: `手がかり${n}個・見込みは${p >= 0.6 ? '高い' : p >= 0.35 ? '五分' : '低い'}` } });
      }
      const unl = enemies.filter(t => !c.knowLoc.has(t.id));
      if (unl.length && c.mana >= 20) cand.push({ w: 1.5, o: { k: 'familiar', label: '使い魔を放って拠点を探す', sub: '魔力を使う。見つかるとは限らない' } });
      cand.push({ w: c.hp < 60 || c.mana < c.manaMax * 0.5 ? 3 : 0.8, o: { k: 'recover', label: '霊脈で力を蓄える', sub: '魔力と霊基を大きく回復する。今夜は動かない' } });
      const options = [];
      const pool = cand.slice();
      while (options.length < 3 && pool.length) { const i = +wpick(Object.fromEntries(pool.map((x, j) => [j, x.w]))); options.push(pool[i].o); pool.splice(i, 1); }
      const k = yield* ask(c, 'council', {
        title: `${day}日目、作戦会議`,
        body: `${sn(c)}の霊基 ${Math.round(c.hp)}・魔力 ${Math.round(c.mana / c.manaMax * 100)}%・令呪 ${c.cs}画。残り${alive.length}騎。`,
        options: options.concat([{ k: 'pass', label: '今は動かない', sub: '方針のとおりに過ごす' }]),
      }, () => { const w = {}; for (const o of options) w[o.k] = o.k.startsWith('assault') ? (c.policy === 'aggressive' ? 3 : 1.5) : o.k === 'recover' ? (c.hp < 60 ? 3 : 0.5) : 1; w.pass = 1; return wpick(w); });
      if (k.startsWith('assault:')) { c.assault = +k.split(':')[1]; log('council', `今夜、${camps[c.assault].label}の拠点を攻める。`, [c.id]); }
      else if (k === 'boost') { c.cs--; c.boostUntil = day + 2; bondUp(c, 3); log('cs', `「令呪をもって命ずる——力を示せ」${sn(c)}の霊基に令呪の魔力が満ちた。（残り${c.cs}画）`, [c.id], { big: true }); }
      else if (k === 'move') { for (const t of camps) if (t !== c) t.knowLoc.delete(c.id); const np = pick(W.places.filter(p => p.name !== c.base.name)); c.base = np; c.workshop = 0; log('council', `${mn(c)}は拠点を「${np.name}」へ移した。`, [c.id]); }
      else if (k.startsWith('ally:')) {
        const t = camps[+k.split(':')[1]];
        if (canPact(c, t, active()) && chance(clamp(0.25 + effO(c, 'negotiate', t) + effO(t, 'negotiate', c) * 0.5 + (t.policy === 'diplomacy' ? 0.15 : 0) + (coalition(c, t) ? ENG.coalitionAlly : 0), 0, 0.85))) { const m = formPact(c, t); log('ally', `${mn(t)}は申し出を受けた。${pactNames(m)}の同盟だ。`, m.map(x => x.id), { big: true }); }
        else log('council', `${mn(t)}は申し出を断った。`, [c.id, t.id]);
      } else if (k === 'betray') { const t = betrayTarget(c); leavePact(c); c.assault = t.id; c.betray = true; bondUp(c, -5); log('council', `${mn(c)}は同盟を破ることに決めた。今夜、${t.label}を討つ。`, [c.id, t.id], { big: true }); }
      else if (k.startsWith('deduce:')) {
        const t = camps[+k.split(':')[1]];
        if (chance(deduceP(c, t))) { c.knowName.add(t.id); log('scout', `これまでの手がかりを突き合わせ、${mn(c)}は${t.label}の真名にたどり着いた——「${t.sv.trueName}」。`, [c.id, t.id], { big: true }); }
        else { clue(c, t, 1); log('council', `${t.label}の真名を推理したが、決め手に欠けた。もう少し手がかりが要る。`, [c.id, t.id]); }
      } else if (k === 'familiar') {
        c.mana -= 20;
        const t = pick(enemies.filter(x => !c.knowLoc.has(x.id)));
        if (t && chance(clamp(0.45 + effO(c, 'intel', t) + eff(c, 'craft') * 0.5 + c.master.stats.craft / 400 - effO(t, 'stealth', c) * 0.5, 0.1, 0.9))) { c.knowLoc.add(t.id); log('scout', `放った使い魔が、${t.label}の拠点「${t.base.name}」を見つけた。`, [c.id, t.id]); }
        else log('council', '使い魔は手がかりを持ち帰れなかった。', [c.id]);
      } else if (k === 'recover') { c.mana = c.manaMax; c.hp = Math.min(100, c.hp + 30); c.restNight = true; log('council', `${sn(c)}は霊脈の上で力を蓄えた。`, [c.id]); }
    }
    function* dayPhase() {
      phase = 'day';
      tonight = {};
      const alive = active();
      if (alive.length <= ENG.allianceBreakAt) for (const c of alive) if (c.pact != null) {
        const m = pactOf(c); for (const x of m) x.pact = null;
        log('ally', `残りが${alive.length}騎となり、${pactNames(m)}の同盟は解消された。`, m.map(x => x.id));
      }
      // 終盤、同盟を破る陣営（性格による）
      if (alive.length <= ENG.allianceBreakAt + 1) for (const c of alive) if (c.pact != null && !c.you && c.masterAlive && chance(perv(c, 'betray') * 0.5)) {
        const t = betrayTarget(c); leavePact(c); c.assault = t.id; c.betray = true;
        log('ally', `${mn(c)}が同盟を破った。今夜、${t.label}を討つつもりだ。`, [c.id, t.id], { big: true });
      }
      // 包囲網：勝ちすぎている陣営が現れると、ほかの陣営は手を組んでそれを狙いやすくなる
      leader = leaderOf(alive);
      if (leader && !leaderSeen.has(leader.id) && alive.length > ENG.allianceBreakAt + 1) { leaderSeen.add(leader.id); log('world', `${nm(leader)}の勝ちすぎを警戒し、ほかの陣営が手を結ぼうと動き始めた。`, [leader.id]); }
      // 同盟の支え合い：魔力を分け、治療の心得のある英霊が味方を手当てし、作った道具を回す（乱数は使わない）
      pactSupport(alive);
      if (chance(ENG.eventChance)) yield* worldEvent();

      // 作戦会議（大きな決断）。数日ごと
      if (you && you.alive && you.masterAlive && day - lastCouncil >= ENG.councilEvery) { lastCouncil = day; yield* council(); }

      for (const c of shuffle(alive)) {
        c.hunting = c.hidden = c.wander = c.fought = false;
        bondUp(c, 0.5);
        // 毎朝発動する効果（回復・魔力回復・解除はその場で、強化はその日の夜の戦いまで）。昨夜の「相手を倒したとき」の強化はここで切れる
        // 相手から受けた衰弱は、毎朝一定の確率で抜ける（休んだ翌朝は抜けやすい）。自分に掛けた衰弱は残る
        if (c.wither > 0 && chance(clamp(ENG.witherFade * (c.rested === day - 1 ? 2 : 1), 0, 1))) { c.wither = 0; if (c.you) log('day', `${sn(c)}を蝕んでいた衰えが、ようやく抜けた。`, [c.id]); }
        c.dayTemp = null; fireTrig(c, null, 'day', null);
        // 昨夜の毒：もう一度霊基を削って抜ける（毒では倒れない）
        if (c.poison && c.poison.day < day) { c.hp = Math.max(1, c.hp - ENG.poisonDay); if (c.you) log('day', ailText('ailPoisonDay', 'poison', c.poison.p, null, c), [c.id]); c.poison = null; }
        if (c.warned > 0 && day % 3 === 0) c.warned = Math.max(0, c.warned - 1);
        // はぐれサーヴァント
        if (!c.masterAlive) {
          const free = camps.filter(m => !m.alive && m.masterAlive && !m.merged && m.cs > 0 && !m.retired);
          let m = null;
          if (free.length) {
            const yours = free.find(f => f.you);
            if (yours) {
              const a = yield* ask(yours, 'recontract', {
                title: '再契約の機会',
                body: `主を失った${nm(c)}が、新たなマスターを求めている。`,
                options: [{ k: 'yes', label: '契約する', sub: `${c.label}のマスターとして戦いに戻る` }, { k: 'no', label: '断る', sub: '観戦を続ける' }],
              }, () => chance(ENG.recontract) ? 'yes' : 'no');
              if (a === 'yes') m = yours;
            } else if (chance(ENG.recontract)) m = pick(free);
          }
          if (m) contract(c, m);
          else if (c.soloLeft <= 0) { servantDown(c, `マスターを失い、${day}日目に現界を保てなくなった`); continue; }
          else c.soloLeft--;
        }
        if (chance(eff(c, 'uncontrolled') * (1 - c.bond / 150) * clamp(1 - FX.mMindControl * md(c, 'mind'), 0.3, 1.5))) { c.wander = true; if (c.you) log('day', `${sn(c)}が言うことを聞かず、昼の街をうろついている。`, [c.id]); continue; }

        // 昼の行動
        const P = POLICIES[c.policy] || POLICIES.balanced;
        const w = {
          scout: 1 + eff(c, 'intel') * 3 + eff(c, 'detect') * ENG.detectScout,   // 索敵は偵察に向くが、偵察ばかりにならないように
          fortify: c.workshop >= 5 ? 0.1 : 0.5 + eff(c, 'territory') * 4 + eff(c, 'craft') * 3 + (c.sv.class.key === 'caster' ? 1 : 0),
          rest: 0.3 + (100 - c.hp) / 30 + (c.mana < c.manaMax * 0.4 ? 1.5 : 0) + (c.mhp < c.mhpMax * 0.5 && upk(c) > 1.2 ? 1.5 : 0),
          ally: alive.some(x => canPact(c, x, alive)) ? Math.max(0, ENG.allyActW + Math.max(0, eff(c, 'negotiate')) * 3 + perv(c, 'ally') * 2) + (leader && leader !== c && !isAlly(c, leader) ? ENG.coalitionAllyW : 0) : 0,
          hide: eff(c, 'stealth') * 2 + (c.hp < 50 ? 0.5 : 0),
        };
        for (const k in P.day) w[k] *= P.day[k];
        const F = focusOf(c);
        let act = F && F.day ? F.day : wpick(w);
        if (act === 'ally' && !w.ally) act = 'scout';
        yield* doAct(c, act, alive);
        // 日常
        if (c.you && c.masterAlive && chance(ENG.lifeChance)) yield* lifeEvent(c);
      }
      // 維持魔力
      for (const c of active()) {
        if (!c.masterAlive) continue;
        // 休んだ・潜んだ日は霊体化して魔力を節約する。足りない分はマスターの生命力から（drain）
        // 常時発動の宝具は、その宝具の魔力消費 × npAlwaysUpkeep を毎日払い続ける（霊体化しても止まらない）
        const always = (c.sv.nps || []).reduce((t, n) => t + (n.mode === 'always' && !n.disabled ? npCostOf(c, n) * ENG.npAlwaysUpkeep : 0), 0);
        const cost = ENG.upkeep * upk(c) * (c.spirit ? ENG.spiritSave : 1) + always;
        c.spirit = false;
        c.mhp = Math.min(c.mhpMax, c.mhp + 5);
        c.mana = Math.min(c.manaMax, c.mana + ENG.manaRegen + c.master.stats.mana * 0.15 + c.workshop * 2 + eff(c, 'resource') * 10) - cost;
        drain(c);
        if (c.alive && c.hp <= 0) servantDown(c, `魔力が尽き、${day}日目に消滅した`);
      }
    }

    // 他の陣営がプレイヤーの拠点を新たに突き止めたとき、一言ログを残す（rnd を使わないので結果は変わらない）
    function learnLoc(x, t) {
      if (t.you && !x.you && x !== t && !x.knowLoc.has(t.id) && x.alive) log('scout', `${nm(x)}に、こちらの拠点「${t.base.name}」を突き止められた。`, [t.id, x.id]);
      x.knowLoc.add(t.id);
    }

    function* doAct(c, act, alive) {
      if (act === 'scout') {
        const t = pick(alive.filter(x => x !== c && x.alive)); if (!t) return;
        if (chance(clamp(0.35 + effO(c, 'intel', t) + effO(c, 'detect', t) * 0.5 - effO(t, 'stealth', c) * 0.6 + FX.mCraftScout * md(c, 'craft'), 0.05, 0.9))) {
          const newLoc = !c.knowLoc.has(t.id); learnLoc(c, t);
          const nameHit = !c.knowName.has(t.id) && chance(clamp(0.08 + effO(c, 'reveal', t) + effO(c, 'intel', t) * 0.3 - effO(t, 'conceal', c) * 0.6, 0, 0.7));
          if (nameHit) c.knowName.add(t.id); else clue(c, t, 1);
          for (const y of allies(c)) { learnLoc(y, t); if (nameHit) y.knowName.add(t.id); }
          if (c.you && (newLoc || nameHit)) log('scout', `偵察の結果、${t.label}の拠点は「${t.base.name}」だと突き止めた。` + (nameHit ? `さらに真名が「${t.sv.trueName}」だと分かった。` : ''), [c.id, t.id]);
          else if (c.you) log('day', line('scoutNone', { S: sn(c) }), [c.id]);
        } else if (c.you) log('day', line('scoutFail', { S: sn(c) }), [c.id]);
      } else if (act === 'fortify') {
        if (chance(clamp(0.5 + eff(c, 'territory') + eff(c, 'resource') * 0.5 + FX.mCraftFort * md(c, 'craft'), 0.2, 0.95))) {
          c.workshop = Math.min(5, c.workshop + 1);
          if (c.you || c.workshop >= 3) log('day', line('fortify', { S: sn(c), base: c.base.name, ws: c.workshop }), [c.id]);
        } else if (c.you) log('day', line('fortifyFail', { S: sn(c) }), [c.id]);
        if (c.items < 3 && chance(eff(c, 'craft'))) { c.items++; if (c.you) log('day', `${sn(c)}が戦いに役立つ道具を用意した。`, [c.id]); }
      } else if (act === 'rest') {
        c.rested = day;
        c.hp = Math.min(100, c.hp + ENG.restHeal + eff(c, 'regen') * ENG.regenHeal);
        c.mhp = Math.min(c.mhpMax, c.mhp + 15 + eff(c, 'heal_other') * 60);
        c.mana = Math.min(c.manaMax, c.mana + 10); c.spirit = true;
        if (c.you) log('day', line('rest', { S: sn(c) }), [c.id]);
      } else if (act === 'ally') {
        const cand0 = alive.filter(x => canPact(c, x, alive));
        if (!cand0.length) return;
        // 包囲網：勝ちすぎている陣営には持ちかけない
        const cand = leader && leader !== c && cand0.some(x => x !== leader) ? cand0.filter(x => x !== leader) : cand0;
        const t = pick(cand);
        const p = clamp(ENG.allyAccept + effO(c, 'negotiate', t) + effO(t, 'negotiate', c) * 0.5 + (t.policy === 'diplomacy' ? 0.15 : 0) + perv(t, 'ally') + (coalition(c, t) ? ENG.coalitionAlly : 0), 0, 0.8);
        // 申し込まれた側がプレイヤーなら、受けるかどうかを聞く
        const accept = t.you ? (yield* ask(t, 'ally', {
          title: '同盟の申し出',
          body: `${c.label}${known(c) ? '「' + c.sv.trueName + '」' : ''}のマスター、${mn(c)}から同盟の申し出があった。` + (c.pact != null ? `（${allies(c).map(x => x.label).join('・')}とすでに手を組んでいる）` : '') + (coalition(c, t) ? `勝ちすぎている${leader.label}を共に討とうという。` : ''),
          options: [{ k: 'yes', label: '受ける', sub: '互いに襲わず、情報を分け合い、共に戦い、魔力や手当てを分け合う。残り3騎で解消' }, { k: 'no', label: '断る', sub: '一人で戦う' }],
        }, () => chance(p) ? 'yes' : 'no')) === 'yes' : chance(p);
        if (accept) { const m = formPact(c, t); log('ally', `${mn(c)}と${mn(t)}が手を組んだ。${pactNames(m)}の同盟だ。`, m.map(x => x.id), { big: m.some(x => x.you) }); }
        else if (c.you) log('day', `${mn(c)}は${t.label}の陣営に同盟を持ちかけたが、断られた。`, [c.id, t.id]);
        else if (t.you) log('day', `${mn(t)}は${c.label}の陣営からの申し出を断った。`, [t.id, c.id]);
      } else if (act === 'hide') {
        c.hidden = true; c.spirit = true;
        if (c.you) log('day', line('hide', { S: sn(c) }), [c.id]);
      }
    }

    // ---------- 夜 ----------
    // 加勢：同盟相手のうち、来られる者が一騎まで（共同作戦で同じ敵を狙っていれば来やすい）
    function joinAlly(x, enemy, home) {
      for (const y of allies(x)) {
        if (y.fought || y === enemy || y.hp < 40 || y.retired || isAlly(y, enemy)) continue;
        const F = focusOf(y);
        if (F && F.night === false) continue;   // プレイヤーが守り・休み・潜伏の方針なら出ない
        if (chance(joinP(x, y, enemy, home, F))) return y;
      }
      return null;
    }
    function joinP(x, y, enemy, home, F) {
      return clamp(ENG.allyJoin + (y.op != null && y.op === enemy.id ? ENG.jointJoin : 0) + (y.hunting ? 0.15 : 0) + (home === x ? 0.2 : 0) + eff(x, 'rally') + eff(y, 'rally') + perv(y, 'ally') * 0.5 - (y.wander ? 0.2 : 0) + (F && F.night === true ? 0.3 : 0), 0.05, 0.85);
      
    }
    function* nightPhase() {
      phase = 'night';
      const alive = active();
      if (alive.length <= 1) return;
      if (tonight.calm) return;
      const avg = alive.reduce((t, c) => t + c.sv.power, 0) / alive.length;
      const finale = day > ENG.maxDays - ENG.finaleDays;
      yield* pactOps(alive);
      for (const c of alive) {
        const P = POLICIES[c.policy] || POLICIES.balanced;
        let p = ENG.huntBase + (c.sv.power - avg) / 60 + (isBerserk(c) ? 0.2 : 0) + (c.hp < 40 ? -0.3 : 0) + (finale ? 0.4 : 0) + (!c.masterAlive ? 0.2 : 0) + (c.hidden ? -0.2 : 0) + P.hunt + perv(c, 'hunt') + (tonight.moon ? 0.2 : 0) + (tonight.stir ? 0.12 : 0) - (tonight.patrol ? 0.15 : 0) - c.warned * 0.15 + (c.targetPref != null ? 0.15 : 0) - (c.masterAlive && c.mana < c.manaMax * 0.2 && !isBerserk(c) ? 0.15 : 0);
        if (c.op != null) p += ENG.jointHunt;   // 共同作戦の夜
        p = clamp(p, 0.05, 0.95);
        const F = focusOf(c);
        if (c.restNight) { c.restNight = false; c.hunting = false; }
        else if (c.assault != null) c.hunting = true;
        else if (c.wander) c.hunting = true;
        else if (F && F.night != null) c.hunting = F.night;
        else c.hunting = chance(p);
      }
      let any = false;
      for (const h of shuffle(alive)) {
        if (!h.alive || !h.hunting || h.fought) continue;
        const targets = active().filter(t => t !== h && !t.fought && !isAlly(t, h));
        if (!targets.length) continue;
        let t = null;
        const fixed = h.assault != null ? camps[h.assault] : h.op != null ? camps[h.op] : h.targetPref != null ? camps[h.targetPref] : null;
        if (fixed && targets.includes(fixed)) t = fixed;
        else {
          const tw = {};
          for (const x of targets) tw[x.id] = 1 + (h.knowLoc.has(x.id) ? 2 : 0) + clamp(h.sv.power / Math.max(5, x.sv.power) - 1, -0.5, 1.5) + (x.hp < 50 ? 0.5 : 0) + (related(h, x) ? 2 : 0) + (x.bounty ? 1.5 : 0) + (leader === x && !isAlly(h, x) ? (h.pact != null ? ENG.coalitionTarget : ENG.coalitionTarget * 0.25) : 0);
          t = camps[+wpick(tw)];
        }
        if (h.targetPref != null && !camps[h.targetPref].alive) h.targetPref = null;
        const assault = h.assault != null && t.id === h.assault;
        h.assault = null;
        const pf = assault ? 0.95 : clamp(ENG.findBase + effO(h, 'detect', t) * ENG.detectFind + (h.knowLoc.has(t.id) ? 0.3 : 0) + (t.hunting ? 0.15 : 0) + (t.wander ? 0.2 : 0) - effO(t, 'stealth', h) * 0.7 - Math.max(0, effO(t, 'detect', h)) * ENG.detectWary - (t.hidden ? 0.2 : 0)
          + FX.agiFind * (sd(h, 'agi') - sd(t, 'agi')) - FX.mLuckHide * md(t, 'luck') - (tonight.fog ? 0.15 : 0), 0.05, 0.95);
        if (!chance(pf)) { if (h.you) log('night', line('huntMiss', { S: sn(h) }), [h.id]); continue; }
        any = true;
        const home = t.hunting ? null : t;
        const place = home ? t.base : pick(W.places);
        if (!home) learnLoc(t, h);
        if (home && t.masterAlive && chance(Math.min(0.6, effO(h, 'anti_master', t) * 1.5 + Math.max(0, perv(h, 'ambush')) * 0.12))) {
          h.fought = t.fought = true;
          if (yield* ambushMaster(h, t)) { yield* checkFallen(); continue; }
        }
        if (assault) { h.surprise = h.betray ? 0.2 : 0.15; h.betray = false; }
        // 索敵：先に相手を見つけたぶん、有利な形で仕掛けられる（相手の索敵が高ければ打ち消される）
        else { const dt = effO(h, 'detect', t) - effO(t, 'detect', h) * 0.5; if (dt > 0) h.surprise = (h.surprise || 0) + Math.min(ENG.detectEdgeCap, dt * ENG.detectEdge); }
        // 同盟相手が加勢に来ることがある（拠点を守る戦いや、同じ夜に出ている味方ほど来やすい。統率で上がる）
        const helpA = joinAlly(h, t, home), helpB = joinAlly(t, h, home);
        yield* battle(h, t, { place, home, terrain: tonight.rain ? '水辺' : place.terrain, rain: tonight.rain, helpA, helpB });
        yield* checkFallen();
      }
      for (const c of camps) c.op = null;
      if (!any && you && you.alive && !entries.some(e => e.day === day && e.phase === 'night')) log('night', line('quietNight'), []);
    }
    // 共同作戦：同盟ごとに、今夜そろって同じ敵を狙うか決める（的は包囲網の的、いなければ同盟の外でいちばん手強い陣営）。
    //   決まれば、その夜は出撃しやすく、狙いがそろい、加勢にも来やすい。標的の拠点は同盟の中で知らせ合う
    function* pactOps(alive) {
      const seen = new Set();
      for (const c of alive) {
        if (c.pact == null || seen.has(c.pact)) continue;
        seen.add(c.pact);
        const m = pactOf(c).filter(x => x.masterAlive && !x.retired);
        if (m.length < 2) continue;
        const outs = alive.filter(x => !m.includes(x) && !isAlly(x, c));
        if (!outs.length) continue;
        if (!chance(clamp(ENG.jointOp + m.reduce((t, x) => t + Math.max(0, eff(x, 'rally')), 0) + (leader && outs.includes(leader) ? 0.15 : 0), 0, 0.9))) continue;
        const t = leader && outs.includes(leader) ? leader : outs.reduce((a, b) => (a.kills.length * 10 + a.sv.power >= b.kills.length * 10 + b.sv.power ? a : b));
        const knew = m.some(x => x.knowLoc.has(t.id));
        for (const x of m) { x.op = t.id; if (knew) x.knowLoc.add(t.id); }
        if (m.some(x => x.you)) log('ally', `${pactNames(m)}は、今夜そろって${nm(t)}を討つと決めた。`, m.map(x => x.id).concat([t.id]));
      }
    }
    // 同盟の支え合い（毎朝）：魔力の乏しい味方に余裕のある味方が魔力を分け、治療の心得のある英霊が味方の傷を手当てし、
    //   道具を2つ以上持つ味方が持たない味方に1つ回す。乱数は使わない
    function pactSupport(alive) {
      const seen = new Set();
      for (const c of alive) {
        if (c.pact == null || seen.has(c.pact)) continue;
        seen.add(c.pact);
        const m = pactOf(c).filter(x => x.masterAlive);
        if (m.length < 2) continue;
        const showYou = m.some(x => x.you), say = (k, txt, ids) => { if (!showYou || (supLog[k] != null && day - supLog[k] < 3)) return; supLog[k] = day; log('ally', txt, ids); };
        for (const r of m) {
          if (r.mana >= r.manaMax * 0.35) continue;
          const g = m.filter(x => x !== r && x.mana > x.manaMax * 0.6).sort((a, b) => b.mana / b.manaMax - a.mana / a.manaMax)[0];
          if (!g) continue;
          const v = Math.min(ENG.allyManaShare, g.mana - g.manaMax * 0.5, r.manaMax - r.mana);
          if (v > 0) { g.mana -= v; r.mana += v; if (g.you || r.you) say('mana', `${mn(g)}が、同盟を組む${mn(r)}に魔力を分けた。`, [g.id, r.id]); }
        }
        for (const hl of m) {
          const k = eff(hl, 'heal_other'); if (!(k > 0)) continue;
          for (const r of m) if (r !== hl && r.alive && r.hp < 80) { const v = Math.min(100 - r.hp, k * ENG.allyHeal); if (v > 0) { r.hp += v; if (hl.you || r.you) say('heal', `${sn(hl)}が、同盟を組む${sn(r)}の傷を手当てした。`, [hl.id, r.id]); } }
        }
        for (const r of m) if (r.items === 0) { const g = m.find(x => x !== r && x.items >= 2); if (g) { g.items--; r.items++; if (g.you || r.you) say('item', `${mn(g)}が、作っておいた道具を${mn(r)}に分けた。`, [g.id, r.id]); } }
      }
    }

    // ---------- 特異点：ここから先の進行は singularity.js に任せる ----------
    // 戦闘・宝具・効果・記録・判断の仕組みはそのまま使い、日々の進め方と結末だけを差し替える
    if (SG) return yield* SG.run({
      camps, out, entries, seed, city, ENG, FX, W,
      rnd, chance, pick, wpick, shuffle, clamp,
      get day() { return day; }, set day(v) { day = v; },
      get phase() { return phase; }, set phase(v) { phase = v; },
      get tonight() { return tonight; }, set tonight(v) { tonight = v; },
      get you() { return you; },
      log, line, say, voice, ask, bondUp,
      known, nm, sn, mn, pubName, clue, deduceP, related,
      eff, effS, sd, md, condOk, fireTrig, ailText, upk, npCostOf, wildOf,
      battle, lethal, servantDown, masterDown, lifeEvent,
    });

    // ---------- 開幕 ----------
    log('prologue', `${city}。七騎の英霊が呼ばれ、聖杯戦争が始まる。`, [], { head: true });
    if (opts.war && opts.war.pick === 'open') log('prologue', '今回の聖杯戦争では、七つのクラスの決まりが働いていない。同じクラスの英霊が並び立つこともある。', []);
    for (const c of camps) {
      const who = `${mn(c)}（${c.master.originLabel}）`;
      const sub = c.extra ? `本来は${G.classDef(c.slot).label}の枠に、${c.sv.class.label}が割り込んだ。` : c.substitute ? `${G.classDef(c.slot).label}の枠に、${c.sv.class.label}のサーヴァントが応えた。` : '';
      log('summon', `${who}が${c.label}を召喚した。${sub}${c.you ? 'これが、あなたの陣営だ。' : ''}`, [c.id], { quote: c.you ? say(c, ['召喚']) : null });
    }
    // 各陣営の戦略（プレイヤーは選べる）
    const autoPolicy = c => { const pw = PER(c).policy || {}; const w = {
      aggressive: 1 + (isBerserk(c) ? 2 : 0) + Math.max(0, (c.sv.power - 35) / 15),
      defensive: 1 + (c.sv.class.key === 'caster' ? 2 : 0) + eff(c, 'territory') * 3,
      intel: 0.6 + eff(c, 'stealth') * 2 + eff(c, 'intel') * 2,
      diplomacy: 0.4 + Math.max(0, eff(c, 'negotiate')) * 3,
      balanced: 1.5,
    }; for (const k in w) w[k] *= pw[k] || 1; return wpick(w); };
    for (const c of camps) if (!c.you) c.policy = autoPolicy(c);
    if (you) {
      log('summon', `あなたの${you.label}の真名は「${you.sv.trueName}」。${you.sv.profile && you.sv.profile.wish ? '聖杯に託す願いは「' + you.sv.profile.wish + '」。' : ''}マスター${mn(you)}の願いは「${you.master.wish}」。`, [you.id]);
      you.policy = autoPolicy(you);
      you.focus = 'auto';
    }
    // 画面に出す開戦時の情報（マスターの紹介・陣営の戦略）。乱数は使わない
    for (const c of camps) {
      const m = c.master, P = PER(c);
      Object.assign(out.meta[c.id], {
        servantId: c.sv.id, policy: c.policy, policyLabel: (POLICIES[c.policy] || {}).label || '', base: c.base.name,
        master: {
          name: m.name, sex: m.sex, age: m.age, origin: m.origin, originLabel: m.originLabel,
          persona: P.label || null, personaDesc: P.desc || null,
          stats: Object.fromEntries(Object.entries(m.stats).map(([k, v]) => [k, Math.round(v)])),
          skills: (m.skills || []).map(x => x.name + (x.rankRaw ? '：' + x.rankRaw : '')), traits: m.traits || [],
          catalyst: !!m.catalyst, wish: m.wish, cs: c.cs, hpMax: c.mhpMax, manaMax: c.manaMax,
        },
      });
    }

    // ---------- 本編 ----------
    let finaleAnnounced = false, quietFrom = null;
    for (day = 1; day <= ENG.maxDays; day++) {
      if (active().length <= 1) { day--; break; }
      phase = 'day';
      // 1日ごとに呼び出し元へ戻り、プレイヤーの今の方針を受け取る（止まらない）
      const f = yield { type: 'tick', day };
      if (you && FOCUS[f]) you.focus = f;
      const head = log('dayhead', `${day}日目`, [], { head: true }), n0 = entries.length;
      if (!finaleAnnounced && day > ENG.maxDays - ENG.finaleDays) { finaleAnnounced = true; log('event', line('finale'), [], { big: true }); }
      yield* dayPhase();
      yield* checkFallen();
      if (active().length > 1) yield* nightPhase();
      yield* checkFallen();
      for (const c of camps) { c.temp = []; c.npBoost = 0; c.bx = null; c.ail = null; c.armed = null; c.off = null; c.cleanse = 0; c.tUsed = null; c.tLog = null; c.autoUsed = null; c.autoQ = null; }
      const quiet = entries.length === n0 || entries.slice(n0).every(e => e.kind === 'night' && !e.ids.length);
      if (quiet) { entries.splice(entries.indexOf(head)); if (quietFrom == null) quietFrom = day; }
      else if (quietFrom != null) {
        const q = { day: quietFrom, phase: 'day', kind: 'quiet', text: quietFrom === day - 1 ? `${quietFrom}日目は静かに過ぎた。` : `${quietFrom}日目から${day - 1}日目までは、表立った動きはなかった。`, ids: [], you: false, snap: head.snap };
        entries.splice(entries.indexOf(head), 0, q); quietFrom = null;
      }
      if (active().length <= 1) break;
    }
    if (quietFrom != null) entries.push({ day: quietFrom, phase: 'day', kind: 'quiet', text: `${quietFrom}日目から先は、表立った動きはなかった。`, ids: [], you: false, snap: snap() });
    day = Math.min(day, ENG.maxDays);

    // ---------- 結末 ----------
    phase = 'end';
    const left = active();
    let winner = null;
    let ending = left.length ? 'draw' : 'wipe';
    // マスターを失い、単独行動でも現界を保てない最後の一騎は、聖杯の降臨を待たずに消える（全滅）
    if (left.length === 1 && !left[0].masterAlive && !(left[0].soloLeft > 0)) {
      const c = left[0];
      c.alive = false; c.out = true; c.hp = 0; c.fate = { day, text: 'マスターを失い、聖杯の降臨を待たずに消えた' };
      log('end', `${day}日目。最後に残ったのは${nm(c)}だった。だが主を失った霊基は、聖杯の降臨を待たずにほどけていった。聖杯を手にする者はいなかった。`, [c.id], { big: true, quote: say(c, ['戦闘不能', '敗北']) });
      left.length = 0; ending = 'wipe';
    } else if (left.length === 1) {
      winner = left[0]; ending = 'win';
      const wish = (winner.sv.profile && winner.sv.profile.wish) || null;
      log('end', winner.masterAlive ? `${day}日目。最後に残ったのは${nm(winner)}と、マスターの${mn(winner)}だった。聖杯が降臨する。`
        : `${day}日目。最後に残ったのは${nm(winner)}だった。マスターを失いながらも単独で現界を保ち、ただ一騎で聖杯の降臨を迎える。`, [winner.id], { big: true, quote: say(winner, ['聖杯について', '勝利']) });
      log('end', (winner.masterAlive ? `${mn(winner)}の願いは「${winner.master.wish}」。` : '') + (wish ? `${nm(winner)}の願いは「${wish}」。` : ''), [winner.id]);
    }
    if (ending === 'wipe' && !entries.some(e => e.kind === 'end' && e.big)) log('end', lastMutual === day ? `${day}日目。最後の二騎は相討ちとなり、聖杯を手にする者はいなかった。` : `${day}日目。最後の一騎までが斃れ、聖杯を手にする者はいなかった。`, [], { big: true });
    else if (ending === 'draw') log('end', `${ENG.maxDays}日が過ぎても決着はつかなかった。${left.map(nm).join('、')}を残したまま、聖杯は姿を消した。`, left.map(c => c.id), { big: true });
    for (const c of camps) pubName.add(c.id);
    for (const c of left) c.fate = { day, text: c === winner ? '勝者' : '生き残った' };
    log('end', '——聖杯戦争、終結。', [], { head: true });

    const result = {
      seed, city, days: day,
      you: you ? you.id : null,
      youTaken,   // あなたのマスターは死に、サーヴァントは他のマスターと再契約した（その陣営が勝っても、あなたの勝ちではない）
      winner: winner ? winner.id : null,
      ending,   // 'win'（勝者あり）/ 'wipe'（全滅：相討ち、マスターを失った最後の一騎の消滅など）/ 'draw'（期限切れ）
      camps: camps.map(c => ({
        id: c.id, label: c.label, slot: c.slot, trueName: c.sv.trueName, cls: c.sv.class.label, servantId: c.sv.id,
        master: c.master.name, origin: c.master.originLabel, wish: c.master.wish, alive: c.alive, masterAlive: c.masterAlive,
        fate: c.fate, kills: c.kills.map(i => camps[i].sv.trueName), npUses: c.npUses, battles: c.battles, power: r1(c.sv.power), you: !!c.you, bond: Math.round(c.bond), policy: c.policy,
        persona: PER(c).label || null,
      })),
      entries,
    };
    Object.assign(out, result);
    return result;
  }

  /** 全自動で最後まで進める（問いはすべて「おまかせ」） */
  function runWar(opts) {
    const g = warGen(Object.assign({}, opts, { ask: opts && opts.ask ? opts.ask : 'never' }));
    let r = g.next();
    while (!r.done) r = g.next(r.value && r.value.type === 'tick' && opts && opts.focus ? opts.focus(r.value.day) : 'auto');
    return r.value;
  }

  G.engine = { runWar, warGen, makeRng, POLICIES, FOCUS };
})(globalThis.HGW = globalThis.HGW || {});
