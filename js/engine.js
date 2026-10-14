/* 聖杯戦争の進行（全自動）
 *
 *   const war = HGW.engine.runWar({ roster, seed: 'abc' });
 *   war.entries … 起きたことの記録（日・場面・本文・その時点の各陣営の状態）
 *   war.result  … 勝者・各陣営の結末
 *
 * 同じシード・同じ名簿なら毎回同じ戦争になる。
 * プレイヤーの判断を挟めるように、選択はすべて decide() を通している（今は全部自動）。
 * 数値の調整は config.js の ENGINE で行う。
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

  function runWar(opts) {
    opts = opts || {};
    const ENG = Object.assign({}, G.CONFIG.ENGINE, opts.engine || {});
    const seed = opts.seed || Math.random().toString(36).slice(2, 8);
    const rnd = makeRng(seed);
    const chance = p => rnd() < p;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const wpick = o => { let t = 0; for (const k in o) t += Math.max(0, o[k]); let x = rnd() * t; for (const k in o) { x -= Math.max(0, o[k]); if (x <= 0) return k; } return Object.keys(o)[0]; };
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // 判断の窓口。いまは全部自動（wpick）。プレイヤーの介入はここに差し込む
    const decide = (camp, kind, weights) => (opts.decide && opts.decide(camp, kind, weights)) || wpick(weights);

    const roster = (opts.roster || []).filter(s => s && s.score);
    if (roster.length < 2) throw new Error('サーヴァントが2騎以上必要です');

    // ---------- 舞台と陣営 ----------
    const W = G.WORLD, N = G.NAMES;
    const city = opts.city || pick(W.cities);
    const places = shuffle(W.places);
    const comp = G.war.composeWar(roster, rnd).filter(x => x.servant);
    const labelCount = {};
    const camps = comp.map((x, i) => {
      const sv = JSON.parse(JSON.stringify(x.servant));
      // 範囲ランク（C～A など）をこの戦争用に確定
      for (const k of B.STAT_KEYS) if (sv.ranks[k] && sv.ranks[k].range) { sv.ranks[k] = R.rollRange(sv.ranks[k], rnd); sv.score[k] = sv.ranks[k].score; }
      sv.power = B.combatPower(sv);
      const def = G.classDef(sv.class.key);
      const base = def.slot === 'extra' && sv.class.key === 'extra' ? sv.class.label : def.label;
      labelCount[base] = (labelCount[base] || 0) + 1;
      const preset = opts.masters && opts.masters.length && chance(0.5) ? opts.masters.splice(Math.floor(rnd() * opts.masters.length), 1)[0] : null;
      const m = G.master.createMaster(preset || {}, rnd);
      if (!m.name) m.name = makeName(m);
      m.wish = m.wish || pick(G.WISHES);
      const c = {
        id: i, slot: x.slot, substitute: x.substitute, extra: x.extra, sv, master: m, labelBase: base, label: base,
        hp: 100, mhp: 0, mhpMax: 0, mana: 0, manaMax: 0, cs: m.commandSpells,
        alive: true, masterAlive: true, out: false, fate: null, soloLeft: null, inChurch: false, merged: false,
        base: places[i % places.length], workshop: m.resources.workshop || 0, items: 0, ally: null,
        knowName: new Set([i]), knowLoc: new Set([i]), temp: [], npBoost: 0, kills: [], npUses: 0, battles: 0,
        hunting: false, hidden: false, wander: false, fought: false,
      };
      c.mhpMax = c.mhp = Math.round(50 + m.stats.body * 0.8);
      c.manaMax = Math.round(ENG.manaBase + m.stats.mana);
      c.mana = c.manaMax;
      // 消滅後も続く宝具などの、マスターへの常時効果
      for (const e of Object.values(sv.effectSummary || {})) if (e.id === 'master_buff' && e.params && e.params.stat && e.passive) m.stats[e.params.stat] = (m.stats[e.params.stat] || 0) + e.passive;
      return c;
    });
    // 同じ表示名のクラスが複数いるとき（代役など）は番号を付ける
    const seenLabel = {};
    for (const c of camps) if (labelCount[c.labelBase] > 1) { seenLabel[c.labelBase] = (seenLabel[c.labelBase] || 0) + 1; c.label = c.labelBase + '（' + '一二三四五六七'[seenLabel[c.labelBase] - 1] + '）'; }
    let you = opts.player === 'none' ? null : camps[opts.player != null ? opts.player : Math.floor(rnd() * camps.length)];
    if (you) you.you = true;
    const pubName = new Set();

    function makeName(m) {
      const west = m.origin === 'noble' ? chance(0.5) : m.origin === 'civilian' ? chance(0.1) : chance(0.35);
      const female = /女/.test(m.sex);
      return west ? pick(female ? N.westFemale : N.westMale) + '・' + pick(N.westSurname) : pick(N.jpSurname) + ' ' + pick(female ? N.jpFemale : N.jpMale);
    }

    // ---------- 記録 ----------
    const entries = [];
    let day = 0, phase = 'prologue';
    const known = c => !you || c.you || you.knowName.has(c.id) || pubName.has(c.id);
    const nm = c => known(c) ? `${c.label}「${c.sv.trueName}」` : c.label;
    const mn = c => c.master.name;
    const snap = () => camps.map(c => ({
      id: c.id, label: c.label, name: known(c) ? c.sv.trueName : null, cls: c.sv.class.label,
      hp: Math.max(0, Math.round(c.hp)), mhp: Math.max(0, Math.round(c.mhp / c.mhpMax * 100)), mana: Math.round(c.mana / c.manaMax * 100),
      alive: c.alive, masterAlive: c.masterAlive, master: mn(c), cs: c.cs, ally: c.ally, workshop: c.workshop, you: !!c.you, out: c.out,
      fate: c.fate ? c.fate.text : null, soloLeft: c.soloLeft,
    }));
    function log(kind, text, ids, extra) {
      ids = ids || [];
      const e = Object.assign({ day, phase, kind, text, ids, you: !!you && ids.includes(you.id) }, extra || {});
      e.snap = snap();
      entries.push(e);
      return e;
    }
    const voice = (c, keys) => {
      for (const k of keys) { const v = c.sv.voice && c.sv.voice[k]; if (v && v.length) return pick(v); }
      return null;
    };
    const say = (c, keys) => { const v = voice(c, keys); return v ? { who: nm(c), text: v } : null; };

    // ---------- 効果の参照 ----------
    function eff(c, id, terrain) {
      let t = 0;
      for (const x of Object.values(c.sv.effectSummary || {})) if (x.id === id && (!x.params || !x.params.cond || x.params.cond === terrain)) t += x.passive;
      for (const e of c.temp) if (e.id === id && (!e.params || !e.params.cond || e.params.cond === terrain)) t += e.mag;
      return t;
    }
    const effVs = (c, id, o) => Object.values(c.sv.effectSummary || {}).filter(x => x.id === id && x.params && o.sv.tags.includes(x.params.tag)).reduce((t, x) => t + x.passive, 0)
      + c.temp.filter(e => e.id === id && e.params && o.sv.tags.includes(e.params.tag)).reduce((t, e) => t + e.mag, 0);
    const active = () => camps.filter(c => c.alive);
    const isBerserk = c => c.sv.class.key === 'berserker';

    function power(c, o, ctx) {
      const T = ctx.terrain;
      let p = B.combatPower(c.sv, T) * (1 + c.temp.filter(e => e.id === 'power').reduce((t, e) => t + e.mag, 0));
      p *= (1 + effVs(c, 'power_vs', o)) * (1 - effVs(o, 'weakness', c) * 0.5);
      const magHeavy = o.sv.class.key === 'caster' || (o.sv.score.mag || 0) > (o.sv.score.str || 0);
      const def = clamp(eff(c, 'guard', T) * 0.5 + eff(c, 'evade', T) * 0.5 + (magHeavy ? eff(c, 'magic_guard', T) * 0.5 : 0), -0.5, 0.6) * (1 - Math.min(0.9, eff(o, 'pierce', T)));
      p *= 1 + def;
      p *= 1 - Math.min(0.5, eff(o, 'debuff', T));
      if (ctx.home === c) p *= 1 + eff(c, 'territory', T) + c.workshop * 0.05;
      if (c.knowName.has(o.id)) p *= 1.08;                         // 真名を知っていれば弱点を突ける
      p *= 0.55 + 0.45 * Math.max(0, c.hp) / 100;                    // 傷が深いほど弱る
      if (!c.masterAlive) p *= 0.9;
      if (c.mana < 10) p *= 0.85;
      if (c.ally != null && camps[c.ally].alive && ctx.allyNear) p *= 1 + eff(camps[c.ally], 'rally');
      p += c.npBoost;
      return p * (0.9 + rnd() * 0.2);
    }

    // ---------- 脱落の処理 ----------
    function servantDown(c, text, by) {
      c.alive = false; c.out = true; c.hp = 0;
      c.fate = { day, text };
      if (by) by.kills.push(c.id);
      if (c.ally != null) { camps[c.ally].ally = null; c.ally = null; }
      const q = say(c, ['戦闘不能', '消滅', '退場']);
      log('death', `${nm(c)}が消滅した。${text}。`, [c.id].concat(by ? [by.id] : []), { quote: q, big: true });
      pubName.add(c.id);
      if (c.masterAlive) {
        if (c.cs > 0 && chance(0.8)) { c.inChurch = true; log('event', `マスターの${mn(c)}は${W.church}に保護を求めた。残る令呪は${c.cs}画。`, [c.id]); }
        else log('event', `マスターの${mn(c)}は姿を消した。`, [c.id]);
      }
    }
    function masterDown(c, text, by) {
      c.masterAlive = false; c.mhp = 0;
      c.soloLeft = Math.floor(eff(c, 'solo'));
      log('death', `マスターの${mn(c)}が倒れた。${text}。`, [c.id].concat(by ? [by.id] : []), { big: true });
      log('event', c.soloLeft > 0 ? `${nm(c)}は単独行動でしばらく現界を保てる（あと${c.soloLeft}日）。` : `要を失った${nm(c)}の現界は長くはもたない。`, [c.id]);
    }

    // 致命傷。踏みとどまるか、令呪で逃げるか、消滅するか
    function lethal(l, w, cause) {
      const pierced = chance(Math.min(0.9, eff(w, 'pierce')));
      if (!pierced && chance(Math.min(0.85, eff(l, 'guts')))) { l.hp = 5 + rnd() * 10; log('battle', `致命の一撃を受けながら、${nm(l)}は踏みとどまった。`, [l.id, w.id]); return 'guts'; }
      if (l.masterAlive && l.cs > 0 && chance(ENG.csEmergency)) {
        l.cs--;
        if (!chance(eff(l, 'cs_resist'))) { l.hp = 5; log('cs', `「令呪をもって命ずる——退け！」${mn(l)}の令呪が輝き、${nm(l)}は戦場から消えた。（残り${l.cs}画）`, [l.id, w.id], { big: true }); return 'escaped'; }
        log('cs', `${mn(l)}が令呪を切ったが、${nm(l)}には届かなかった。（残り${l.cs}画）`, [l.id, w.id]);
      }
      servantDown(l, `${day}日目の夜、${nm(w)}${cause === 'instakill' ? 'の即死の一撃に倒れた' : 'との戦いに敗れた'}`, w);
      return 'dead';
    }

    // ---------- 宝具 ----------
    function useNP(c, o, round, ctx) {
      if (!c.masterAlive && c.mana < 5) return;
      const nps = (c.sv.nps || []).filter(n => !n.disabled && c.mana >= n.cost * ENG.npCost);
      if (!nps.length) return;
      const losing = power(c, o, ctx) < power(o, c, ctx);
      let p = 0.1 + (c.hp < 50 ? 0.25 : 0) + (round >= 2 ? 0.1 : 0) + (isBerserk(c) ? 0.15 : 0) + (losing ? 0.2 : 0) + (day >= ENG.maxDays - ENG.finaleDays ? 0.2 : 0);
      if (!chance(p)) return;
      const retireOk = n => !(n.effects || []).some(e => e.id === 'self_retire' && e.mag >= 0.5) || (c.hp < 25 && chance(0.3));
      const atk = nps.filter(n => n.attackResolved && retireOk(n));
      const sup = nps.filter(n => !n.attackResolved && (n.effects || []).some(e => ['battle', 'damage', 'lethal', 'retreat'].includes(e.phase)) && !c.usedSup.has(n.name));
      const np = atk.length && (chance(0.75) || !sup.length) ? atk.reduce((a, b) => (a.power >= b.power ? a : b)) : sup.length ? pick(sup) : null;
      if (!np) return;
      c.mana -= np.cost * ENG.npCost; c.npUses++;
      if (np.attackResolved) c.npBoost = np.power * ENG.npPowerK * (np.burst > 1 ? 1 + (np.burst - 1) * rnd() * 0.5 : 1);
      else c.usedSup.add(np.name);
      for (const e of np.effects || []) if (!['master_buff', 'np_cost', 'self_retire', 'backfire', 'disabled'].includes(e.id)) c.temp.push(e);
      // 宝具は真名につながる
      if (chance(0.3 + np.exposure * 0.7)) o.knowName.add(c.id);
      if (np.exposure >= 1) pubName.add(c.id);
      const q = say(c, ['宝具']);
      log('np', `${nm(c)}が宝具を解放した——『${np.name}』${np.reading ? '（' + np.reading + '）' : ''}！`, [c.id, o.id], { quote: q, big: true });
      const bf = (np.effects || []).find(e => e.id === 'backfire');
      if (bf) { c.hp -= bf.mag * 40; log('battle', `反動が${nm(c)}自身を蝕む。`, [c.id]); }
      const sr = (np.effects || []).find(e => e.id === 'self_retire');
      if (sr && chance(sr.mag)) c.pendingRetire = np.name;
    }

    // ---------- 戦闘 ----------
    function battle(a, b, ctx) {
      a.fought = b.fought = true; a.battles++; b.battles++;
      a.temp = []; b.temp = []; a.usedSup = new Set(); b.usedSup = new Set();
      const where = ctx.home ? `${mn(ctx.home)}の拠点「${ctx.place.name}」` : ctx.place.name;
      log('battle', `${where}で、${nm(a)}と${nm(b)}が激突した。`, [a.id, b.id], { quote: say(a, ['開始', '戦闘開始']), head: true });
      for (let round = 1; round <= ENG.rounds; round++) {
        a.npBoost = b.npBoost = 0;
        useNP(a, b, round, ctx); if (!a.alive) return;
        useNP(b, a, round, ctx);
        for (const c of [a, b]) if (c.pendingRetire) { const n = c.pendingRetire; c.pendingRetire = null; servantDown(c, `宝具『${n}』の代償で脱落した`); return; }
        let ea = power(a, b, ctx), eb = power(b, a, ctx);
        if (chance(eff(a, 'charm', ctx.terrain)) && !chance(eff(b, 'mental_guard', ctx.terrain))) { eb *= 0.6; log('battle', `${nm(b)}の刃が一瞬鈍った。魅了だ。`, [a.id, b.id]); }
        if (chance(eff(b, 'charm', ctx.terrain)) && !chance(eff(a, 'mental_guard', ctx.terrain))) { ea *= 0.6; log('battle', `${nm(a)}の刃が一瞬鈍った。魅了だ。`, [a.id, b.id]); }
        const p = 1 / (1 + Math.exp(-(ea - eb) / G.CONFIG.BATTLE_K));
        const [w, l, ew, el] = chance(p) ? [a, b, ea, eb] : [b, a, eb, ea];
        let outcome = null;
        if (chance(Math.min(0.4, eff(w, 'instakill', ctx.terrain)))) {
          log('battle', `${nm(w)}の一撃が、${nm(l)}の霊核を捉えた。`, [w.id, l.id]);
          l.hp = 0; outcome = lethal(l, w, 'instakill');
        } else {
          let dmg = (ENG.dmgBase + rnd() * ENG.dmgVar) * (1 + clamp((ew - el) / (ew + el + 1), -0.3, 0.6));
          const crit = chance(eff(w, 'crit', ctx.terrain));
          if (crit) dmg *= 1.5;
          if (!chance(eff(w, 'pierce', ctx.terrain))) dmg *= 1 - clamp(eff(l, 'guard', ctx.terrain) * 0.5, -0.5, 0.5);
          l.hp -= dmg; w.hp -= rnd() * 8;
          const big = dmg > 32;
          log('battle', `${round === 1 ? '' : round === ENG.rounds ? '最後の打ち合い。' : '再び刃が交わる。'}${crit ? '会心の一撃。' : ''}${nm(w)}が押し勝ち、${nm(l)}は${big ? '深手を負った' : '傷を負った'}。`, [w.id, l.id], { hp: true });
          if (l.hp <= 0) outcome = lethal(l, w, 'battle');
          if (w.hp <= 0 && w.alive && outcome !== 'dead') { const o2 = lethal(w, l, 'battle'); if (o2 !== 'guts') outcome = outcome || o2; }
        }
        if (outcome === 'dead' || outcome === 'escaped' || !a.alive || !b.alive) break;
        // 撤退
        const weaker = a.hp / 100 < b.hp / 100 ? a : b, other = weaker === a ? b : a;
        if (weaker.hp < ENG.retreatAt || (weaker === l && p < 0.3 && weaker.hp < 60)) {
          const ctrl = isBerserk(weaker) && chance(0.5) ? -0.2 : 0;
          if (chance(clamp(ENG.retreatBase + eff(weaker, 'escape', ctx.terrain) - eff(other, 'pin', ctx.terrain) * 0.8 + ctrl, 0.05, 0.9))) {
            log('battle', `${nm(weaker)}は退いた。${nm(other)}は深追いしなかった。`, [weaker.id, other.id]); break;
          } else if (eff(other, 'pin', ctx.terrain) > 0.1) log('battle', `退こうとした${nm(weaker)}の行く手を、${nm(other)}が阻んだ。`, [weaker.id, other.id]);
        }
        if (round === ENG.rounds) log('battle', '夜明けが近づき、両者は刃を収めた。', [a.id, b.id]);
      }
      // 戦いの後：拠点の場所と、真名の手がかり
      if (ctx.home) a.knowLoc.add(ctx.home.id);
      for (const [x, y] of [[a, b], [b, a]]) if (x.alive && y.alive && chance(0.1 + eff(x, 'reveal') - eff(y, 'conceal') * 0.6)) {
        if (!x.knowName.has(y.id)) { x.knowName.add(y.id); if (x.you) log('scout', `剣を交えるうちに、${nm(y)}の真名に思い至った。`, [x.id, y.id]); }
      }
      a.temp = []; b.temp = []; a.npBoost = b.npBoost = 0;
    }

    // マスターへの奇襲
    function ambushMaster(h, t) {
      const guard = eff(t, 'master_guard') + eff(t, 'detect') * 0.5 + t.workshop * 0.06;
      if (chance(Math.min(0.85, guard))) { log('battle', `${mn(t)}を狙った刃は、${nm(t)}に阻まれた。`, [h.id, t.id]); return false; }
      const dmg = 40 + rnd() * 60 - t.master.stats.body * 0.3;
      t.mhp -= dmg;
      if (t.mhp <= 0) {
        if (t.cs > 0 && chance(ENG.csSaveMaster)) { t.cs--; t.mhp = 8; log('cs', `瀕死の${mn(t)}が令呪で${nm(t)}を呼び戻した。（残り${t.cs}画）`, [t.id, h.id], { big: true }); return false; }
        masterDown(t, `${nm(h)}の奇襲だった`, h); return true;
      }
      log('battle', `${nm(h)}の奇襲で、${mn(t)}が深手を負った。`, [h.id, t.id]);
      return true;
    }

    // ---------- 昼 ----------
    function dayPhase() {
      phase = 'day';
      const alive = active();
      if (alive.length <= ENG.allianceBreakAt) for (const c of alive) if (c.ally != null) {
        const o = camps[c.ally]; c.ally = null; o.ally = null;
        log('ally', `残りが${alive.length}騎となり、${nm(c)}と${nm(o)}の同盟は解消された。`, [c.id, o.id]);
      }
      for (const c of shuffle(alive)) {
        c.hunting = c.hidden = c.wander = c.fought = false;
        // はぐれサーヴァント
        if (!c.masterAlive) {
          const free = camps.filter(m => !m.alive && m.masterAlive && !m.merged && m.cs > 0);
          if (free.length && chance(ENG.recontract)) {
            const m = pick(free);
            c.master = m.master; c.masterAlive = true; c.mhp = m.mhp || Math.round(m.mhpMax * 0.7); c.mhpMax = m.mhpMax; c.cs = m.cs; c.manaMax = m.manaMax; c.mana = Math.round(m.manaMax * 0.5); c.soloLeft = null;
            m.merged = true; m.fate = { day, text: (m.fate ? m.fate.text + '。' : '') + `${day}日目、マスターは${c.label}と再契約した` };
            if (m.you) { c.you = true; m.you = false; you = c; }
            log('ally', `主を失った${nm(c)}と、サーヴァントを失った${mn(c)}が手を結んだ。再契約だ。`, [c.id, m.id], { big: true });
          } else if (c.soloLeft <= 0) { servantDown(c, `マスターを失い、${day}日目に現界を保てなくなった`); continue; }
          else c.soloLeft--;
        }
        if (G.CONFIG.ENGINE && chance(eff(c, 'uncontrolled'))) { c.wander = true; if (c.you) log('day', `${nm(c)}が言うことを聞かず、昼の街をうろついている。`, [c.id]); continue; }
        const w = {
          scout: 1 + (eff(c, 'intel') + eff(c, 'detect')) * 3,
          fortify: c.workshop >= 5 ? 0.1 : 0.5 + eff(c, 'territory') * 4 + eff(c, 'craft') * 3 + (c.sv.class.key === 'caster' ? 1 : 0),
          rest: 0.3 + (100 - c.hp) / 30 + (c.mana < c.manaMax * 0.4 ? 1.5 : 0),
          ally: alive.length > ENG.allianceBreakAt + 1 && c.ally == null && c.masterAlive ? 0.3 + Math.max(0, eff(c, 'negotiate')) * 3 : 0,
          hide: eff(c, 'stealth') * 2 + (c.hp < 50 ? 0.5 : 0),
        };
        const act = decide(c, 'day', w);
        if (act === 'scout') {
          const t = pick(alive.filter(x => x !== c)); if (!t) continue;
          if (chance(clamp(0.35 + eff(c, 'intel') + eff(c, 'detect') * 0.5 - eff(t, 'stealth') * 0.6, 0.05, 0.9))) {
            const newLoc = !c.knowLoc.has(t.id); c.knowLoc.add(t.id);
            const nameHit = !c.knowName.has(t.id) && chance(clamp(0.08 + eff(c, 'reveal') + eff(c, 'intel') * 0.3 - eff(t, 'conceal') * 0.6, 0, 0.7));
            if (nameHit) c.knowName.add(t.id);
            if (c.ally != null) { camps[c.ally].knowLoc.add(t.id); if (nameHit) camps[c.ally].knowName.add(t.id); }
            if (c.you && (newLoc || nameHit)) log('scout', `偵察の結果、${t.label}の拠点は「${t.base.name}」だと突き止めた。` + (nameHit ? `さらに真名が「${t.sv.trueName}」だと分かった。` : ''), [c.id, t.id]);
          } else if (c.you) log('day', `${nm(c)}は街を偵察したが、手がかりは得られなかった。`, [c.id]);
        } else if (act === 'fortify') {
          if (chance(clamp(0.5 + eff(c, 'territory') + eff(c, 'resource') * 0.5, 0.2, 0.95))) {
            c.workshop = Math.min(5, c.workshop + 1);
            if (c.you || c.workshop >= 3) log('day', `${nm(c)}の陣営は拠点「${c.base.name}」の守りを固めた（工房${c.workshop}）。`, [c.id]);
          }
          if (chance(eff(c, 'craft'))) { c.items++; if (c.you) log('day', `${nm(c)}が戦いに役立つ道具を用意した。`, [c.id]); }
        } else if (act === 'rest') {
          c.hp = Math.min(100, c.hp + ENG.restHeal + eff(c, 'regen') * 60);
          c.mhp = Math.min(c.mhpMax, c.mhp + 15 + eff(c, 'heal_other') * 60);
          c.mana = Math.min(c.manaMax, c.mana + 10);
          if (c.you) log('day', `${nm(c)}の陣営は拠点で傷と魔力の回復に努めた。`, [c.id]);
        } else if (act === 'ally') {
          const cand = alive.filter(x => x !== c && x.ally == null && x.masterAlive);
          if (cand.length) {
            const t = pick(cand);
            const p = clamp(0.12 + eff(c, 'negotiate') + eff(t, 'negotiate') * 0.5, 0, 0.8);
            if (chance(p)) { c.ally = t.id; t.ally = c.id; log('ally', `${mn(c)}と${mn(t)}が手を組んだ。${nm(c)}と${nm(t)}の同盟だ。`, [c.id, t.id], { big: c.you || t.you }); }
            else if (c.you) log('day', `${mn(c)}は${t.label}の陣営に同盟を持ちかけたが、断られた。`, [c.id, t.id]);
          }
        } else if (act === 'hide') {
          c.hidden = true;
          if (c.you) log('day', `${nm(c)}の陣営は気配を殺し、息を潜めた。`, [c.id]);
        }
      }
      // 維持魔力
      for (const c of active()) {
        if (!c.masterAlive) continue;
        const cost = ENG.upkeep * Math.max(0.3, 1 + eff(c, 'upkeep_up') - eff(c, 'upkeep_down'));
        c.mana = Math.min(c.manaMax, c.mana + ENG.manaRegen + c.master.stats.mana * 0.15 + c.workshop * 2) - cost;
        if (c.mana < 0) { c.mana = 0; c.hp -= 8; log('day', `${mn(c)}の魔力が尽きかけ、${nm(c)}の霊基が揺らいでいる。`, [c.id]); if (c.hp <= 0) servantDown(c, `魔力が尽き、${day}日目に消滅した`); }
        c.mhp = Math.min(c.mhpMax, c.mhp + 5);
      }
    }

    // ---------- 夜 ----------
    function nightPhase() {
      phase = 'night';
      const alive = active();
      if (alive.length <= 1) return;
      const avg = alive.reduce((t, c) => t + c.sv.power, 0) / alive.length;
      const finale = day > ENG.maxDays - ENG.finaleDays;
      for (const c of alive) {
        let p = ENG.huntBase + (c.sv.power - avg) / 60 + (isBerserk(c) ? 0.2 : 0) + (c.hp < 40 ? -0.3 : 0) + (finale ? 0.4 : 0) + (!c.masterAlive ? 0.2 : 0) + (c.hidden ? -0.2 : 0);
        c.hunting = c.wander || decide(c, 'night', { hunt: clamp(p, 0.05, 0.95), stay: 1 - clamp(p, 0.05, 0.95) }) === 'hunt';
      }
      let any = false;
      for (const h of shuffle(alive)) {
        if (!h.alive || !h.hunting || h.fought) continue;
        const targets = active().filter(t => t !== h && !t.fought && t.ally !== h.id);
        if (!targets.length) continue;
        const tw = {};
        for (const t of targets) tw[t.id] = 1 + (h.knowLoc.has(t.id) ? 2 : 0) + clamp(h.sv.power / Math.max(5, t.sv.power) - 1, -0.5, 1.5) + (t.hp < 50 ? 0.5 : 0);
        const t = camps[+wpick(tw)];
        const pf = clamp(ENG.findBase + eff(h, 'detect') * 0.8 + (h.knowLoc.has(t.id) ? 0.3 : 0) + (t.hunting ? 0.15 : 0) + (t.wander ? 0.2 : 0) - eff(t, 'stealth') * 0.7 - (t.hidden ? 0.2 : 0), 0.05, 0.95);
        if (!chance(pf)) { if (h.you) log('night', `${nm(h)}は夜の街を巡ったが、敵の気配はつかめなかった。`, [h.id]); continue; }
        any = true;
        const home = t.hunting ? null : t;
        const place = home ? t.base : pick(W.places);
        if (!home) t.knowLoc.add(h.id);
        // 気配を消せるサーヴァントはマスターを狙う
        if (home && t.masterAlive && chance(Math.min(0.6, eff(h, 'anti_master') * 1.5))) {
          h.fought = t.fought = true;
          if (ambushMaster(h, t)) continue;
        }
        battle(h, t, { place, home, terrain: place.terrain, allyNear: false });
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
    if (you) log('summon', `あなたの${you.label}の真名は「${you.sv.trueName}」。${you.sv.profile && you.sv.profile.wish ? '聖杯に託す願いは「' + you.sv.profile.wish + '」。' : ''}マスター${mn(you)}の願いは「${you.master.wish}」。`, [you.id]);

    // ---------- 本編 ----------
    let finaleAnnounced = false, quietFrom = null;
    for (day = 1; day <= ENG.maxDays; day++) {
      if (active().length <= 1) { day--; break; }
      phase = 'day';
      const head = log('dayhead', `${day}日目`, [], { head: true }), n0 = entries.length;
      if (!finaleAnnounced && day > ENG.maxDays - ENG.finaleDays) { finaleAnnounced = true; log('event', '聖杯の降臨が近い。残るサーヴァントたちが動き出した。', [], { big: true }); }
      dayPhase();
      if (active().length > 1) nightPhase();
      for (const c of camps) { c.temp = []; c.npBoost = 0; }
      // 何も起きなかった日はまとめる
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

    return {
      seed, city, days: day,
      you: you ? you.id : null,
      winner: winner ? winner.id : null,
      camps: camps.map(c => ({
        id: c.id, label: c.label, slot: c.slot, trueName: c.sv.trueName, cls: c.sv.class.label, servantId: c.sv.id,
        master: c.master.name, origin: c.master.originLabel, wish: c.master.wish, alive: c.alive, masterAlive: c.masterAlive,
        fate: c.fate, kills: c.kills.map(i => camps[i].sv.trueName), npUses: c.npUses, battles: c.battles, power: r1(c.sv.power), you: !!c.you,
      })),
      entries,
    };
  }

  G.engine = { runWar, makeRng };
})(globalThis.HGW = globalThis.HGW || {});
