/* ランク文字列（A+, EX, C～A, B(狂化時A), -, ？ など）を数値に変換する */
(function (G) {
  'use strict';
  const CFG = () => G.CONFIG;
  const LEVELS = ['E', 'D', 'C', 'B', 'A', 'EX'];

  // 全角→半角、記号のゆれをそろえる
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[＋✚]/g, '+')
      .replace(/[－−‐‑–—]/g, '-')
      .replace(/[～〜~]/g, '~')
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/？/g, '?')
      .replace(/／/g, '/')
      .replace(/[\s　]+/g, ' ')
      .trim();
  }

  // 段階（小数可）→スコア。段階の間は直線補間、EXより上は伸ばす。table を省くと RANK_SCORE
  function scoreAt(step, table) {
    const S = table || CFG().RANK_SCORE, st = CFG().RANK_STEP;
    const pts = LEVELS.map(l => [st[l], S[l]]);
    if (step <= pts[0][0]) return Math.max(0, pts[0][1] - (pts[0][0] - step) * 10);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (step <= x1) return y0 + (y1 - y0) * (step - x0) / (x1 - x0);
    }
    const [xl, yl] = pts[pts.length - 1], [xp, yp] = pts[pts.length - 2];
    return yl + (yl - yp) * (step - xl) / (xl - xp);
  }
  function multAt(step) {
    const M = CFG().RANK_MULT, st = CFG().RANK_STEP;
    const lo = Math.max(1, Math.min(6, Math.floor(step))), hi = Math.min(6, lo + 1);
    const a = M[LEVELS[lo - 1]], b = M[LEVELS[hi - 1]];
    if (step >= 6) return M.EX + (step - 6) * 0.3;
    if (step <= 1) return Math.max(0.1, M.E - (1 - step) * 0.2);
    return a + (b - a) * (step - lo);
  }

  // 「A+」「EX」「C-」など単体のトークンを解析
  function parseOne(tok) {
    const t = tok.toUpperCase();
    const m = t.match(/(EX|[A-E])(\++)?(-+)?/);
    if (!m) return null;
    const base = m[1], plus = m[2] ? m[2].length : 0, minus = m[3] ? m[3].length : 0;
    const step = CFG().RANK_STEP[base] + plus * CFG().PLUS_STEP - minus * CFG().MINUS_STEP;
    return { base, plus, minus, step };
  }

  /**
   * ランク文字列を解析する。
   * 戻り値: { raw, base, plus, minus, step, score, mult, burst, range, alt, unknown, none }
   *  - score: ステータス用の数値（高ランクほど大きく伸びる）
   *  - mult : スキル・宝具の効果倍率（B=1.0）
   *  - burst: 「+」の瞬間倍率（+なし=1）
   *  - range: 「C～A」なら [低, 高] の解析結果。score は平均
   *  - alt  : 括弧内の別ランク（狂化時A など）[{ label, rank }]
   */
  function parseRank(raw) {
    const out = { raw: raw == null ? '' : String(raw), base: null, plus: 0, minus: 0, step: null, score: null, mult: null, burst: 1, range: null, alt: [], unknown: false, none: false };
    let s = normalize(raw);
    if (!s) { out.unknown = true; return out; }
    if (/^(-+|―+|ー+|なし|無し|無|N\/A|NONE)$/i.test(s)) { out.none = true; out.step = 0; out.score = 0; out.mult = 0; return out; }
    if (/測定不能|規格外|計測不能/.test(s) && !/(EX|[A-E])/i.test(s.replace(/測定不能|規格外|計測不能/g, ''))) s = 'EX';

    // 括弧の中身は別ランクとして退避
    s = s.replace(/\(([^)]*)\)/g, (_, inner) => {
      const r = parseOne(normalize(inner));
      out.alt.push({ label: inner.replace(/(EX|[A-E])[+\-]*/i, '').trim(), raw: inner, rank: r });
      return ' ';
    }).trim();

    // 範囲（C~A, B/A, C→A）
    const parts = s.split(/\s*(?:~|\/|→|⇒|or)\s*/i).map(parseOne).filter(Boolean);
    if (parts.length >= 2) {
      const lo = parts.reduce((a, b) => a.step <= b.step ? a : b), hi = parts.reduce((a, b) => a.step >= b.step ? a : b);
      out.range = [lo, hi];
      Object.assign(out, { base: lo.base, plus: lo.plus, minus: lo.minus });
      out.step = (lo.step + hi.step) / 2;
    } else if (parts.length === 1) {
      Object.assign(out, parts[0]);
    } else if (out.alt.length && out.alt[0].rank) {
      // 本体が読めず括弧だけある場合は括弧を採用
      Object.assign(out, out.alt[0].rank);
    } else {
      out.unknown = true;
      return out;
    }
    if (/\?/.test(s)) out.unknown = true; // 「A?」のような不確定表記
    out.score = Math.round(scoreAt(out.step) * 10) / 10;
    out.mult = Math.round(multAt(out.step) * 100) / 100;
    const B = CFG().PLUS_BURST;
    out.burst = B[Math.min(out.plus, B.length - 1)];
    return out;
  }

  // サーヴァントのステータス用のスコア（STAT_SCORE）。解析済みのランク（公開データに入っている score は RANK_SCORE のもの）から出し直す
  function statScore(r) {
    if (!r || r.none) return r && r.none ? 0 : null;
    if (r.step == null) return r.score == null ? null : r.score;
    return Math.round(scoreAt(r.step, CFG().STAT_SCORE || CFG().RANK_SCORE) * 10) / 10;
  }

  // 範囲ランクを戦争ごとに1つに確定させる（rnd は 0〜1 の乱数関数）。table を渡すとそのスコア表で（ステータスは STAT_SCORE）
  function rollRange(r, rnd, table) {
    if (!r || !r.range) return r;
    const [lo, hi] = r.range, step = lo.step + (hi.step - lo.step) * (rnd || Math.random)();
    return Object.assign({}, r, { step, score: Math.round(scoreAt(step, table) * 10) / 10, mult: Math.round(multAt(step) * 100) / 100, range: null, rolledFrom: r.raw });
  }

  // 数値（0〜100）またはランク文字列のどちらでも受け付ける（マスター用）
  function toScore(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return v;
    const r = parseRank(v);
    return r.score == null ? (fallback == null ? null : fallback) : r.score;
  }

  function label(r) {
    if (!r) return '?';
    if (r.none) return '-';
    if (r.base == null) return '?';
    const one = x => x.base + '+'.repeat(x.plus) + '-'.repeat(x.minus);
    return r.range ? one(r.range[0]) + '~' + one(r.range[1]) : one(r);
  }

  G.rank = { normalize, parseRank, parseOne, scoreAt, statScore, multAt, rollRange, toScore, label, LEVELS };
})(globalThis.HGW = globalThis.HGW || {});
