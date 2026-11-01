// 令呪の紋様：令呪デザイナー（command-spell-maker）が書き出した SVG を読み、残り画数に応じて描く。
// 見た目だけの機能で、戦争の展開には関わらない（index.html だけが読み込む）。
// 読み込んだ SVG はそのまま画面に入れない：図形の座標と色だけを取り出して、ここで組み立て直す。
(function (G) {
  'use strict';
  const MAX_TEXT = 2000000;
  const MAX_PATHS = 2000;
  const DIM = 'rgba(255,255,255,.14)';
  const D_OK = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
  const COLOR_OK = /^#[0-9a-fA-F]{3,8}$/;
  // この中の path は表示される形ではない
  const SKIP = new Set(['defs', 'clippath', 'mask', 'pattern', 'symbol', 'marker', 'lineargradient', 'radialgradient', 'filter', 'title', 'desc', 'metadata', 'style', 'script']);

  function attrsOf(s) {
    const a = {}, re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(s))) a[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3];
    return a;
  }
  function viewBoxOf(a) {
    const v = String(a.viewbox || '').trim().split(/[\s,]+/).map(Number);
    return v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0 ? v : [0, 0, 400, 400];
  }
  // 形の収まる正方形（大きさの違う紋様も枠いっぱいに見せる）。曲線などを含むときは SVG 全体
  function fitBox(paths, vb) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of paths) {
      if (/[^MLZ0-9.,\s+-]/.test(p.d)) return vb;
      const n = (p.d.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g) || []).map(Number);
      for (let i = 0; i + 1 < n.length; i += 2) {
        x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
        y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
      }
    }
    if (!(x1 > x0 || y1 > y0)) return vb;
    const s = Math.max(x1 - x0, y1 - y0) * 1.08, r = v => Math.round(v * 10) / 10;
    return [r((x0 + x1 - s) / 2), r((y0 + y1 - s) / 2), r(s), r(s)];
  }

  // 保存された紋様も画面に出す前にここを通す。おかしなものは null
  function normalize(o) {
    if (!o || !Array.isArray(o.paths) || !o.paths.length || o.paths.length > MAX_PATHS) return null;
    const paths = [];
    for (const p of o.paths) {
      if (!p || typeof p.d !== 'string' || !D_OK.test(p.d)) return null;
      paths.push({ k: [1, 2, 3].includes(p.k) ? p.k : 0, d: p.d, r: p.r === 'evenodd' ? 'evenodd' : 'nonzero' });
    }
    const vb = Array.isArray(o.vb) && o.vb.length === 4 && o.vb.every(Number.isFinite) && o.vb[2] > 0 && o.vb[3] > 0 ? o.vb.slice() : [0, 0, 400, 400];
    return { color: COLOR_OK.test(o.color || '') ? o.color : '', vb, paths, name: typeof o.name === 'string' ? o.name.slice(0, 60) : '' };
  }

  // SVG の文字列 → { color, vb, paths:[{k,d,r}], name }。読めなければ { error }
  function parse(text, name) {
    if (typeof text !== 'string' || text.length > MAX_TEXT) return { error: 'SVGのファイルが大きすぎます' };
    const src = text.replace(/<!--[\s\S]*?-->/g, '');
    const tags = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    const stack = [], paths = [];
    let m, vb = null, color = '', skip = 0;
    while ((m = tags.exec(src))) {
      const tag = m[2].toLowerCase().replace(/^svg:/, ''), close = !!m[1], self = !!m[4];
      if (close) {
        while (stack.length) { const t = stack.pop(); if (SKIP.has(t.tag)) skip--; if (t.tag === tag) break; }
        continue;
      }
      const a = attrsOf(m[3]);
      if (tag === 'svg' && !vb) vb = viewBoxOf(a);
      if (!skip && a.transform) return { error: '変形（transform）を含むSVGは読めません。令呪デザイナーで書き出してください' };
      if (!skip && tag === 'path' && a.d && String(a.fill).toLowerCase() !== 'none') {
        if (!D_OK.test(a.d)) return { error: 'SVGの形を読めませんでした' };
        let k = 0;
        for (let i = stack.length - 1; i >= 0 && !k; i--) k = stack[i].k;
        if (!color && COLOR_OK.test(a.fill || '')) color = a.fill;
        paths.push({ k, d: a.d, r: a['fill-rule'] });
      }
      if (!self) {
        if (SKIP.has(tag)) skip++;
        stack.push({ tag, k: tag === 'g' && [1, 2, 3].includes(+a['data-kaku']) ? +a['data-kaku'] : 0 });
      }
    }
    if (!vb) return { error: 'SVGのファイルではありません' };
    if (!paths.length) return { error: '令呪の形が見つかりませんでした' };
    const seal = normalize({ color, vb: fitBox(paths, vb), paths, name });
    return seal || { error: '令呪の形が多すぎるか、読めませんでした' };
  }

  // 画の区別があるか（古い書き出しには無い）
  const tagged = seal => seal.paths.some(p => p.k);

  // n = 残り画数。三画目から消える（令呪デザイナーの「一画使う」と同じ順）。画の区別が無ければ 0画で全体が消える
  function markup(seal, n, size) {
    const lit = p => p.k ? p.k <= n : n > 0;
    const draw = (list, fill) => list.map(p => `<path d="${p.d}" fill="${fill}" fill-rule="${p.r}"/>`).join('');
    const color = seal.color || 'var(--seal)';
    const on = seal.paths.filter(lit), off = seal.paths.filter(p => !lit(p));
    return `<svg width="${+size}" height="${+size}" viewBox="${seal.vb.join(' ')}" aria-label="令呪 残り${+n}画">`
      + (off.length ? `<g>${draw(off, DIM)}</g>` : '')
      + (on.length ? `<g style="filter:drop-shadow(0 0 3px ${color})">${draw(on, color)}</g>` : '')
      + '</svg>';
  }

  // シードから既定の紋様を選ぶ。戦争の rnd() を使わないので、展開は変わらず、同じシードなら同じ紋様になる
  function defaultFor(seed) {
    const list = G.SEAL_DEFAULTS || [];
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return list[(h >>> 0) % list.length] || null;
  }

  G.sealmark = { parse, normalize, tagged, markup, defaultFor };
})(globalThis.HGW = globalThis.HGW || {});
