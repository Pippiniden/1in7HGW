// 令呪の紋様（js/sealmark.js）：デザイナーの書き出しを読めるか、危ないものを画面に通さないか
// 使い方: node test/sealmark.js
require('../js/sealmark.js');
const S = globalThis.HGW.sealmark;
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };

// デザイナーの書き出しと同じ形（背景・光のフィルタ・縁取り・画の番号）
const shape = (k, x) => `<g${k ? ` data-kaku="${k}"` : ''}><path d="M${x} 100L${x + 40} 100L${x + 20} 180Z" fill="#b3121e" fill-rule="nonzero"/><path d="M${x} 100L${x + 40} 100L${x + 20} 180Z" fill="none" stroke="#ffd9d0"/></g>`;
const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="1200" height="1200"><defs><radialGradient id="sk"><stop offset="0"/></radialGradient></defs><rect width="400" height="400" fill="#120c0e"/><defs><filter id="gl"><feGaussianBlur stdDeviation="5"/></filter></defs><g filter="url(#gl)">${body}</g></svg>`;

const s = S.parse(wrap(shape(1, 100) + shape(2, 160) + shape(3, 220)), '翼の槍');
ok(!s.error, '書き出しを読める: ' + s.error);
ok(s.paths.length === 3, '塗りの形だけを読む（縁取りは除く）: ' + s.paths.length);
ok(s.paths.map(p => p.k).join() === '1,2,3', '画の番号を読む');
ok(s.color === '#b3121e', '色を読む');
ok(S.tagged(s), '画の区別あり');
ok(s.name === '翼の槍', '名前');
ok(s.vb[2] < 400 && s.vb[2] === s.vb[3], '形に合わせた正方形に切り詰める: ' + s.vb);

// 三画目から消える
const lit = n => { const m = S.markup(s, n, 96), g = m.split('filter:drop-shadow')[1]; return g ? (g.match(/<path/g) || []).length : 0; };
ok(lit(3) === 3 && lit(2) === 2 && lit(1) === 1 && lit(0) === 0 && lit(5) === 3, '残り画数だけ光る');
ok(S.markup(s, 2, 96).indexOf('M220 100') < S.markup(s, 2, 96).indexOf('drop-shadow'), '消えるのは三画目');

// 画の区別がない古い書き出し：0画で全体が消える
const old = S.parse(wrap(shape(0, 100) + shape(0, 160)));
ok(!old.error && !S.tagged(old), '古い書き出しも読める');
ok(S.markup(old, 1, 96).includes('drop-shadow') && !S.markup(old, 0, 96).includes('drop-shadow'), '古い書き出しの光り方');

// 読めないもの
ok(S.parse('not svg').error, 'SVGでない');
ok(S.parse('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>').error, '形がない');
ok(S.parse('<svg viewBox="0 0 10 10"><defs><path d="M0 0L1 1Z"/></defs></svg>').error, 'defs の中は形に数えない');
ok(S.parse('<svg><path transform="scale(2)" d="M0 0L1 1Z"/></svg>').error, 'transform は断る');
ok(S.parse('x'.repeat(2000001)).error, '大きすぎる');

// 危ないものが画面に届かない
const evil = S.parse(`<svg viewBox="0 0 400 400" onload="alert(1)"><script>alert(2)</script><style>*{display:none}</style><foreignObject><img src=x onerror="alert(3)"/></foreignObject><path d="M0 0L9 9Z" fill="url(javascript:alert(4))" onclick="alert(5)" style="x:y"/></svg>`);
ok(!evil.error, '余計なものは捨てて形だけ読む: ' + evil.error);
const html = S.markup(evil, 3, 96);
ok(!/alert|onload|onclick|onerror|script|javascript|foreignObject|<img|<style/i.test(html), '余計なものは出力されない: ' + html);
ok(html.includes('var(--seal)'), '読めない色は既定の色');
ok(S.parse(`<svg viewBox="0 0 9 9"><path d="M0 0&quot;/><script>" fill="#fff"/></svg>`).error, 'd の中の文字を検査する');
ok(S.parse(`<svg viewBox="0 0 9 9"><path d='M0 0"/><img src=x>' fill="#fff"/></svg>`).error, 'd の中の引用符を通さない');

// 保存データの検査
ok(S.normalize(null) === null && S.normalize({ paths: [] }) === null, '空の保存データ');
ok(S.normalize({ paths: [{ d: '"><script>' }] }) === null, '書き換えられた保存データ');
const n1 = S.normalize({ color: 'red"/><x', vb: ['"', 0, 1, 1], paths: [{ k: 9, d: 'M0 0Z', r: '"' }] });
ok(n1 && n1.color === '' && n1.vb[0] === 0 && n1.paths[0].k === 0 && n1.paths[0].r === 'nonzero', '保存データの値を正す');
ok(JSON.stringify(S.normalize(JSON.parse(JSON.stringify(s)))) === JSON.stringify(s), '保存して戻しても同じ');

console.log(fail ? `失敗 ${fail}件` : 'sealmark: ok');
process.exit(fail ? 1 : 0);
