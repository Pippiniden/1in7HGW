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
  const B = G.build, R = G.rank;

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

    const roster = (opts.roster || []).filter(s => s && s.score);
    if (roster.length < 2) throw new Error('サーヴァントが2騎以上必要です');

    // ---------- 舞台と陣営 ----------
    const W = G.WORLD, N = G.NAMES;
    const city = opts.city || pick(W.cities);
    const places = shuffle(W.places);
    const comp = G.war.composeWar(roster, rnd, opts.war).filter(x => x.servant);
    const labelCount = {};
    const masterPool = (opts.masters || []).slice();
    const camps = comp.map((x, i) => {
      const sv = JSON.parse(JSON.stringify(x.servant));
      for (const k of B.STAT_KEYS) if (sv.ranks[k] && sv.ranks[k].range) { sv.ranks[k] = R.rollRange(sv.ranks[k], rnd); sv.score[k] = sv.ranks[k].score; }
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
        base: places[i % places.length], workshop: m.resources.workshop || 0, items: 0, ally: null,
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
    let you = opts.player === 'none' ? null : camps[opts.player != null ? opts.player : Math.floor(rnd() * camps.length)];
    if (you) you.you = true;
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
    const snap = () => camps.map(c => ({
      id: c.id, label: c.label, name: known(c) ? c.sv.trueName : null, cls: c.sv.class.label,
      hp: Math.max(0, Math.round(c.hp)), mhp: Math.max(0, Math.round(c.mhp / c.mhpMax * 100)), mana: Math.round(c.mana / c.manaMax * 100),
      alive: c.alive, masterAlive: c.masterAlive, master: mn(c), cs: c.cs, ally: c.ally, workshop: c.workshop, you: !!c.you, out: c.out,
      fate: c.fate ? c.fate.text : null, soloLeft: c.soloLeft, bond: Math.round(c.bond), bounty: c.bounty,
      origin: c.master.originLabel, wish: c.master.wish, base: c.base.name, scene: c.base.scene,
      persona: !you || c.you || you.knowPersona.has(c.id) ? (PER(c).label || null) : null,
      clues: you && !c.you && !known(c) ? (you.clues[c.id] || 0) : 0,
    }));
    function log(kind, text, ids, extra) {
      ids = ids || [];
      const e = Object.assign({ day, phase, kind, text, ids, you: !!you && ids.includes(you.id) }, extra || {});
      if (phase === 'night' && tonight.rain) e.weather = 'rain';
      else if (phase === 'night' && tonight.moon) e.weather = 'moon';
      e.snap = snap();
      entries.push(e);
      if (you && ids.includes(you.id) && /battle|death|cs/.test(kind)) you.notable = true;
      return e;
    }
    const voice = (c, keys) => { for (const k of keys) { const v = c.sv.voice && c.sv.voice[k]; if (v && v.length) return pick(v); } return null; };
    const say = (c, keys) => { const v = voice(c, keys); return v ? { who: nm(c), text: v } : null; };
    const bondUp = (c, n) => { c.bond = clamp(c.bond + (n > 0 ? n * (PER(c).bond || 1) : n), 0, 100); };
    // 宝具のセリフは、その宝具の名前を含むものを優先。別の宝具の名前を叫んでいるものは使わない
    const sayNP = (c, np) => {
      const lines = (c.sv.voice && c.sv.voice['宝具']) || [];
      if (!lines.length) return null;
      const keys = [np.name, np.reading].filter(Boolean).map(x => x.replace(/[\s・]/g, ''));
      const others = (c.sv.nps || []).filter(n => n !== np).flatMap(n => [n.name, n.reading]).filter(x => x && x.length >= 2).map(x => x.replace(/[\s・]/g, ''));
      const flat = l => l.replace(/[\s・]/g, '');
      const mine = lines.filter(l => keys.some(k => flat(l).includes(k)));
      const neutral = lines.filter(l => !others.some(k => flat(l).includes(k)));
      const pool = mine.length ? mine : neutral;
      return pool.length ? { who: nm(c), text: pick(pool) } : null;
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
    function eff(c, id, terrain) {
      let t = 0;
      for (const x of Object.values(c.sv.effectSummary || {})) if (x.id === id && (!x.params || !x.params.cond || x.params.cond === terrain)) t += x.passive;
      for (const e of c.temp) if (e.id === id && (!e.params || !e.params.cond || e.params.cond === terrain)) t += e.mag;
      return t;
    }
    const effVs = (c, id, o) => Object.values(c.sv.effectSummary || {}).filter(x => x.id === id && x.params && o.sv.tags.includes(x.params.tag)).reduce((t, x) => t + x.passive, 0)
      + c.temp.filter(e => e.id === id && e.params && o.sv.tags.includes(e.params.tag)).reduce((t, e) => t + e.mag, 0);
    // ステータスの役割（config.js の STAT_FX）。sd：サーヴァントの偏差、md：マスターの偏差（C相当を0、A相当を約+1）
    const FX = G.CONFIG.STAT_FX, dev = B.statDev;
    const sd = (c, k) => dev(c.sv.score[k]);
    const md = (c, k) => c.masterAlive ? dev(c.master.stats[k]) : 0;
    const npCostOf = (c, n) => n.cost * ENG.npCost * Math.max(0.5, 1 - FX.magCost * sd(c, 'mag'));
    const active = () => camps.filter(c => c.alive);
    const isBerserk = c => c.sv.class.key === 'berserker';

    function power(c, o, ctx) {
      const T = ctx.terrain;
      let p = B.combatPower(c.sv, T) * (1 + c.temp.filter(e => e.id === 'power').reduce((t, e) => t + e.mag, 0));
      p *= (1 + effVs(c, 'power_vs', o)) * (1 - effVs(o, 'weakness', c) * 0.5);
      const magHeavy = o.sv.class.key === 'caster' || (o.sv.score.mag || 0) > (o.sv.score.str || 0);
      const def = clamp(eff(c, 'guard', T) * 0.5 + eff(c, 'evade', T) * 0.5 + (magHeavy ? eff(c, 'magic_guard', T) * 0.5 : 0), -0.5, 0.6) * (1 - Math.min(0.9, eff(o, 'pierce', T)));
      p *= 1 + def;
      p *= 1 - Math.min(0.5, eff(o, 'debuff', T) * clamp(1 - FX.mMindDebuff * md(c, 'mind'), 0.4, 1.5));
      if (ctx.home === c) p *= 1 + eff(c, 'territory', T) + c.workshop * 0.05;
      if (c.knowName.has(o.id)) p *= 1.08;
      p *= 0.55 + 0.45 * Math.max(0, c.hp) / 100;
      if (!c.masterAlive) p *= 0.9;
      else p *= 1 + FX.mCraftPower * md(c, 'craft');
      if (c.mana < 10) p *= 0.85;
      if (c.stance === 'all') p *= 1.05;
      if (c.boostUntil != null && c.boostUntil >= day) p *= 1 + 0.2 * (1 + FX.mMindCs * md(c, 'mind'));
      if (c.surprise) p *= 1 + c.surprise;
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
      if (c.ally != null) { camps[c.ally].ally = null; c.ally = null; }
      const head = !by || !fin ? `${nm(c)}が消滅した。${text}。`
        : fin.how === 'np' ? `${nm(by)}の宝具『${fin.np}』が勝敗を決定づけた。${nm(c)}は消滅した。`
        : fin.how === 'np-earlier' ? `宝具『${fin.np}』で追い詰めた${nm(by)}が、とどめを刺した。${nm(c)}は消滅した。`
        : fin.how === 'instakill' ? `${nm(by)}の一撃が霊核を穿ち、勝敗は決した。${nm(c)}は消滅した。`
        : `${nm(by)}がとどめを刺した。${nm(c)}は消滅した。`;
      log('death', head, [c.id].concat(by ? [by.id] : []), { quote: say(c, ['戦闘不能', '消滅', '退場']), big: true, fin: by && fin ? { by: by.id, how: fin.how, np: fin.np || null } : null });
      pubName.add(c.id);
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
      c.soloLeft = Math.floor(eff(c, 'solo'));
      log('death', `マスターの${mn(c)}が倒れた。${text}。`, [c.id].concat(by ? [by.id] : []), { big: true });
      if (c.you) c.gameOver = true;
      log('event', c.soloLeft > 0 ? `${nm(c)}は単独行動でしばらく現界を保てる（あと${c.soloLeft}日）。` : `要を失った${nm(c)}の現界は長くはもたない。`, [c.id]);
    }

    // 致命傷：踏みとどまる / 令呪 / 消滅
    function* lethal(l, w, cause, round) {
      const pierced = chance(Math.min(0.9, eff(w, 'pierce')));
      if (!pierced && chance(clamp(eff(l, 'guts') + l.bond / 500 + FX.endGuts * sd(l, 'end') + FX.lukGuts * sd(l, 'luk'), 0, 0.85))) {
        l.hp = 5 + rnd() * 10;
        log('battle', sd(l, 'end') >= 0.9 ? `致命の一撃を受けながら、${sn(l)}の頑強な霊基は崩れなかった。` : `致命の一撃を受けながら、${sn(l)}は踏みとどまった。`, [l.id, w.id]);
        return 'guts';
      }
      if (l.masterAlive && l.cs > 0) {
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
      const fin = ln && ln.round === round ? { how: 'np', np: ln.name } : ln ? { how: 'np-earlier', np: ln.name } : { how: cause === 'instakill' ? 'instakill' : 'blow' };
      servantDown(l, `${day}日目の夜、${nm(w)}${fin.how === 'np' ? 'の宝具『' + ln.name + '』に倒れた' : cause === 'instakill' ? 'の即死の一撃に倒れた' : 'との戦いに敗れた'}`, w, fin);
      return 'dead';
    }

    // ---------- 宝具 ----------
    function useNP(c, o, round, ctx) {
      if (!c.masterAlive && c.mana < 5) return;
      const nps = (c.sv.nps || []).filter(n => !n.disabled && c.mana >= npCostOf(c, n));
      if (!nps.length) return;
      const losing = power(c, o, ctx) < power(o, c, ctx);
      let p = 0.1 + (c.hp < 50 ? 0.25 : 0) + (round >= 2 ? 0.1 : 0) + (isBerserk(c) ? 0.15 : 0) + (losing ? 0.2 : 0) + (day > ENG.maxDays - ENG.finaleDays ? 0.2 : 0);
      if (c.stance === 'all') p += 0.35; else if (c.stance === 'careful') p -= 0.05; else if (c.stance === 'retreat') p -= 0.1;
      p += perv(c, 'np');
      if (!chance(p)) return;
      // どの宝具を使うか：威力だけで決めず、状況で重みを付けて選ぶ（複数の宝具を使い分ける）
      //   劣勢・瀕死・終盤 → 最大火力を優先 / 相手が弱っている・魔力が心もとない → 軽い宝具で足りる
      //   真名を知られていなければ、正体が露見しやすい宝具は控えめ / 自滅する宝具は追い詰められたときだけ
      const fx = (n, id) => (n.effects || []).filter(e => e.id === id).reduce((t, e) => t + e.mag, 0);
      const desperate = c.hp < 25, pressed = losing || c.hp < 40 || day > ENG.maxDays - ENG.finaleDays;
      const atkAll = nps.filter(n => n.attackResolved);
      const maxP = Math.max(1, ...atkAll.map(n => n.power)), minCost = Math.min(...nps.map(n => n.cost));
      const hidden = !o.knowName.has(c.id);
      const weight = n => {
        const retire = fx(n, 'self_retire');
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
      const np = nps[+wpick(ws)];
      c.mana -= npCostOf(c, np); c.npUses++;
      if (np.attackResolved) { c.npBoost = np.power * ENG.npPowerK * B.npStatMult(c.sv) * (np.burst > 1 ? 1 + (np.burst - 1) * rnd() * 0.5 : 1); c.lastNP = { name: np.name, round }; }
      else c.usedSup.add(np.name);
      for (const e of np.effects || []) if (!['master_buff', 'np_cost', 'self_retire', 'backfire', 'disabled'].includes(e.id)) c.temp.push(e);
      if (chance(0.3 + np.exposure * 0.7)) o.knowName.add(c.id); else clue(o, c, 2);
      if (np.exposure >= 1) pubName.add(c.id);
      if (np.exposure >= 0.8) witnessed.push(c.id);
      log('np', `${nm(c)}が宝具を解放した——『${np.name}』${np.reading ? '（' + np.reading + '）' : ''}！`, [c.id, o.id], { quote: sayNP(c, np), big: true });
      const bf = (np.effects || []).find(e => e.id === 'backfire');
      if (bf) { c.hp -= bf.mag * 40; log('battle', `反動が${sn(c)}自身を蝕む。`, [c.id]); }
      const sr = (np.effects || []).find(e => e.id === 'self_retire');
      if (sr && chance(sr.mag)) c.pendingRetire = np.name;
    }

    // ---------- 戦闘 ----------
    let witnessed = [];
    function* battle(a, b, ctx) {
      a.fought = b.fought = true; a.battles++; b.battles++;
      a.temp = []; b.temp = []; a.usedSup = new Set(); b.usedSup = new Set(); a.lastNP = b.lastNP = null;
      const where = ctx.home ? `${mn(ctx.home)}の拠点「${ctx.place.name}」` : ctx.place.name;
      log('battle', `${ctx.rain ? '雨の' : ''}${where}で、${nm(a)}と${nm(b)}が激突した。`, [a.id, b.id], { quote: say(a, ['開始', '戦闘開始']), head: true, place: ctx.place.name, scene: ctx.place.scene });
      clue(a, b, 1); clue(b, a, 1);
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
      for (let round = 1; round <= ENG.rounds; round++) {
        a.npBoost = b.npBoost = 0;
        // 退く戦い方なら最初に離脱を試みる
        for (const [c, o] of [[a, b], [b, a]]) if (c.stance === 'retreat' && round === 1 && chance(clamp(ENG.retreatBase + 0.25 + eff(c, 'escape', ctx.terrain) - eff(o, 'pin', ctx.terrain) * 0.8 + c.bond / 500 + FX.agiRetreat * (sd(c, 'agi') - sd(o, 'agi')), 0.05, 0.9))) {
          log('battle', `${sn(c)}は刃を交えずに退いた。`, [c.id, o.id]); cleanup(); return;
        }
        useNP(a, b, round, ctx);
        useNP(b, a, round, ctx);
        for (const c of [a, b]) if (c.pendingRetire) { const n = c.pendingRetire; c.pendingRetire = null; servantDown(c, `宝具『${n}』の代償で脱落した`); cleanup(); return; }
        let ea = power(a, b, ctx), eb = power(b, a, ctx);
        // 魅了：マスターの精神が強いと、呼びかけで正気を取り戻しやすい
        for (const [x, y] of [[a, b], [b, a]]) {
          if (!chance(eff(x, 'charm', ctx.terrain))) continue;
          if (!chance(clamp(eff(y, 'mental_guard', ctx.terrain) + FX.mMindCharm * md(y, 'mind'), 0, 0.95))) { if (y === b) eb *= 0.6; else ea *= 0.6; log('battle', `${sn(y)}の刃が一瞬鈍った。魅了だ。`, [x.id, y.id]); }
          else if (md(y, 'mind') >= 0.45 && !eff(y, 'mental_guard', ctx.terrain)) log('battle', `魅了に呑まれかけた${sn(y)}を、${mn(y)}の呼びかけが引き戻した。`, [y.id, x.id]);
        }
        const p = 1 / (1 + Math.exp(-(ea - eb) / G.CONFIG.BATTLE_K));
        const [w, l, ew, el] = chance(p) ? [a, b, ea, eb] : [b, a, eb, ea];
        let outcome = null;
        if (chance(Math.min(0.4, eff(w, 'instakill', ctx.terrain)) * Math.max(0, 1 - FX.lukInstakill * sd(l, 'luk')))) {
          log('battle', `${sn(w)}の一撃が、${sn(l)}の霊核を捉えた。`, [w.id, l.id]);
          l.hp = 0; outcome = yield* lethal(l, w, 'instakill', round);
        } else {
          let dmg = (ENG.dmgBase + rnd() * ENG.dmgVar) * (1 + clamp((ew - el) / (ew + el + 1), -0.3, 0.6));
          // 筋力の高い側ほど深く斬り込み、耐久の高い側ほど持ちこたえる
          dmg *= clamp(1 + FX.str * sd(w, 'str') - FX.end * sd(l, 'end'), 0.6, 1.5);
          const crit = chance(Math.max(0, eff(w, 'crit', ctx.terrain) + FX.lukCrit * sd(w, 'luk')));
          if (crit) dmg *= 1.5;
          if (!chance(eff(w, 'pierce', ctx.terrain))) dmg *= 1 - clamp(eff(l, 'guard', ctx.terrain) * 0.5, -0.5, 0.5);
          l.hp -= dmg; w.hp -= rnd() * 8;
          log('battle', `${round === 1 ? '' : round === ENG.rounds ? '最後の打ち合い。' : '再び刃が交わる。'}${crit ? 'クリティカルヒット。' : ''}${sn(w)}が押し勝ち、${sn(l)}は${dmg > 32 ? '深手を負った' : '傷を負った'}。`, [w.id, l.id]);
          if (l.hp <= 0) outcome = yield* lethal(l, w, 'battle', round);
          if (w.hp <= 0 && w.alive && outcome !== 'dead') { const o2 = yield* lethal(w, l, 'battle', round); if (o2 !== 'guts' && o2 !== 'rallied') outcome = outcome || o2; }
        }
        if (outcome === 'dead' || outcome === 'escaped' || !a.alive || !b.alive) break;
        // まれに、勝った側の刃が相手のマスターに届く（気配を断てるサーヴァントや暗殺を好むマスターほど起きやすい）
        if (l.masterAlive && w.alive) {
          const pm = (ENG.masterStrike + eff(w, 'anti_master') * 0.3 + Math.max(0, perv(w, 'ambush')) * 0.03) * (1 - clamp(eff(l, 'master_guard') + (ctx.home === l ? l.workshop * 0.04 : 0) + FX.mLuckHide * md(l, 'luck'), 0, 0.8));
          if (chance(Math.min(0.15, pm))) {
            l.mhp -= 30 + rnd() * 50 - l.master.stats.body * 0.3;
            if (l.mhp <= 0) {
              if (l.cs > 0 && chance(clamp(ENG.csSaveMaster + FX.mMindSeal * md(l, 'mind'), 0, 0.95))) { l.cs--; l.mhp = 6; log('cs', `${sn(w)}の刃がマスターの${mn(l)}に迫る——令呪の光が、すんでのところで${mn(l)}を守った。（残り${l.cs}画）`, [l.id, w.id], { big: true }); }
              else { log('battle', `乱戦の中、${sn(w)}の刃がマスターの${mn(l)}に届いた。`, [w.id, l.id], { big: true }); masterDown(l, `${day}日目の夜、${nm(w)}との戦いの最中だった`, w); break; }
            } else log('battle', `${sn(w)}の一撃がマスターの${mn(l)}をかすめた。${mn(l)}は深手を負った。`, [w.id, l.id]);
          }
        }
        // 撤退
        const weaker = a.hp < b.hp ? a : b, other = weaker === a ? b : a;
        const threshold = (weaker.stance === 'careful' ? ENG.retreatAt + 10 : weaker.stance === 'all' ? ENG.retreatAt - 15 : ENG.retreatAt) + perv(weaker, 'retreat') * 30;
        if (weaker.hp < threshold || (weaker === l && p < 0.3 && weaker.hp < 60) || weaker.stance === 'retreat') {
          const ctrl = isBerserk(weaker) && chance(0.5) ? -0.2 : 0;
          const agi = sd(weaker, 'agi') - sd(other, 'agi');
          if (chance(clamp(ENG.retreatBase + eff(weaker, 'escape', ctx.terrain) - eff(other, 'pin', ctx.terrain) * 0.8 + ctrl + weaker.bond / 500 + (weaker.stance === 'careful' ? 0.1 : 0) + perv(weaker, 'retreat') * 0.5 + FX.agiRetreat * agi, 0.05, 0.9))) {
            log('battle', agi >= 0.6 ? `${sn(weaker)}は持ち前の速さで${sn(other)}を振り切った。` : `${sn(weaker)}は退いた。${sn(other)}は深追いしなかった。`, [weaker.id, other.id]); break;
          } else if (eff(other, 'pin', ctx.terrain) > 0.1) log('battle', `退こうとした${sn(weaker)}の行く手を、${sn(other)}が阻んだ。`, [weaker.id, other.id]);
          else if (agi <= -0.6) log('battle', `退こうとした${sn(weaker)}に、${sn(other)}の速さが追いすがった。`, [weaker.id, other.id]);
        }
        if (round === ENG.rounds) log('battle', '夜明けが近づき、両者は刃を収めた。', [a.id, b.id]);
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
      function cleanup() { a.temp = []; b.temp = []; a.npBoost = b.npBoost = 0; a.stance = b.stance = null; a.surprise = b.surprise = 0; a.lastNP = b.lastNP = null; }
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
      const sv = c.sv, pf = sv.profile || {}, v = sv.voice || {};
      const opt = {};
      if (pf.likes) opt.meal = 3;
      if ((v['会話'] || []).length) opt.talk = 3;
      if (sv.text && sv.text.commentary && c.dreams < 2) opt.dream = c.dreams === 0 ? 3 : 1.5;
      if (pf.dislikes && !c.lifeSeen.has('dislike')) opt.dislike = 1.5;
      if ((v['聖杯について'] || []).length || pf.wish) opt.grail = c.lifeSeen.has('grail') ? 0.3 : 2;
      if ((v['好きなこと'] || v['嫌いなこと'] || []).length) opt.likes = 1.5;
      if (c.bond >= 70 && (v['絆'] || []).length && !c.lifeSeen.has('bondv')) opt.bondv = 3;
      opt.outing = 1; opt.master = 1.5;
      const k = wpick(opt); c.lifeSeen.add(k === 'bondv' ? 'bondv' : k);
      const S = sn(c), M = mn(c);
      if (k === 'meal') { bondUp(c, 5); c.hp = Math.min(100, c.hp + 5); log('life', `${M}は${S}と食卓を囲んだ。${S}の好きなものは「${pf.likes}」らしい。`, [c.id]); }
      else if (k === 'talk') { bondUp(c, 4); log('life', `夜更け、${S}がぽつりと話しかけてきた。`, [c.id], { quote: say(c, ['会話']) }); }
      else if (k === 'dream') { c.dreams++; bondUp(c, 8); log('life', `${M}は夢を見た。遠い昔の、${S}の記憶——${firstSentence(sv.text.commentary, 70)}。`, [c.id]); }
      else if (k === 'dislike') { bondUp(c, 1); log('life', `${S}が露骨に顔をしかめた。どうやら「${pf.dislikes}」が苦手らしい。`, [c.id]); }
      else if (k === 'grail') { bondUp(c, 3); const q = say(c, ['聖杯について']); log('life', `${M}は${S}に、聖杯に何を願うのか尋ねた。` + (q ? '' : `答えは「${pf.wish}」だった。`), [c.id], { quote: q }); }
      else if (k === 'likes') { bondUp(c, 3); log('life', `何気ない会話の中で、${S}の好みが少し分かった。`, [c.id], { quote: say(c, ['好きなこと', '嫌いなこと']) }); }
      else if (k === 'bondv') { bondUp(c, 5); log('life', `${S}が${M}の隣に立った。`, [c.id], { quote: say(c, ['絆']) }); }
      else if (k === 'master') {
        const t = { civilian: `${M}は久しぶりに学校へ顔を出した。日常は、まだそこにあった。`, noble: `${M}は家の書庫で、聖杯戦争の古い記録を読み返した。`, mercenary: `${M}は武器と礼装の手入れに一日を費やした。`, newblood: `${M}は工房で新しい術式を試した。`, irregular: `${M}は自分の異能を確かめるように、街の外れを歩いた。` }[c.master.origin] || `${M}は静かに一日を過ごした。`;
        c.mana = Math.min(c.manaMax, c.mana + 5); log('life', t, [c.id]);
      } else if (k === 'outing') {
        if (chance(0.6)) { bondUp(c, 8); c.wander = true; log('life', `${S}にせがまれて、${M}は昼の街を一緒に歩いた。${S}は何を見ても楽しそうだった。`, [c.id]); }
        else { bondUp(c, -2); log('life', `街に出たがる${S}を、${M}はなだめて拠点に留めた。`, [c.id]); }
      }
    }

    // ---------- 街の出来事 ----------
    function* worldEvent() {
      const alive = active();
      const o = { leyline: 2, rain: 2, moon: 1.5, familiar: 2, festival: 0.8 };
      if (witnessed.length) o.witness = 4;
      const bountyCand = alive.filter(c => !c.bounty && (c.kills.length >= 2 || c.warned >= 2));
      if (day >= 4 && bountyCand.length && !camps.some(c => c.bounty && c.alive)) o.bounty = 3;
      if (you && you.alive && you.masterAlive && alive.length > 2) o.spot = 1.2;
      const k = wpick(o);
      if (k === 'leyline') { for (const c of alive) c.mana = Math.min(c.manaMax, c.mana + 25); log('world', `${city}の霊脈が騒いでいる。どの陣営にも魔力が満ちた。`, []); }
      else if (k === 'rain') { tonight.rain = true; log('world', '夕方から雨になった。今夜はどこもかしこも水辺だ。', []); }
      else if (k === 'moon') { tonight.moon = true; log('world', '今夜は満月。英霊たちの血がざわめく。', []); }
      else if (k === 'festival') { tonight.calm = true; log('world', '街は祭りで賑わっている。人目が多すぎて、今夜はどの陣営も動けないだろう。', []); }
      else if (k === 'familiar') {
        const a = pick(alive), t = pick(alive.filter(x => x !== a));
        if (t) { a.knowLoc.add(t.id); if (a.you) log('scout', `放っていた使い魔が、${t.label}の拠点「${t.base.name}」を見つけた。`, [a.id, t.id]); else if (t.you) log('world', `拠点の周りを使い魔がうろついていた。どこかの陣営に見つかったかもしれない。`, [t.id]); else log('world', '夜の街を、誰かの使い魔が飛んでいく。', []); }
      } else if (k === 'witness') {
        const id = pick(witnessed); witnessed = [];
        const c = camps[id];
        if (c && c.alive) { c.warned++; log('world', `昨夜の宝具の光は街の人々に目撃された。監督役が隠蔽に奔走し、${c.label}の陣営に警告を出した。`, [c.id]); }
      } else if (k === 'bounty') {
        const t = pick(bountyCand); t.bounty = true;
        log('world', `監督役が${nm(t)}に討伐令を出した。討ち取った陣営には追加の令呪が与えられる。`, [t.id], { big: true });
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
            { k: 'talk', label: '声をかける', sub: you.ally == null && alive.length > ENG.allianceBreakAt + 1 ? '同盟の話を持ちかける' : '探りを入れる' },
            { k: 'follow', label: '尾行する', sub: '拠点を突き止めたい。気づかれる危険もある' },
            { k: 'ignore', label: '見逃す', sub: '関わらない' },
          ],
        }, () => wpick({ talk: 1, follow: 1, ignore: 1 }));
        if (a === 'talk') {
          if (you.ally == null && t.ally == null && alive.length > ENG.allianceBreakAt + 1 && chance(clamp(0.2 + eff(you, 'negotiate') + eff(t, 'negotiate') * 0.5, 0, 0.85))) {
            you.ally = t.id; t.ally = you.id; log('ally', `${mn(you)}と${mn(t)}は喫茶店で向かい合い、手を組むことにした。${nm(you)}と${nm(t)}の同盟だ。`, [you.id, t.id], { big: true });
          } else { if (chance(0.4)) you.knowName.add(t.id); log('event', `${mn(you)}は${mn(t)}と言葉を交わした。${you.knowName.has(t.id) ? `話の端々から、${t.label}の真名は「${t.sv.trueName}」だと察しがついた。` : '腹の探り合いに終わった。'}`, [you.id, t.id]); }
        } else if (a === 'follow') {
          if (chance(0.7 - eff(t, 'detect') * 0.5)) { you.knowLoc.add(t.id); log('scout', `尾行は成功した。${t.label}の拠点は「${t.base.name}」だ。`, [you.id, t.id]); }
          else { t.knowLoc.add(you.id); log('event', `尾行は気づかれた。逆にこちらの拠点を知られたかもしれない。`, [you.id, t.id]); }
        } else log('event', `${mn(you)}は見なかったことにした。`, [you.id]);
      }
    }

    // ---------- 昼 ----------
    let lastCouncil = 0;
    const focusOf = c => c.you && c.focus && c.focus !== 'auto' && FOCUS[c.focus] ? FOCUS[c.focus] : null;

    const deduceP = (c, t) => clamp(0.08 + (c.clues[t.id] || 0) * 0.12 + eff(c, 'reveal') + eff(c, 'intel') * 0.5 + c.master.stats.craft / 500 - eff(t, 'conceal') * 0.5, 0.03, 0.9);

    // はぐれサーヴァント（c）と、サーヴァントを失ったマスター（m）の再契約
    function contract(c, m, how) {
      c.master = m.master; c.masterAlive = true; c.mhp = m.mhp || Math.round(m.mhpMax * 0.7); c.mhpMax = m.mhpMax; c.cs = m.cs; c.manaMax = m.manaMax; c.mana = Math.round(m.manaMax * 0.5); c.soloLeft = null; c.bond = 20;
      m.merged = true; m.inChurch = false; m.fate = { day, text: (m.fate ? m.fate.text + '。' : '') + `${day}日目、マスターは${c.label}と再契約した` };
      if (m.you) moveYou(m, c);
      log('ally', how || `主を失った${nm(c)}と、サーヴァントを失った${mn(c)}が手を結んだ。再契約だ。`, [c.id, m.id], { big: true });
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
      const enemies = alive.filter(t => t !== c && t.ally !== c.id);
      const cand = [];
      const knownT = enemies.filter(t => c.knowLoc.has(t.id));
      if (knownT.length) {
        const t = knownT.reduce((a, b) => (a.hp / Math.max(5, a.sv.power) < b.hp / Math.max(5, b.sv.power) ? a : b));
        cand.push({ w: 3, o: { k: 'assault:' + t.id, label: `${t.label}${known(t) ? '「' + t.sv.trueName + '」' : ''}の拠点に総攻撃をかける`, sub: `今夜、準備を整えて「${t.base.name}」へ攻め込む（戦闘力+15%）` } });
      }
      if (c.cs >= 2) cand.push({ w: 1.5, o: { k: 'boost', label: '令呪を一画使い、霊基を強化する', sub: `3日間、戦闘力+20%（令呪 残り${c.cs}画）` } });
      if (camps.some(t => t !== c && t.alive && t.knowLoc.has(c.id))) cand.push({ w: 2.5, o: { k: 'move', label: '拠点を移す', sub: '居場所を知られている。工房は一から作り直し' } });
      if (c.ally == null && alive.length > ENG.allianceBreakAt + 1) {
        const t = pick(enemies.filter(x => x.ally == null && x.masterAlive));
        if (t) cand.push({ w: 2, o: { k: 'ally:' + t.id, label: `${t.label}${known(t) ? '「' + t.sv.trueName + '」' : ''}に同盟を申し込む`, sub: '残り3騎になるまで互いを襲わない' } });
      }
      if (c.ally != null && alive.length <= ENG.allianceBreakAt + 1) { const t = camps[c.ally]; cand.push({ w: 3, o: { k: 'betray', label: `同盟を破り、${t.label}に奇襲をかける`, sub: '今夜、油断した同盟相手を討つ（戦闘力+20%）' } }); }
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
        if (chance(clamp(0.25 + eff(c, 'negotiate') + eff(t, 'negotiate') * 0.5 + (t.policy === 'diplomacy' ? 0.15 : 0), 0, 0.85))) { c.ally = t.id; t.ally = c.id; c.knowName.add(t.id); log('ally', `${mn(t)}は申し出を受けた。${nm(c)}と${nm(t)}の同盟だ。`, [c.id, t.id], { big: true }); }
        else log('council', `${mn(t)}は申し出を断った。`, [c.id, t.id]);
      } else if (k === 'betray') { const t = camps[c.ally]; c.ally = null; t.ally = null; c.assault = t.id; c.betray = true; bondUp(c, -5); log('council', `${mn(c)}は同盟を破ることに決めた。今夜、${t.label}を討つ。`, [c.id, t.id], { big: true }); }
      else if (k.startsWith('deduce:')) {
        const t = camps[+k.split(':')[1]];
        if (chance(deduceP(c, t))) { c.knowName.add(t.id); log('scout', `これまでの手がかりを突き合わせ、${mn(c)}は${t.label}の真名にたどり着いた——「${t.sv.trueName}」。`, [c.id, t.id], { big: true }); }
        else { clue(c, t, 1); log('council', `${t.label}の真名を推理したが、決め手に欠けた。もう少し手がかりが要る。`, [c.id, t.id]); }
      } else if (k === 'familiar') {
        c.mana -= 20;
        const t = pick(enemies.filter(x => !c.knowLoc.has(x.id)));
        if (t && chance(clamp(0.45 + eff(c, 'intel') + eff(c, 'craft') * 0.5 + c.master.stats.craft / 400 - eff(t, 'stealth') * 0.5, 0.1, 0.9))) { c.knowLoc.add(t.id); log('scout', `放った使い魔が、${t.label}の拠点「${t.base.name}」を見つけた。`, [c.id, t.id]); }
        else log('council', '使い魔は手がかりを持ち帰れなかった。', [c.id]);
      } else if (k === 'recover') { c.mana = c.manaMax; c.hp = Math.min(100, c.hp + 30); c.restNight = true; log('council', `${sn(c)}は霊脈の上で力を蓄えた。`, [c.id]); }
    }
    function* dayPhase() {
      phase = 'day';
      tonight = {};
      const alive = active();
      if (alive.length <= ENG.allianceBreakAt) for (const c of alive) if (c.ally != null) {
        const o = camps[c.ally]; c.ally = null; o.ally = null;
        log('ally', `残りが${alive.length}騎となり、${nm(c)}と${nm(o)}の同盟は解消された。`, [c.id, o.id]);
      }
      // 終盤、同盟を破る陣営（性格による）
      if (alive.length <= ENG.allianceBreakAt + 1) for (const c of alive) if (c.ally != null && !c.you && c.masterAlive && chance(perv(c, 'betray') * 0.5)) {
        const t = camps[c.ally]; c.ally = null; t.ally = null; c.assault = t.id; c.betray = true;
        log('ally', `${mn(c)}が同盟を破った。今夜、${t.label}を討つつもりだ。`, [c.id, t.id], { big: true });
      }
      if (chance(ENG.eventChance)) yield* worldEvent();

      // 作戦会議（大きな決断）。数日ごと
      if (you && you.alive && you.masterAlive && day - lastCouncil >= ENG.councilEvery) { lastCouncil = day; yield* council(); }

      for (const c of shuffle(alive)) {
        c.hunting = c.hidden = c.wander = c.fought = false;
        bondUp(c, 0.5);
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
          scout: 1 + (eff(c, 'intel') + eff(c, 'detect')) * 3,
          fortify: c.workshop >= 5 ? 0.1 : 0.5 + eff(c, 'territory') * 4 + eff(c, 'craft') * 3 + (c.sv.class.key === 'caster' ? 1 : 0),
          rest: 0.3 + (100 - c.hp) / 30 + (c.mana < c.manaMax * 0.4 ? 1.5 : 0),
          ally: alive.length > ENG.allianceBreakAt + 1 && c.ally == null && c.masterAlive ? Math.max(0, 0.3 + Math.max(0, eff(c, 'negotiate')) * 3 + perv(c, 'ally') * 2) : 0,
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
        const cost = ENG.upkeep * Math.max(0.3, 1 + eff(c, 'upkeep_up') - eff(c, 'upkeep_down'));
        c.mana = Math.min(c.manaMax, c.mana + ENG.manaRegen + c.master.stats.mana * 0.15 + c.workshop * 2) - cost;
        if (c.mana < 0) { c.mana = 0; c.hp -= 8; log('day', `${mn(c)}の魔力が尽きかけ、${sn(c)}の霊基が揺らいでいる。`, [c.id]); if (c.hp <= 0) servantDown(c, `魔力が尽き、${day}日目に消滅した`); }
        c.mhp = Math.min(c.mhpMax, c.mhp + 5);
      }
    }

    function* doAct(c, act, alive) {
      if (act === 'scout') {
        const t = pick(alive.filter(x => x !== c && x.alive)); if (!t) return;
        if (chance(clamp(0.35 + eff(c, 'intel') + eff(c, 'detect') * 0.5 - eff(t, 'stealth') * 0.6 + FX.mCraftScout * md(c, 'craft'), 0.05, 0.9))) {
          const newLoc = !c.knowLoc.has(t.id); c.knowLoc.add(t.id);
          const nameHit = !c.knowName.has(t.id) && chance(clamp(0.08 + eff(c, 'reveal') + eff(c, 'intel') * 0.3 - eff(t, 'conceal') * 0.6, 0, 0.7));
          if (nameHit) c.knowName.add(t.id); else clue(c, t, 1);
          if (c.ally != null) { camps[c.ally].knowLoc.add(t.id); if (nameHit) camps[c.ally].knowName.add(t.id); }
          if (c.you && (newLoc || nameHit)) log('scout', `偵察の結果、${t.label}の拠点は「${t.base.name}」だと突き止めた。` + (nameHit ? `さらに真名が「${t.sv.trueName}」だと分かった。` : ''), [c.id, t.id]);
          else if (c.you) log('day', `${sn(c)}は街を偵察した。目新しい手がかりはなかった。`, [c.id]);
        } else if (c.you) log('day', `${sn(c)}は街を偵察したが、手がかりは得られなかった。`, [c.id]);
      } else if (act === 'fortify') {
        if (chance(clamp(0.5 + eff(c, 'territory') + eff(c, 'resource') * 0.5 + FX.mCraftFort * md(c, 'craft'), 0.2, 0.95))) {
          c.workshop = Math.min(5, c.workshop + 1);
          if (c.you || c.workshop >= 3) log('day', `${sn(c)}の陣営は拠点「${c.base.name}」の守りを固めた（工房${c.workshop}）。`, [c.id]);
        } else if (c.you) log('day', `拠点の強化は思うように進まなかった。`, [c.id]);
        if (chance(eff(c, 'craft'))) { c.items++; if (c.you) log('day', `${sn(c)}が戦いに役立つ道具を用意した。`, [c.id]); }
      } else if (act === 'rest') {
        c.hp = Math.min(100, c.hp + ENG.restHeal + eff(c, 'regen') * 60);
        c.mhp = Math.min(c.mhpMax, c.mhp + 15 + eff(c, 'heal_other') * 60);
        c.mana = Math.min(c.manaMax, c.mana + 10);
        if (c.you) log('day', `${sn(c)}の陣営は拠点で傷と魔力の回復に努めた。`, [c.id]);
      } else if (act === 'ally') {
        const cand = alive.filter(x => x !== c && x.alive && x.ally == null && x.masterAlive);
        if (!cand.length) return;
        const t = pick(cand);
        const p = clamp(0.12 + eff(c, 'negotiate') + eff(t, 'negotiate') * 0.5 + (t.policy === 'diplomacy' ? 0.15 : 0) + perv(t, 'ally'), 0, 0.8);
        // 申し込まれた側がプレイヤーなら、受けるかどうかを聞く
        const accept = t.you ? (yield* ask(t, 'ally', {
          title: '同盟の申し出',
          body: `${c.label}${known(c) ? '「' + c.sv.trueName + '」' : ''}のマスター、${mn(c)}から同盟の申し出があった。`,
          options: [{ k: 'yes', label: '受ける', sub: '互いに襲わず、情報を分け合う。残り3騎で解消' }, { k: 'no', label: '断る', sub: '一人で戦う' }],
        }, () => chance(p) ? 'yes' : 'no')) === 'yes' : chance(p);
        if (accept) { c.ally = t.id; t.ally = c.id; if (t.you) t.knowName.add(c.id); log('ally', `${mn(c)}と${mn(t)}が手を組んだ。${nm(c)}と${nm(t)}の同盟だ。`, [c.id, t.id], { big: c.you || t.you }); }
        else if (c.you) log('day', `${mn(c)}は${t.label}の陣営に同盟を持ちかけたが、断られた。`, [c.id, t.id]);
        else if (t.you) log('day', `${mn(t)}は${c.label}の陣営からの申し出を断った。`, [t.id, c.id]);
      } else if (act === 'hide') {
        c.hidden = true;
        if (c.you) log('day', `${sn(c)}の陣営は気配を殺し、息を潜めた。`, [c.id]);
      }
    }

    // ---------- 夜 ----------
    function* nightPhase() {
      phase = 'night';
      const alive = active();
      if (alive.length <= 1) return;
      if (tonight.calm) return;
      const avg = alive.reduce((t, c) => t + c.sv.power, 0) / alive.length;
      const finale = day > ENG.maxDays - ENG.finaleDays;
      for (const c of alive) {
        const P = POLICIES[c.policy] || POLICIES.balanced;
        let p = ENG.huntBase + (c.sv.power - avg) / 60 + (isBerserk(c) ? 0.2 : 0) + (c.hp < 40 ? -0.3 : 0) + (finale ? 0.4 : 0) + (!c.masterAlive ? 0.2 : 0) + (c.hidden ? -0.2 : 0) + P.hunt + perv(c, 'hunt') + (tonight.moon ? 0.2 : 0) - c.warned * 0.15 + (c.targetPref != null ? 0.15 : 0);
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
        const targets = active().filter(t => t !== h && !t.fought && t.ally !== h.id);
        if (!targets.length) continue;
        let t = null;
        const fixed = h.assault != null ? camps[h.assault] : h.targetPref != null ? camps[h.targetPref] : null;
        if (fixed && targets.includes(fixed)) t = fixed;
        else {
          const tw = {};
          for (const x of targets) tw[x.id] = 1 + (h.knowLoc.has(x.id) ? 2 : 0) + clamp(h.sv.power / Math.max(5, x.sv.power) - 1, -0.5, 1.5) + (x.hp < 50 ? 0.5 : 0) + (related(h, x) ? 2 : 0) + (x.bounty ? 1.5 : 0);
          t = camps[+wpick(tw)];
        }
        if (h.targetPref != null && !camps[h.targetPref].alive) h.targetPref = null;
        const assault = h.assault != null && t.id === h.assault;
        h.assault = null;
        const pf = assault ? 0.95 : clamp(ENG.findBase + eff(h, 'detect') * 0.8 + (h.knowLoc.has(t.id) ? 0.3 : 0) + (t.hunting ? 0.15 : 0) + (t.wander ? 0.2 : 0) - eff(t, 'stealth') * 0.7 - (t.hidden ? 0.2 : 0)
          + FX.agiFind * (sd(h, 'agi') - sd(t, 'agi')) - FX.mLuckHide * md(t, 'luck'), 0.05, 0.95);
        if (!chance(pf)) { if (h.you) log('night', `${sn(h)}は夜の街を巡ったが、敵の気配はつかめなかった。`, [h.id]); continue; }
        any = true;
        const home = t.hunting ? null : t;
        const place = home ? t.base : pick(W.places);
        if (!home) t.knowLoc.add(h.id);
        if (home && t.masterAlive && chance(Math.min(0.6, eff(h, 'anti_master') * 1.5 + Math.max(0, perv(h, 'ambush')) * 0.12))) {
          h.fought = t.fought = true;
          if (yield* ambushMaster(h, t)) { yield* checkFallen(); continue; }
        }
        if (assault) { h.surprise = h.betray ? 0.2 : 0.15; h.betray = false; }
        yield* battle(h, t, { place, home, terrain: tonight.rain ? '水辺' : place.terrain, rain: tonight.rain });
        yield* checkFallen();
      }
      if (!any && you && you.alive && !entries.some(e => e.day === day && e.phase === 'night')) log('night', '静かな夜だった。どこかで誰かが、息を潜めている。', []);
    }

    // ---------- 開幕 ----------
    log('prologue', `${city}。七騎の英霊が呼ばれ、聖杯戦争が始まる。`, [], { head: true });
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
      if (!finaleAnnounced && day > ENG.maxDays - ENG.finaleDays) { finaleAnnounced = true; log('event', '聖杯の降臨が近い。残るサーヴァントたちが動き出した。', [], { big: true }); }
      yield* dayPhase();
      yield* checkFallen();
      if (active().length > 1) yield* nightPhase();
      yield* checkFallen();
      for (const c of camps) { c.temp = []; c.npBoost = 0; }
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
    if (left.length === 1) {
      winner = left[0];
      const wish = (winner.sv.profile && winner.sv.profile.wish) || null;
      log('end', `${day}日目。最後に残ったのは${nm(winner)}と、マスターの${winner.masterAlive ? mn(winner) : '（なし）'}だった。聖杯が降臨する。`, [winner.id], { big: true, quote: say(winner, ['聖杯について', '勝利']) });
      log('end', (winner.masterAlive ? `${mn(winner)}の願いは「${winner.master.wish}」。` : '') + (wish ? `${nm(winner)}の願いは「${wish}」。` : ''), [winner.id]);
    } else if (!left.length) log('end', `${day}日目。最後の二騎は相討ちとなり、聖杯を手にする者はいなかった。`, [], { big: true });
    else log('end', `${ENG.maxDays}日が過ぎても決着はつかなかった。${left.map(nm).join('、')}を残したまま、聖杯は姿を消した。`, left.map(c => c.id), { big: true });
    for (const c of camps) pubName.add(c.id);
    for (const c of left) c.fate = { day, text: c === winner ? '勝者' : '生き残った' };
    log('end', '——聖杯戦争、終結。', [], { head: true });

    const result = {
      seed, city, days: day,
      you: you ? you.id : null,
      winner: winner ? winner.id : null,
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
