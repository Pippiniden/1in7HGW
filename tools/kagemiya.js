#!/usr/bin/env node
/* kagemiya@ふたば（Seesaa Wiki）からサーヴァントのページを名前で取り込む
 *
 * GitHub Actions（.github/workflows/kagemiya.yml）から呼ぶ想定。手元でも Node 18 以上で動く（追加パッケージなし）。
 *
 *   node tools/kagemiya.js add  ルーカン ペンテシレイア     … 名前（ページ名）を指定して取り込む
 *   node tools/kagemiya.js refresh                           … data/servants.json の全騎をWikiから取り直す
 *   node tools/kagemiya.js refresh ルーカン                  … リストにいる騎だけを取り直す
 *   node tools/kagemiya.js show ルーカン                     … 取り込まずに、読み取った結果を表示するだけ
 *   オプション: --file data/servants.json（書き込み先） --summary <path>（Markdownの報告） --save-text <dir>（変換したWiki記法を保存）
 *
 * 仕組み：
 *   1) ページ名を EUC-JP でURLにして /d/ページ名 を取得（Seesaa Wiki はブラウザからの直接取得を許していないので、Actions 側で取る）
 *   2) 表示用のHTMLを、リストツールに貼り付けるのと同じ Wiki 記法のテキストに戻す（htmlToWiki）
 *   3) js/parser.js・js/build.js で解析し、公開用の軽いデータ（toLean）にして servants.json に入れる
 *   同じクラス・真名は置き換え。overrides.json の手直し（効果・ステータス・内容の編集）はそのまま残り、読み込み時に掛かる。
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build']) require(path.join(ROOT, 'js', f + '.js'));
const H = globalThis.HGW;

const WIKI = 'https://seesaawiki.jp/kagemiya/';
const UA = '1in7HGW-roster-import (+https://github.com/Pippiniden/1in7HGW)';
const WAIT_MS = +process.env.KAGEMIYA_WAIT_MS || 1500; // 1件ごとに間を空ける（Wikiに負担をかけない）

// ---------- EUC-JP のURL ----------
// Node には EUC-JP の符号化が無いので、復号表を逆引きして作る（初回だけ）
let EUC = null;
function eucTable() {
  if (EUC) return EUC;
  EUC = new Map();
  const dec = new TextDecoder('euc-jp');
  for (let a = 0xa1; a <= 0xfe; a++) for (let b = 0xa1; b <= 0xfe; b++) {
    const ch = dec.decode(Uint8Array.from([a, b]));
    if (ch.length === 1 && ch !== '�' && !EUC.has(ch)) EUC.set(ch, [a, b]);
  }
  for (let b = 0xa1; b <= 0xdf; b++) { const ch = dec.decode(Uint8Array.from([0x8e, b])); if (!EUC.has(ch)) EUC.set(ch, [0x8e, b]); } // 半角カナ
  for (let a = 0xa1; a <= 0xfe; a++) for (let b = 0xa1; b <= 0xfe; b++) { // 補助漢字（3バイト）
    const ch = dec.decode(Uint8Array.from([0x8f, a, b]));
    if (ch.length === 1 && ch !== '�' && !EUC.has(ch)) EUC.set(ch, [0x8f, a, b]);
  }
  return EUC;
}
function eucEncode(s) {
  const t = eucTable(), out = [], missing = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) { out.push(/[A-Za-z0-9\-_.~]/.test(ch) ? ch : '%' + c.toString(16).toUpperCase().padStart(2, '0')); continue; }
    const bytes = t.get(ch);
    if (!bytes) { missing.push(ch); continue; }
    out.push(bytes.map(x => '%' + x.toString(16).toUpperCase()).join(''));
  }
  if (missing.length) throw new Error(`EUC-JPにない文字が含まれています：${missing.join('')}`);
  return out.join('');
}
function pageUrl(name) { return WIKI + 'd/' + eucEncode(name); }

// 入力はページ名でも、ページのURLでもよい
function nameFromInput(s) {
  s = String(s || '').trim();
  const m = s.match(/seesaawiki\.jp\/kagemiya\/d\/([^?#\s]+)/i);
  if (!m) return s;
  const bytes = [];
  for (let i = 0, p = m[1]; i < p.length; i++) {
    if (p[i] === '%') { bytes.push(parseInt(p.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(p.charCodeAt(i));
  }
  return new TextDecoder('euc-jp').decode(Uint8Array.from(bytes));
}

// ---------- 取得 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchPage(name) {
  const url = pageUrl(name);
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
    if (r.status === 404) return { name, url, missing: true };
    if ((r.status === 503 || r.status === 429) && attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const html = new TextDecoder('euc-jp').decode(new Uint8Array(await r.arrayBuffer()));
    return { name, url, html };
  }
}

// ---------- HTML → Wiki 記法 ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', times: '×', copy: '©', hearts: '♥' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c === 0xfeff ? '' : String.fromCodePoint(c); }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}

/** ページの本文部分（<div class="user-area"> の中身）を取り出す */
function contentHtml(html) {
  const start = html.indexOf('<div class="user-area">');
  if (start < 0) return null;
  let end = html.indexOf('<!-- google_ad_section_end(name=s1)', start);
  if (end < 0) end = html.indexOf('id="information-box"', start);
  return html.slice(start + '<div class="user-area">'.length, end < 0 ? undefined : end);
}
function pageTitle(html) {
  const m = html.match(/<div class="title">\s*<div class="inner">\s*<h2>\s*([\s\S]*?)<(?:a|\/h2)/);
  return m ? decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim() : '';
}

