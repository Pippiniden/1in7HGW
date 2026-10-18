/* kagemiya@ふたば（Seesaa Wiki）のサーヴァントページのテキストを解析する
 *
 * 2段階になっている：
 *   1) parsePage  … Wiki記法を「基本情報（【キー】値）」「セクション」「項目（**見出し）」に分けるだけの汎用処理
 *   2) parseServant … それをサーヴァントのデータとして解釈する
 * マスターのページも同じ parsePage を通して master.js 側で解釈できる。
 */
(function (G) {
  'use strict';
  const R = G.rank;

  // ---------- Wiki記法の除去 ----------
  function stripMarkup(s, keepStrike) {
    let t = String(s == null ? '' : s);
    t = t.replace(/&ruby\(([^)]*)\)\{([^}]*)\}/g, '$2');
    t = t.replace(/&(?:color|size|bgcolor|font)\([^)]*\)\{([^}]*)\}/g, '$1');
    t = t.replace(/&br;?/g, '\n');
    t = t.replace(/%%%([\s\S]*?)%%%/g, '$1');                         // 下線
    t = keepStrike ? t.replace(/%%([\s\S]*?)%%/g, '$1') : t.replace(/%%([\s\S]*?)%%/g, ''); // 取り消し線（冗談の書き込みは既定で捨てる）
    t = t.replace(/'''([\s\S]*?)'''/g, '$1').replace(/''([\s\S]*?)''/g, '$1');
    t = t.replace(/\[\[([^\]>|]*)(?:[>|][^\]]*)?\]\]/g, '$1');
    t = t.replace(/\(\(([\s\S]*?)\)\)/g, '');                         // 脚注
    t = t.replace(/^#\w+.*$/gm, '').replace(/^\/\/.*$/gm, '');         // #contents やコメント行
    t = t.replace(/~\s*$/gm, '');                                      // 行末改行記号
    return t.replace(/[ \t　]+$/gm, '').trim();
  }

  // &ruby(読み){表記} から 表記と読みを両方取り出す
  function nameAndReading(s) {
    const src = String(s || '');
    const hasRuby = /&ruby\(/.test(src);
    const name = stripMarkup(src).replace(/^[『「【]|[』」】]$/g, '').replace(/^[『「]|[』」]/g, '').trim();
    const reading = hasRuby ? stripMarkup(src.replace(/&ruby\(([^)]*)\)\{([^}]*)\}/g, '$1')).replace(/[『』「」]/g, '').trim() : '';
    return { name, reading: reading && reading !== name ? reading : '' };
  }

  // ---------- セクションの判定 ----------
  const SECTIONS = [
    ['info', /^(基本情報|基本データ|プロフィール|データ|ステータス)$/],
    ['classSkills', /クラス(別|固有)?スキル/],
    ['skills', /^(保有|固有|個人)?スキル$/],
    ['np', /^宝具$/],
    ['weapon', /^(weapon|weapons|武器|武装|装備)$/i],
    ['commentary', /^(解説|来歴|逸話|経歴|生前|伝承)/],
    ['personality', /^(人物|性格|人物・性格|人物像)/],
    ['relations', /^(因縁|関係|因縁キャラ|関連人物)/],
    ['voice', /^(セリフ|台詞|ボイス|マイルーム)/],
    ['comment', /^(コメント|備考|メモ|作者|製作者)/],
  ];
  function sectionKeyOf(text) {
    const t = R.normalize(stripMarkup(text)).replace(/[【】\[\]<>＜＞■□◆◇●○・:：\s]/g, m => (m === '・' ? '・' : '')).trim();
    if (!t || t.length > 14 || /^[『「]/.test(text.trim())) return null;
    for (const [k, re] of SECTIONS) if (re.test(t)) return k;
    return null;
  }
  const HEADER_RE = /^([*!]{1,4})\s*(.*)$/;

  // ---------- FGO風の欄（ゲームでは使わない） ----------
  // 【FGO風性能】のような見出しの下には、レア度・霊基再臨・基本ステータス・所有カード・所有スキル・クラススキル・
  // アペンドスキル（Skill1〜）・宝具・攻撃モーションなどが並ぶ。中の「クラススキル」「宝具」の見出しで本来の欄に
  // 切り替わってしまわないよう、この欄の中の見出しは項目として読み捨てる（次の同じ深さの見出しで抜ける）。
  const FGO_HEAD = /FGO|Grand\s*Order|グランドオーダー|ソシャゲ風|ゲーム風|^性能$/i;
  // FGO風の欄に出てくる項目の名前（見出しが無くても、これが出たらそこから先はFGO風の欄とみなす）。
  // FGO_STRONG はどの欄に出てもFGO風とみなす（解説の続きに並ぶこともある）。霊基再臨・性能などは解説にも出るので、
  // スキル・宝具の欄の中に出たときだけ
  const FGO_STRONG = /FGO|^(アペンドスキル|所有スキル|所有カード|基本ステータス|攻撃モーション|絆礼装|レア度)|^☆\s*\d|^(skill|スキル)\s*\d/i;
  const FGO_ITEM = /FGO|^(アペンドスキル|所有スキル|所有カード|基本ステータス|攻撃モーション|霊基再臨|絆礼装|レア度|ILLUST$|SKILL$|カード(性能|構成)?$|性能(概要|解説)?$|スキル強化|宝具強化|(バトル|攻撃)ボイス)|^☆\s*\d|^(skill|スキル)\s*\d|^第[一二三四1-4]再臨/i;
  const normHead = t => R.normalize(stripMarkup(t)).replace(/^[【\[■□◆◇●○\s]+|[】\]\s]+$/g, '').trim();
  const isFgoHead = t => FGO_HEAD.test(normHead(t));
  const isFgoItemName = t => FGO_ITEM.test(normHead(t));
  const isFgoStrong = t => FGO_STRONG.test(normHead(t));
  // 説明がFGO風の表（Lv.1〜・HP/ATK・Buster/Quick/Arts・Hit数 など）
  const FGO_TABLE = /\|\s*(Lv\.?\s*1|HP|ATK|COST|Buster|Quick|Arts|Hit数|CT|段階|能力値)\s*\|/i;
  // FGO風の性能の書き方（カード・ターン数・NP・スターなど）
  const FGO_TEXT = /カード性能|NP(獲得|チャージ|を?増や)|スター(発生|集中|獲得)|無敵貫通|オーバーチャージ|[(（]\d+T[)）、,，]|種類[:：]\s*(クイック|バスター|アーツ|Quick|Buster|Arts)|宝具威力アップ/i;

  // スキル行「名前：A」の判定（ランク部分が本当にランクらしいときだけ）
  const RANK_TOKEN = /^(?:EX|[A-E]|-|―|ー|\?|測定不能|規格外|なし)[A-E+\-~()?/\w\s぀-ヿ一-鿿]{0,24}$/i;
  function splitNameRank(s) {
    const t = stripMarkup(s).replace(/（/g, '(').replace(/）/g, ')').replace(/^【|】(?=\s*[:：])/g, '').trim();
    let m = t.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (m && RANK_TOKEN.test(R.normalize(m[2]))) return { name: m[1].replace(/[【】]/g, '').trim(), rankRaw: m[2].trim() };
    m = R.normalize(t).match(/^(.+?)\s+((?:EX|[A-E])[+\-]*(?:\(.*\))?)$/);
    if (m) return { name: m[1].replace(/[【】]/g, '').trim(), rankRaw: m[2].trim() };
    return { name: t.replace(/[【】]/g, '').trim(), rankRaw: '' };
  }
  function looksLikeSkillLine(line) {
    const t = stripMarkup(line);
    if (t.length > 40 || /[。、]$/.test(t)) return false;
    const m = t.match(/^【?([^：:【】「」『』。]{1,24})】?\s*[:：]\s*(.+)$/);
    return !!(m && RANK_TOKEN.test(R.normalize(m[2])) && R.parseRank(m[2]).base != null);
  }

  /**
   * 汎用のページ分解。
   * 戻り値: { info: [{key, value}], sections: [{key, title, lines, items: [{title, lines}]}] }
   */
  function parsePage(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const page = { info: [], sections: [] };
    let sec = { key: 'info', title: '(先頭)', lines: [], items: [] }; page.sections.push(sec);
    let item = null, fgoLv = 0; // fgoLv：FGO風の欄の中にいるとき、その欄の見出しの深さ（それより深い見出しは欄の中）
    const newSection = (key, title) => { sec = { key, title, lines: [], items: [] }; page.sections.push(sec); item = null; };
    const newItem = (title) => { item = { title, lines: [] }; sec.items.push(item); };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const h = line.match(HEADER_RE);
      const bare = !h && /^\s*【[^】]{1,14}】\s*$/.test(line) ? line.trim() : null; // 記号なしの見出し「【宝具】」
      if (h || bare) {
        const text = h ? h[2] : bare, lv = h ? h[1].length : 1;
        if (fgoLv) { if (lv > fgoLv) { newItem(text); continue; } fgoLv = 0; }
        if (lv === 1 && isFgoHead(text)) { newSection('fgo', stripMarkup(text)); fgoLv = 1; continue; }
        if (lv >= 2 && (['skills', 'classSkills', 'np', 'other'].includes(sec.key) ? isFgoItemName(text) : sec.key !== 'info' && isFgoStrong(text))) { newSection('fgo', stripMarkup(text)); fgoLv = lv - 1; continue; }
        const key = sectionKeyOf(text);
        if (key && !looksLikeSkillLine(text)) { newSection(key, stripMarkup(text)); continue; }
        if (h && h[1].length === 1 && !looksLikeSkillLine(text)) { newSection('other', stripMarkup(text)); continue; }
        newItem(text); continue;
      }
      // 見出し記号なしで書かれた項目の始まり
      if ((sec.key === 'skills' || sec.key === 'classSkills') && looksLikeSkillLine(line)) { newItem(line); continue; }
      // 宝具名らしい行：『…』で始まる行か、「…」だけの短い行（中に句読点や！？があるものは詠唱・セリフなので説明のまま）
      if ((sec.key === 'np' || sec.key === 'weapon') && stripMarkup(line).length <= 60 && (/^\s*『/.test(line) || /^\s*「[^」。、！？!?]{1,30}」\s*$/.test(stripMarkup(line)))) { newItem(line); continue; }
      (item ? item.lines : sec.lines).push(line);
    }
    // 【キー】値 の組を集める（基本情報セクション＋どこにあっても拾う一人称など）
    for (const s of page.sections) {
      if (s.key === 'fgo') continue;
      const src = s.key === 'info' ? s.lines.concat(...s.items.map(i => [i.title, ...i.lines])) : s.lines;
      for (const l of src) {
        const re = /【([^】]{1,20})】\s*([^【]*)/g; let m;
        while ((m = re.exec(l))) { const v = stripMarkup(m[2]).trim(); if (sectionKeyOf('【' + m[1] + '】') && !v) continue; page.info.push({ key: m[1].trim(), value: v, section: s.key }); }
      }
    }
    return page;
  }

  // ---------- サーヴァントとしての解釈 ----------
  const INFO_KEYS = [
    ['origin', /^(元ネタ|出典|出展|原典)/],
    ['class', /^(CLASS|クラス)$/i],
    ['trueName', /^(真名|名前|氏名)$/],
    ['aliases', /^(異名|別名|表記揺れ|異名・別名・表記揺れ)/],
    ['sex', /^性別$/],
    ['body', /^(身長|体重|身長・体重)/],
    ['alignment', /^属性$/],
    ['attribute', /^(天地人属性|天地人)$/],
    ['traits', /^(その他属性|特性|その他の属性)$/],
    ['stats', /^(ステータス|パラメータ|パラメーター)$/],
    ['region', /^(地域|出身|出身地)$/],
    ['era', /^(時代|年代)$/],
    ['firstPerson', /^一人称$/],
    ['secondPerson', /^二人称$/],
    ['thirdPerson', /^三人称$/],
  ];
  function infoKeyOf(k) { const n = R.normalize(k); for (const [key, re] of INFO_KEYS) if (re.test(n)) return key; return null; }

  // クラスの判定は config.js の CLASS_DEFS（登録制）を使う。新しいクラスはそちらに足す
  function parseClass(raw) {
    const s = R.normalize(raw || '').toLowerCase();
    const defs = G.CONFIG.CLASS_DEFS, hits = [];
    for (const key of Object.keys(defs)) {
      for (const a of defs[key].aliases || []) {
        const at = s.indexOf(String(a).toLowerCase());
        if (at >= 0) { hits.push({ key, at, len: a.length }); break; }
      }
    }
    // 同じ位置で複数当たったら長い表記を優先（例：セイヴァー と セイバー）
    hits.sort((a, b) => a.at - b.at || b.len - a.len);
    const seen = new Set(), uniq = hits.filter(h => !seen.has(h.key) && seen.add(h.key));
    if (!uniq.length) {
      const label = R.normalize(raw || '').replace(/[(（].*?[)）]/g, '').trim() || '不明';
      return { key: 'extra', label, raw: raw || '', standard: false, sub: [], unknown: true };
    }
    const k = uniq[0].key, def = defs[k];
    return { key: k, label: def.label, raw: raw || '', standard: def.slot === 'standard', sub: uniq.slice(1).map(h => h.key) };
  }

  const STAT_LABELS = [['str', '筋力'], ['end', '耐久'], ['agi', '敏捷'], ['mag', '魔力'], ['luk', '幸運'], ['np', '宝具']];
  // 1行からステータスを読む。min 個以上読めたら { stats, n, label } を返す（label は「筋力」より前の文字＝形態名など）
  function parseStatLine(line, min) {
    const t = R.normalize(stripMarkup(line)).replace(/[|｜]/g, ' ');
    const out = {}; let n = 0;
    const all = STAT_LABELS.map(x => x[1]).join('|');
    for (const [k, lab] of STAT_LABELS) {
      const m = t.match(new RegExp('(?:^|[\\s:：、,】【\\[\\]])' + lab + '\\s*[:：=]?\\s*(.*?)\\s*(?=(?:' + all + ')\\s*[:：=]?|$)'));
      if (!m || !m[1] || !m[1].trim()) continue;
      const rk = R.parseRank(m[1]);
      if (rk.base == null && !rk.none && !rk.unknown) continue;
      if (rk.unknown && rk.base == null && !/^[?？]/.test(m[1].trim())) continue; // 文章中の「魔力」などは無視
      const raw = m[1].trim().replace(/[】\]）)]+$/, '').replace(/^[【\[（(]+/, '').trim();
      out[k] = { raw, rank: R.parseRank(raw) }; n++;
    }
    if (n < (min == null ? 3 : min)) return null;
    const first = t.search(new RegExp(all));
    const label = first > 0 ? t.slice(0, first).replace(/^[※*\s]+|[:：\s【】]+$/g, '').replace(/【?ステータス】?/, '').trim() : '';
    return { stats: out, n, label };
  }
  // 複数行に分かれたステータス（表の2段組など）を1組にまとめる
  function collectStats(allLines) {
    const groups = []; let cur = null, lastIdx = -9;
    allLines.forEach((l, i) => {
      const r = parseStatLine(l, 2);
      if (!r) return;
      const overlap = cur && Object.keys(r.stats).some(k => cur.stats[k]);
      if (!cur || overlap || i - lastIdx > 2 || r.label) { cur = { stats: {}, label: r.label }; groups.push(cur); }
      Object.assign(cur.stats, r.stats); lastIdx = i;
    });
    return groups.filter(g => Object.keys(g.stats).length >= 3);
  }

  function splitList(s) { return String(s || '').split(/[、,，・/／]+/).map(x => x.trim()).filter(Boolean); }

  function itemsToSkills(sec) {
    return sec.items.map(it => {
      const nr = splitNameRank(it.title);
      return { name: nr.name, rankRaw: nr.rankRaw, rank: R.parseRank(nr.rankRaw), desc: stripMarkup(it.lines.join('\n')) };
    }).filter(s => s.name);
  }

  const NP_TYPES = [
    ['anti_world', /対界|対星|対惑星|対宇宙/], ['anti_nation', /対国|対大陸/], ['anti_fort', /対城|対要塞|対山|対都市|対街/],
    ['barrier', /結界/], ['anti_army', /対軍|対群|対集団|対陣/], ['self', /対己|対自身|対自己|対自分|自己/],
    ['anti_unit', /対人|対個|対英雄|対神|対竜|対魔|対悪|対霊|対獣|対物/],
  ];
  function npTypeKey(raw) { const s = R.normalize(raw || ''); for (const [k, re] of NP_TYPES) if (re.test(s)) return k; return s ? 'special' : null; }
  function parseNum(s) { const m = R.normalize(s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; }
  function parseRange(s) {
    const n = R.normalize(s || ''); const nums = (n.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null; return nums.length === 1 ? [nums[0], nums[0]] : [Math.min(...nums), Math.max(...nums)];
  }
  function parseNpMeta(text) {
    const t = R.normalize(stripMarkup(text));
    const f = lab => { const m = t.match(new RegExp(lab + '\\s*[:：]\\s*(.*?)\\s*(?=ランク\\s*[:：]|種別\\s*[:：]|レンジ\\s*[:：]|最大捕捉\\s*[:：]|$)')); return m ? m[1].trim() : null; };
    return { rankRaw: f('ランク'), typeRaw: f('種別'), rangeRaw: f('レンジ'), maxRaw: f('最大捕捉') };
  }
  function itemsToNPs(sec, warnings) {
    const out = [];
    const items = sec.items.slice();
    // 見出しがなく、セクション直下にランク行がある場合
    if (!items.length && sec.lines.some(l => /ランク\s*[:：]/.test(l))) {
      const i = sec.lines.findIndex(l => /ランク\s*[:：]/.test(l));
      const title = sec.lines.slice(0, i).reverse().find(l => l.trim()) || '(名称不明の宝具)';
      items.push({ title, lines: sec.lines.slice(i) });
      warnings.push('宝具の見出しが見つからず、前の行を宝具名として扱いました');
    }
    for (const it of items) {
      let metaIdx = it.lines.findIndex(l => /ランク\s*[:：]/.test(l) || /種別\s*[:：]/.test(l));
      let meta = metaIdx >= 0 ? parseNpMeta(it.lines[metaIdx]) : null;
      if (!meta && /ランク\s*[:：]/.test(it.title)) meta = parseNpMeta(it.title); // 見出しと同じ行に書かれている
      const titleOnly = it.title.replace(/''?.*?ランク\s*[:：][\s\S]*$/, '').replace(/ランク\s*[:：][\s\S]*$/, '');
      const nr = nameAndReading(titleOnly.trim());
      const desc = stripMarkup(it.lines.filter((_, i) => i !== metaIdx).join('\n'));
      const np = {
        name: nr.name, reading: nr.reading,
        rankRaw: meta ? meta.rankRaw || '' : '', rank: R.parseRank(meta ? meta.rankRaw : ''),
        typeRaw: meta ? meta.typeRaw || '' : '', typeKey: npTypeKey(meta ? meta.typeRaw : ''),
        rangeRaw: meta ? meta.rangeRaw || '' : '', range: parseRange(meta ? meta.rangeRaw : ''),
        maxRaw: meta ? meta.maxRaw || '' : '', maxTargets: parseNum(meta ? meta.maxRaw : ''),
        desc,
      };
      if (!meta) warnings.push(`宝具「${np.name}」のランク・種別の行が見つかりません`);
      out.push(np);
    }
    return out;
  }

  // 「召喚：「…」」のようなセリフ行
  function collectVoice(lines, voice) {
    let last = null;
    for (const l of lines) {
      const t = stripMarkup(l);
      const m = t.match(/^([^：:「」]{1,16})\s*[:：]\s*「([\s\S]+)」\s*$/);
      if (!m) continue;
      let k = m[1].trim();
      if (/^その\d+$|^\d+$/.test(k) && last) k = last; else last = k;
      (voice[k] = voice[k] || []).push(m[2]);
    }
  }
  function collectPairs(lines) {
    const out = [];
    for (const l of lines) {
      const t = stripMarkup(l);
      if (/「/.test(t.split(/[:：]/)[1] || '')) continue;
      const m = t.match(/^([^：:「」。]{1,24})\s*[:：]\s*(.+)$/);
      if (m) out.push({ key: m[1].trim(), value: m[2].trim() });
    }
    return out;
  }
  const PROFILE_KEYS = [['imageColor', /イメージカラー/], ['specialty', /^特技/], ['likes', /^好きなもの|^好きな物|^好物/], ['dislikes', /^嫌いなもの|^嫌いな物|^苦手/],
    ['nemesis', /^天敵/], ['wish', /^願い|^聖杯への願い|^聖杯にかける願い/]];

  /** サーヴァントページを解析する。opts.title にページ名を渡すと真名が無いときに使う */
  function parseServant(text, opts) {
    opts = opts || {};
    const page = parsePage(text);
    const warnings = [];
    const sv = {
      kind: 'servant', id: null, trueName: '', aliases: [], class: null, origin: '', sex: '', alignment: '', attribute: '', traits: [],
      stats: {}, statsAlt: [], classSkills: [], skills: [], nps: [], weapons: [],
      profile: {}, relations: [], voice: {}, text: {}, info: {}, warnings,
    };
    for (const { key, value } of page.info) {
      const k = infoKeyOf(key);
      sv.info[key] = sv.info[key] ? sv.info[key] + ' / ' + value : value;
      if (!k) continue;
      if (k === 'aliases') sv.aliases = String(value).split(/[、,，/／]+/).map(x => x.trim()).filter(Boolean);
      else if (k === 'traits') sv.traits = splitList(value);
      else if (k === 'class') sv.class = parseClass(value);
      else if (k === 'stats') { /* 下でまとめて */ }
      else if (k === 'firstPerson' || k === 'secondPerson' || k === 'thirdPerson') sv.profile[k] = value;
      else if (!sv[k]) sv[k] = value;
    }
    // ステータス：「筋力」と「耐久」を含む行を全部拾い、最初を本体、残りを別形態として持つ
    const allLines = [];
    for (const s of page.sections) if (!['np', 'skills', 'classSkills', 'weapon', 'relations', 'voice', 'fgo'].includes(s.key)) allLines.push(...s.lines, ...[].concat(...s.items.map(i => [i.title, ...i.lines])));
    const parsedStats = collectStats(allLines);
    if (parsedStats.length) {
      sv.stats = parsedStats[0].stats;
      sv.statsAlt = parsedStats.slice(1).map((g, i) => ({ label: g.label || '別形態' + (i + 1), stats: g.stats }));
      for (const [k, lab] of STAT_LABELS) if (!sv.stats[k]) warnings.push(`ステータス「${lab}」が読み取れません`);
    } else warnings.push('ステータスの行が見つかりません');

    if (!sv.class) { sv.class = parseClass(''); warnings.push('クラスが見つかりません'); }
    if (!sv.trueName) { sv.trueName = opts.title || ''; warnings.push(opts.title ? '真名が無いのでページ名を使いました' : '真名が見つかりません'); }

    for (const s of page.sections) {
      if (s.key === 'classSkills') sv.classSkills.push(...itemsToSkills(s));
      else if (s.key === 'skills') sv.skills.push(...itemsToSkills(s));
      else if (s.key === 'np') sv.nps.push(...itemsToNPs(s, warnings));
      else if (s.key === 'weapon') sv.weapons.push(...s.items.map(it => Object.assign(nameAndReading(it.title), { desc: stripMarkup(it.lines.join('\n')) })));
      const body = s.lines.concat(...s.items.map(i => [i.title, ...i.lines]));
      if (['commentary', 'personality', 'comment', 'voice', 'other'].includes(s.key)) {
        const t = stripMarkup(body.join('\n')); if (t) sv.text[s.key] = sv.text[s.key] ? sv.text[s.key] + '\n\n' + t : t;
      }
      if (s.key === 'relations') for (const p of collectPairs(body)) sv.relations.push({ name: p.key, text: p.value });
      if (s.key === 'fgo') continue;
      collectVoice(body, sv.voice);
      if (s.key !== 'relations' && s.key !== 'np' && s.key !== 'skills' && s.key !== 'classSkills') {
        for (const p of collectPairs(body)) for (const [pk, re] of PROFILE_KEYS) if (re.test(p.key) && !sv.profile[pk]) sv.profile[pk] = p.value;
      }
    }
    if (!sv.skills.length && !sv.classSkills.length) warnings.push('スキルが1つも見つかりません');
    if (!sv.nps.length) warnings.push('宝具が見つかりません');
    for (const sk of sv.classSkills.concat(sv.skills)) if (sk.rankRaw && sk.rank.base == null && !sk.rank.none) warnings.push(`スキル「${sk.name}」のランク「${sk.rankRaw}」を読めませんでした`);

    // 読み飛ばしたFGO風の欄（見出しごと）。外した項目と同じく sv.skippedItems に残す（公開用のデータには入らない）
    const fgoSecs = page.sections.filter(s => s.key === 'fgo');
    if (fgoSecs.length) sv.skippedItems = fgoSecs.map(s => ({ list: 'section', name: s.title, why: 'fgo' }));
    sv.id = (sv.class.key || 'extra') + ':' + (sv.trueName || 'unknown');
    if (!opts.noSource) sv.sourceText = String(text || '');
    return finalize(sv);
  }

  /**
   * 解析後の仕上げ。古い形式のJSON（過去に書き出したもの）にも何度かけてもよい。
   *   - 宝具名に「名前(読み)」と書かれているものを名前と読みに分ける
   *   - 宝具・スキルの説明文中に書かれた別のステータス（【筋力：B 耐久：C …】）を別ステータスとして拾う
   */
  const READING_RE = /^[\u30A0-\u30FF\u3040-\u309Fー・=＝\s\w.'’&!?！？-]+$/;
  /**
   * 読み取りの間違いを取り除く（古いデータにも、読み込むたびに掛かる）。取り除いたものは sv.skippedItems に残す。
   *   - FGO風の欄の項目（Skill1〜・アペンドスキル・所有カード・攻撃モーション、説明がFGO風の表や性能の書き方のもの）：
   *     その項目から先の、ランクの無い項目と、すでに出た名前の項目をスキル・宝具から外す（ランクの無い同じ名前の項目も外す）
   *   - 宝具の説明の中の詠唱・セリフの行が宝具として読まれたもの（ランクも種別も無く、文のような名前・説明なし）：
   *     ひとつ前の宝具の説明に戻す
   */
  function cleanItems(sv) {
    const skipped = sv.skippedItems || [];
    const note = (list, name, why) => { if (!skipped.some(x => x.list === list && x.name === name && x.why === why)) skipped.push({ list, name, why }); };
    const blank = v => !String(v == null ? '' : v).trim();
    const isFgo = x => isFgoItemName(x.name || '') || (blank(x.rankRaw) && (FGO_TABLE.test(x.desc || '') || FGO_TEXT.test(x.desc || '') || /^\s*\|\|/.test(x.desc || '')));
    const seen = new Set();
    for (const [key, isNp] of [['classSkills', false], ['skills', false], ['nps', true]]) {
      const list = sv[key] || [];
      let zone = false, carry = ''; const out = [];
      for (const x of list) {
        // 「ランク：B++　種別：対軍宝具」が一つの欄に入った宝具（ランクの欄に種別が混ざった）
        if (isNp && /種別/.test(x.rankRaw || '') && blank(x.typeRaw)) {
          const m = String(x.rankRaw).match(/^(.*?)\s*種別\s*[:：]?\s*(.*)$/);
          if (m) { x.rankRaw = m[1].trim(); x.typeRaw = m[2].trim(); x.rank = G.rank.parseRank(x.rankRaw); x.typeKey = npTypeKey(x.typeRaw); }
        }
        const fg = isFgo(x); if (fg) zone = true;
        const noRank = blank(x.rankRaw) && (!isNp || blank(x.typeRaw));
        // FGO風の項目・その先のランクの無い項目・すでに出た名前でランクの無い項目（FGO風の欄の同じ宝具など）
        if (fg || (zone && (noRank || seen.has(key + ':' + x.name))) || (noRank && seen.has(key + ':' + x.name))) { note(isNp ? 'nps' : 'skills', x.name, 'fgo'); continue; }
        // 詠唱・セリフの行が宝具として読まれたもの：名前が文のよう・説明が無い・説明がかぎかっこの一言だけ
        const quoteOnly = /^\s*(?:「[^」]*」|『[^』]*』)[！!]?\s*$/.test(x.desc || '');
        if (isNp && noRank && (/[。！？!?、]/.test(x.name) || String(x.name).length > 24 || blank(x.desc) || quoteOnly)) {
          const text = [x.name, x.desc].filter(t => !blank(t)).join('\n');
          if (out.length) { const prev = out[out.length - 1]; prev.desc = [prev.desc, text].filter(t => !blank(t)).join('\n'); }
          else carry = [carry, text].filter(Boolean).join('\n');   // 最初の宝具の前にある行は、次の宝具の説明の頭に
          note('nps', x.name, 'merged'); continue;
        }
        if (carry && isNp) { x.desc = [carry, x.desc].filter(t => !blank(t)).join('\n'); carry = ''; }
        seen.add(key + ':' + x.name); out.push(x);
      }
      sv[key] = out;
    }
    if (skipped.length) sv.skippedItems = skipped;
  }
  function finalize(sv) {
    cleanItems(sv);
    for (const np of sv.nps || []) {
      if (np.reading) continue;
      const m = String(np.name || '').match(/^(.+?)\s*[(（]([^()（）]+)[)）]\s*$/);
      if (m && READING_RE.test(m[2]) && /[\u30A0-\u30FFA-Za-z]/.test(m[2])) { np.name = m[1].trim(); np.reading = m[2].trim(); }
    }
    sv.statsAlt = (sv.statsAlt || []).filter(a => !a.fromText); // 説明文から拾った分は毎回読み直す
    const have = new Set(sv.statsAlt.map(a => a.label));
    const scan = (label, text) => {
      if (!text || have.has(label)) return;
      for (const line of String(text).split(/\n/)) {
        const r = parseStatLine(line, 5);
        if (r) { sv.statsAlt.push({ label, stats: r.stats, fromText: true }); have.add(label); return; }
      }
    };
    for (const np of sv.nps || []) scan(`宝具『${np.name}』の説明より`, np.desc);
    for (const sk of (sv.classSkills || []).concat(sv.skills || [])) scan(`スキル「${sk.name}」の説明より`, sk.desc);
    if (sv.text) for (const k of Object.keys(sv.text)) scan(({ commentary: '解説', personality: '人物', comment: 'コメント', other: 'その他' }[k] || k) + 'の記述より', sv.text[k]);
    return sv;
  }

  G.parser = { stripMarkup, nameAndReading, parsePage, parseServant, parseClass, parseStatLine, splitNameRank, npTypeKey, parseNum, parseRange, collectPairs, collectVoice, itemsToSkills, finalize, PROFILE_KEYS };
})(globalThis.HGW = globalThis.HGW || {});
