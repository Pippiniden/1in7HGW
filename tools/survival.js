#!/usr/bin/env node
/* 生存曲線の集計（data/survival.json）を作る
 *
 *   node tools/survival.js            … 3000回（既定）の全自動の聖杯戦争から集計して data/survival.json に書く
 *   node tools/survival.js 1000       … 回数を指定
 *   node tools/survival.js --check    … 今の名簿と data/survival.json の指紋が合っているかだけ確かめる
 *
 * 名簿の読み込みはゲームと同じ（js/data.js の loadPublished）。名簿（servants.json・overrides.json・packs）を
 * 変えたら作り直す。作り直さなくてもゲームは動き、指紋が合わなければ画面の側で少しずつ集計し直す。
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['config', 'rank', 'parser', 'effects', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine', 'data', 'survival']) require(path.join(ROOT, 'js', f + '.js'));
const H = globalThis.HGW;

// data.js はブラウザの fetch で読むので、手元のファイルを返す fetch を用意する
globalThis.fetch = async url => {
  const p = path.join(ROOT, String(url).split('?')[0]);
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};

(async () => {
  const args = process.argv.slice(2);
  const res = await H.data.loadPublished('data/');
  if (res.errors.length) console.error('読めなかったもの：', res.errors.join('、'));
  const roster = res.servants, file = path.join(ROOT, 'data', 'survival.json');
  const fp = H.survival.fingerprint(roster);
  if (args.includes('--check')) {
    const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const ok = cur && cur.fp === fp;
    console.log(ok ? `data/survival.json は今の名簿と合っています（${fp}、${cur.wars}回）` : `data/survival.json は今の名簿と合っていません（名簿 ${fp} / ファイル ${cur ? cur.fp : 'なし'}）`);
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const n = +(args.find(a => /^\d+$/.test(a)) || 3000);
  const run = H.survival.runner(roster, { masters: res.masters });
  const t0 = Date.now();
  for (let done = 0; done < n; done += 100) {
    run.step(Math.min(100, n - done));
    process.stderr.write(`\r${run.stats.wars} / ${n}`);
  }
  process.stderr.write('\n');
  const st = run.stats;
  fs.writeFileSync(file, JSON.stringify(st) + '\n');
  const ns = Object.values(st.servants).map(t => t.n).sort((a, b) => a - b);
  console.log(`data/survival.json を書きました：${st.wars}回・${Object.keys(st.servants).length}騎・登場回数 最少${ns[0]}／中央${ns[ns.length >> 1]}・${((Date.now() - t0) / 1000).toFixed(1)}秒・指紋 ${st.fp}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