/**
 * 表示用のHTMLを、Wiki の編集画面に書かれているのに近いテキストへ戻す。
 * parser.js が読むのは見出し（* / **）・【キー】値・行のまとまりなので、そこが元どおりになればよい。
 */
function htmlToWiki(html) {
  const NL = '\u0001'; // ブロックの区切り（行頭でなければ改行にする）
  let h = html;
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (m, t) => NL + t.replace(/\r?\n/g, '<br>') + NL);
  h = h.replace(/\r?\n/g, ''); // HTML の改行は意味を持たない（Wiki の改行は <br> になっている）
  h = h.replace(/<a[^>]*class="[^"]*part-edit[^"]*"[\s\S]*?<\/a>/gi, '');           // 部分編集のペン
  h = h.replace(/<img\b[^>]*>/gi, '');
  // 脚注（本文中の *1 と、末尾の脚注一覧）は parser が捨てるので最初から入れない
  h = h.replace(/<(a|sup|span)[^>]*class="[^"]*footnote[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '');
  h = replaceElements(h, 'div', /class="[^"]*footnote[^"]*"/, () => '');
  // ルビ・取り消し線・強調
  h = h.replace(/<ruby>\s*(?:<rb>)?([\s\S]*?)(?:<\/rb>)?\s*(?:<rp>[^<]*<\/rp>)?\s*<rt>([\s\S]*?)<\/rt>\s*(?:<rp>[^<]*<\/rp>)?\s*<\/ruby>/gi, (m, base, rt) => `&ruby(${rt.replace(/<[^>]*>/g, '')}){${base.replace(/<[^>]*>/g, '')}}`);
  h = h.replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, '%%$2%%');
  h = h.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, "''$2''");
  // 見出し：h3 → *、h4 → **、h5 → ***
  h = h.replace(/<h([3-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => NL + '*'.repeat(Math.min(3, +n - 2)) + t.replace(/<[^>]*>/g, '').trim() + NL);
  // 折りたたみ（[+]見出し … [END]）
  h = replaceElements(h, 'div', /class="toggle-display"/, inner => inner + NL + '[END]' + NL);
  h = h.replace(/<div class="toggle-title">[\s\S]*?<p>([\s\S]*?)<\/p>\s*<\/div>/gi, (m, t) => NL + '[+]' + t.replace(/<[^>]*>/g, '').trim() + NL);
  // 表：|セル|セル|
  h = h.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (m, row) => NL + '|' + (row.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(c => c.replace(/<\/?t[hd]\b[^>]*>/gi, '').replace(/<br\s*\/?>/gi, '&br;').replace(/<[^>]*>/g, '').trim()).join('|') + '|' + NL);
  // 箇条書き・区切り線
  h = h.replace(/<li\b[^>]*>/gi, NL + '-').replace(/<\/li>/gi, '');
  h = h.replace(/<hr\b[^>]*>/gi, NL + '----' + NL);
  // 改行とブロック
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/?(p|div|ul|ol|table|tbody|thead|tr|pre|blockquote|dl|dt|dd)\b[^>]*>/gi, NL);
  h = h.replace(/<[^>]+>/g, '');
  h = decodeEntities(h);
  h = h.replace(/\u0001+/g, NL).replace(/(^|\n)\u0001/g, '$1').replace(/\u0001/g, '\n');
  return h.split('\n').map(l => l.replace(/[ \t ]+$/g, '')).join('\n').replace(/^\n+/, '').replace(/\n*$/, '\n');
}

