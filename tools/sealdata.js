// 既定の令呪の紋様（js/sealdata.js）を、令呪デザイナーで書き出した SVG から作り直す
// 使い方: node tools/sealdata.js 1.svg 2.svg …（並びの順に入る。入れ替えると、同じシードでも別の紋様になる）
const fs = require('fs'), path = require('path');
require('../js/sealmark.js');
const S = globalThis.HGW.sealmark;

const files = process.argv.slice(2);
if (!files.length) { console.error('使い方: node tools/sealdata.js 1.svg 2.svg …'); process.exit(1); }
const seals = files.map(f => {
  const seal = S.parse(fs.readFileSync(f, 'utf8'));
  if (seal.error) { console.error(`${f}: ${seal.error}`); process.exit(1); }
  if (!S.tagged(seal)) console.error(`注意 ${f}: 画の区別がない（全画を使い切ると消える）`);
  return seal;
});
const out = `// 自動生成（tools/sealdata.js）。手で直さない。既定の令呪の紋様\n(function (G) {\n  'use strict';\n  G.SEAL_DEFAULTS = [\n${seals.map(s => '    ' + JSON.stringify(s)).join(',\n')}\n  ];\n})(globalThis.HGW = globalThis.HGW || {});\n`;
fs.writeFileSync(path.join(__dirname, '../js/sealdata.js'), out);
console.log(`${seals.length}種を js/sealdata.js に書き出した（${out.length}文字）`);