// 入れ子を数えて、条件に合う要素を fn(中身) に置き換える（<div> の中に <div> があっても正しく閉じを探す）
function replaceElements(html, tag, attrRe, fn) {
  const open = new RegExp('<' + tag + '\\b[^>]*>', 'gi');
  let out = '', pos = 0, m;
  while ((m = open.exec(html))) {
    if (!attrRe.test(m[0])) continue;
    const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi'); re.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while (depth && (t = re.exec(html))) depth += t[1] ? -1 : 1;
    if (depth) break;
    out += html.slice(pos, m.index) + fn(html.slice(m.index + m[0].length, t.index));
    pos = t.index + t[0].length; open.lastIndex = pos;
  }
  return out + html.slice(pos);
}

// ---------- データの読み書き ----------
function readPack(file) {
  if (!fs.existsSync(file)) return { format: 'hgw-servants', version: 2, lean: true, at: null, servants: [] };
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(d) ? { format: 'hgw-servants', version: 2, lean: true, servants: d } : d;
}
function loadOverrides() {
  const f = path.join(ROOT, 'data', 'overrides.json');
  if (!fs.existsSync(f)) return;
  const o = JSON.parse(fs.readFileSync(f, 'utf8')), E = H.effects;
  const T = E.OVERRIDE_TABLES;
  for (const k in T) if (T[k]) Object.assign(T[k], o[k] || {});
}

/** 1ページ分を取り込む。戻り値: { ok, name, url, servant?, text?, error? } */
async function importOne(name) {
  const page = await fetchPage(name);
  if (page.missing) return { ok: false, missing: true, name, url: page.url, error: 'ページが見つかりません（ページ名が真名と違うときは、ページのURLを入れてください）' };
  const body = contentHtml(page.html);
  if (body == null) return { ok: false, name, url: page.url, error: '本文の場所が見つかりません（ページの形式が変わった可能性）' };
  const title = pageTitle(page.html) || name;
  const text = htmlToWiki(body);
  const parsed = H.parser.parseServant(text, { title, noSource: true });
  parsed.page = title; // 取り直すときに使うWikiのページ名
  const built = H.build.buildServant(parsed);
  return { ok: true, name, title, url: page.url, text, servant: built };
}

// ---------- 報告 ----------
function line(r) {
  if (!r.ok) return `| ❌ | [${r.name}](${r.url || '#'}) | — | ${r.error}${r.flagged ? `（試した名前：${(r.tried || [r.name]).join('、')}。リストツールの詳細の「Wikiのページ名」に正しいページ名を入れて、取り直してください）` : ''} |`;
  const s = r.servant, n = s.review.filter(x => x.kind !== 'class').length;
  const note = [r.change, s.warnings.length ? '読み取りの警告 ' + s.warnings.length : '', n ? '要確認 ' + n : ''].filter(Boolean).join('・');
  return `| ${r.change === '変更なし' ? '＝' : '✅'} | [${s.trueName}](${r.url}) | ${s.class.label} | スキル${s.classSkills.length + s.skills.length}・宝具${s.nps.length}・セリフ${Object.values(s.voice).reduce((t, v) => t + v.length, 0)}　${note} |`;
}
function details(r) {
  if (!r.ok) return '';
  const s = r.servant, L = H.rank.label;
  const sk = s.allSkills.map(k => `${k.name}（${L(k.rank)}）`).join('、') || 'なし';
  const np = s.nps.map(n => `『${n.name}』（${L(n.rank)}・${n.typeRaw || '種別不明'}）`).join('、') || 'なし';
  const w = s.warnings.map(x => `  - ⚠ ${x}`).join('\n');
  const rv = s.review.filter(x => x.kind !== 'class').map(x => `  - ${x.target}：${x.why}`).join('\n');
  const sk2 = (s.skippedItems || []).map(x => x.list === 'section' ? `欄「${x.name}」` : `${x.list === 'nps' ? '宝具' : 'スキル'}「${x.name.length > 30 ? x.name.slice(0, 30) + '…' : x.name}」${x.why === 'merged' ? '（説明に戻した）' : x.why === 'list' ? '（スキルのまとめの一覧）' : ''}`).join('、');
  return `- **${s.trueName}**（${s.class.label}）\n  - スキル：${sk}\n  - 宝具：${np}` + (sk2 ? `\n  - 読み飛ばし（FGO風の欄・詠唱の行）：${sk2}` : '') + (w ? '\n' + w : '') + (rv ? '\n' + rv : '');
}

// ---------- 実行 ----------
function parseArgs(argv) {
  const o = { cmd: argv[0], names: [], file: path.join(ROOT, 'data', 'servants.json'), summary: null, saveText: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') o.file = path.resolve(argv[++i]);
    else if (a === '--summary') o.summary = path.resolve(argv[++i]);
    else if (a === '--save-text') o.saveText = path.resolve(argv[++i]);
    else o.names.push(...a.split(/[\n,、，]+/));
  }
  o.names = o.names.map(nameFromInput).map(s => s.trim()).filter(Boolean);
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!['add', 'refresh', 'show'].includes(o.cmd)) {
    console.error('使い方: node tools/kagemiya.js add|refresh|show [ページ名…] [--file data/servants.json] [--summary 報告.md] [--save-text フォルダ]');
    process.exit(2);
  }
  loadOverrides();
  const pack = readPack(o.file);
  const list = pack.servants;

  // 取り込む対象（ページ名）を決める
  let targets;
  if (o.cmd === 'refresh') {
    // ページ名は、手直し表（overrides.json の pages）→ 取り込んだときのページ名 → 真名 の順
    // 真名・クラスを手直ししている騎は、手直しした真名でもページ名の手直しを引く（組み立ててから見る）
    const built = new Map(list.map(s => { try { return [s, H.build.fromJSON(s)]; } catch (e) { return [s, s]; } }));
    const pg = s => H.build.pageOf(built.get(s)) || H.build.pageOf(s);
    const names = s => [s.trueName, built.get(s).trueName, s.page, pg(s)];
    const pick = o.names.length ? list.filter(s => names(s).some(n => o.names.includes(n))) : list;
    const unknown = o.names.filter(n => !list.some(s => names(s).includes(n)));
    // ページ名が分からない騎は、真名 →「真名(クラス)」の順に探す
    const alts = s => pg(s) ? [] : [s.trueName + '(' + s.class.label + ')', s.trueName + '（' + s.class.label + '）'];
    targets = pick.map(s => ({ name: pg(s) || s.trueName, alts: alts(s), prevId: s.id })).concat(unknown.map(n => ({ name: n, notInRoster: true })));
  } else targets = o.names.map(n => ({ name: n }));
  targets = targets.filter((t, i, a) => a.findIndex(x => x.name === t.name) === i);
  if (!targets.length) { console.error('取り込むページ名がありません'); process.exit(2); }

  const results = [];
  for (const [i, t] of targets.entries()) {
    if (i) await sleep(WAIT_MS);
    let r;
    try {
      r = await importOne(t.name);
      for (const alt of t.alts || []) { if (!r.missing) break; await sleep(WAIT_MS); const r2 = await importOne(alt); if (r2.ok) { r2.name = t.name; r = r2; } }
    } catch (e) { r = { ok: false, name: t.name, url: (() => { try { return pageUrl(t.name); } catch (_) { return null; } })(), error: e.message }; }
    if (r.ok && t.notInRoster && o.cmd === 'refresh') r.change = 'リストに無かったので追加';
    if (!r.ok && r.missing) r.tried = [t.name].concat(t.alts || []);
    results.push(r);
    console.log(r.ok ? `✓ ${r.servant.class.label}・${r.servant.trueName}` : `✗ ${t.name}：${r.error}`);
    if (r.ok && o.saveText) { fs.mkdirSync(o.saveText, { recursive: true }); fs.writeFileSync(path.join(o.saveText, r.title.replace(/[\\/:*?"<>|]/g, '_') + '.txt'), r.text); }
  }

  // リストに反映（show は反映しない）
  let flagged = 0, newFlags = 0;
  if (o.cmd !== 'show') {
    for (const r of results) {
      // 取り直しでページが見つからなかった騎には印を付ける（リストツールで分かるように。次に見つかれば消える）
      if (!r.ok && r.missing) {
        const t = targets.find(x => x.name === r.name), s = t && t.prevId && list.find(x => x.id === t.prevId);
        if (s) {
          const tried = r.tried || [r.name];
          if (!s.pageMissing || JSON.stringify(s.pageMissing.tried) !== JSON.stringify(tried)) newFlags++; // 新しく見つからなくなった騎だけ「変更」に数える
          s.pageMissing = { at: new Date().toISOString().slice(0, 10), tried }; flagged++; r.flagged = true;
        }
        continue;
      }
      if (!r.ok) continue;
      const lean = H.build.toLean(r.servant);
      const target = targets.find(t => t.name === r.name);
      let i = list.findIndex(s => s.id === lean.id);
      if (i < 0 && target && target.prevId) i = list.findIndex(s => s.id === target.prevId); // クラスの読みが変わった場合も同じ騎として置き換える
      if (i >= 0) {
        // 別のページ（同じ真名の別の英霊など）から取り込んだときは、前の騎に付けた手直しがそのまま新しい騎に掛かる。報告して知らせる
        const old = list[i], otherPage = old.page && lean.page && old.page !== lean.page, otherCls = old.id !== lean.id;
        if (otherPage || otherCls) {
          const left = leftovers(old);
          if (left.length) r.leftovers = { from: old.page || old.trueName, cls: old.class && old.class.label, keys: left };
        }
        const same = JSON.stringify(stripVolatile(list[i])) === JSON.stringify(stripVolatile(lean));
        r.change = r.change || (same ? '変更なし' : list[i].id !== lean.id ? `置き換え（${list[i].class.label}→${r.servant.class.label}）` : '更新');
        list[i] = lean;
      } else { list.push(lean); r.change = r.change || '追加'; }
    }
    const CLS = Object.keys(H.CONFIG.CLASS_DEFS);
    const ord = s => { const k = H.parser.parseClass(s.class.raw || s.class.label || '').key, i = CLS.indexOf(k); return i < 0 ? 99 : i; };
    list.sort((a, b) => ord(a) - ord(b) || a.trueName.localeCompare(b.trueName, 'ja'));
    pack.servants = list; pack.at = new Date().toISOString(); pack.lean = true;
    if (flagged || results.some(r => r.ok && r.change !== '変更なし')) fs.writeFileSync(o.file, JSON.stringify(pack, null, 1) + '\n');
  } else for (const r of results) if (r.ok) console.log('\n' + details(r));

  // 報告（GitHub のジョブ概要・PRの本文に使う）
  const ok = results.filter(r => r.ok), ng = results.filter(r => !r.ok);
  const changed = ok.filter(r => r.change !== '変更なし');
  const md = [
    `## kagemiya@ふたば から取り込み（${o.cmd === 'refresh' ? '取り直し' : o.cmd === 'show' ? '確認のみ' : '追加'}）`,
    '',
    `取得 ${ok.length}件・失敗 ${ng.length}件` + (o.cmd !== 'show' ? `・リストの変更 ${changed.length}件（リストは全${list.length}騎）` : '') + (flagged ? `・ページが見つからなかった騎 ${flagged}（リストツールで「ページ名？」の印が付きます）` : ''),
    '',
    '| | 真名 | クラス | 内容 |', '|---|---|---|---|',
    ...results.map(line),
    '',
    '<details><summary>読み取ったスキル・宝具</summary>', '', ...ok.map(details), '', '</details>',
    '',
    ...(ok.some(r => r.leftovers) ? ['', '### ⚠ 前の騎の手直しが残っています', '',
      '別のページ（同じ真名の別の英霊など）から取り込み直した騎です。前の騎に付けた手直しは、名前で引くので新しい騎にもそのまま掛かります（スキルの内容の手直しは、Wikiの内容の代わりに使われます）。'
      + '取り違えを直したときは、マージしたあとリストツールでその騎を開き「この騎の手直しをすべて消す」を押して、「手直し表を保存」で公開してください（`node tools/servant.js wipe 真名` でも消せます）。', '',
      ...ok.filter(r => r.leftovers).map(r => `- **${r.servant.trueName}**（前：${r.leftovers.from}${r.leftovers.cls && r.leftovers.cls !== r.servant.class.label ? `・${r.leftovers.cls}` : ''} → 今：${r.title}・${r.servant.class.label}）：${r.leftovers.keys.map(k => k.ja + '「' + k.key + '」').join('、')}`)] : []),
    '',
    '内容がおかしい騎は、リストツールの「内容を編集」で直せます（直した内容は overrides.json に入り、次に取り直しても残ります）。',
  ].join('\n');
  if (o.summary) fs.writeFileSync(o.summary, md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length + newFlags}\nok=${ok.length}\nfailed=${ng.length}\n`);
  if (!ok.length && !newFlags) process.exitCode = 1; // 見つからなかった印だけでも、反映（プルリクエスト）はする
}

/** その騎に付いた手直し（内容と真名の変更は Wikiでの真名、効果・宝具・ステータス・確認済みは表示の真名で引く）。ページ名は数えない */
function leftovers(lean) {
  const E = H.effects, out = [], wn = lean.trueName;
  let dn = wn; try { dn = H.build.fromJSON(lean).trueName; } catch (e) { /* 組み立てられなければ Wiki の真名で */ }
  if (E.CONTENT_OVERRIDES[wn]) out.push({ table: 'content', key: wn, ja: E.CONTENT_OVERRIDES[wn].identity ? '内容・真名の変更' : '内容' });
  for (const [t, ja] of [['servant', '効果'], ['np', '宝具の扱い']]) for (const k of Object.keys(E.OVERRIDE_TABLES[t])) if (k.startsWith(dn + '/')) out.push({ table: t, key: k, ja });
  for (const [t, ja] of [['stats', 'ステータス'], ['reviewed', '確認済み']]) if (E.OVERRIDE_TABLES[t][dn]) out.push({ table: t, key: dn, ja });
  return out;
}

// 比較のときは取り込み時刻などを無視する
function stripVolatile(s) { const o = JSON.parse(JSON.stringify(s)); delete o.built; return o; }

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { eucEncode, pageUrl, nameFromInput, contentHtml, pageTitle, htmlToWiki, importOne, leftovers };
