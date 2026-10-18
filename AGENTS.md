# AGENTS.md — Holy Grail War Simulator (1in7HGW)

Specification for AI coding agents. It explains what the project is, how the code is organised, how the
simulation works, and the rules to follow when changing it. Human-facing docs are in Japanese (`README.md`,
`img/scenes/README.md`); this file is the English reference for agents.

> Keep this file in sync when you change architecture, data formats, engine rules, decision keys or the
> URL format. Numbers quoted here come from `js/config.js`; if they disagree, the code wins.

---

## 1. What this is

A browser game: a **Fate-style "Holy Grail War" simulation** (fan fiction). Seven Servants (heroic spirits)
and their Masters fight in one city for up to **30 in-game days**; the last Servant standing wins.

- Inspired by the Japanese life-sim **"1in8b.life" (80億分の1)**: mostly automatic, the player watches a
  chronicle unfold, changes a light-weight **focus** at any time and only makes **big decisions** every
  ~5 days or at events.
- The player is **one Master** (or a neutral observer). Servants come from the owner's wiki
  **kagemiya@ふたば** (https://seesaawiki.jp/kagemiya/, a Seesaa wiki the repo owner administers).
  Wiki pages are parsed into data; contributors send additions, the owner merges and pushes them.
- Hosted as a **static site on GitHub Pages**: https://github.com/Pippiniden/1in7HGW
- All UI text, log text, comments and the human README are **Japanese**. Keep new user-facing strings in
  Japanese and match the existing tone (literary, Fate-like narration). Code comments are Japanese too;
  English comments are acceptable but stay consistent within a file.

### Glossary (Japanese term → meaning in code)

| JP | Code name | Meaning |
|---|---|---|
| サーヴァント | `sv` (servant) | Heroic spirit; has class, stats, skills, Noble Phantasms |
| マスター | `master` / `m` | Human contractor; stats `mana/craft/body/mind/luck` |
| 陣営 | camp `c` | One Master+Servant pair; the unit the engine simulates |
| 真名 | `trueName` | Servant's true identity; hidden from other camps until learned |
| クラス | `class.key` | saber, archer, … (see `CLASS_DEFS`) |
| 宝具 | NP (`nps`) | Noble Phantasm (ultimate attack/ability) |
| 令呪 | `cs` | Command Seals (3 by default); emergency orders |
| 霊基 | `hp` | Servant HP (0–100) |
| 魔力 | `mana` | Master's mana pool; pays upkeep and NP cost |
| 絆 | `bond` | Master–Servant bond (0–100) |
| 工房 | `workshop` | Base fortification level (0–5) |
| 拠点 | `base` | Camp's home location |
| 方針 | focus | Player's daily stance, changeable anytime (was 重点 before; UI term is now 方針) |
| 戦略 | policy | Camp's long-term strategy (AI and player's "auto"); labels 攻めの戦略 etc. (was 方針) |
| 作戦会議 | council | Big decision every `councilEvery` days |
| 性格 | persona | Master personality that biases behaviour |
| 手がかり | clues | Evidence toward deducing an enemy's true name |
| 教会 | church | Neutral ground; defeated Masters seek protection |
| はぐれ | stray | Servant whose Master died (survives `soloLeft` days) |
| 単独行動 | `solo` effect | Lets a stray persist longer |
| 討伐令 | bounty | Overseer's kill order; reward = +1 command seal |
| 因縁 | relations | Wiki-listed connections between servants |
| 日常 | life event | Slice-of-life events for the player's camp |
| 情景 | scene | Background image category |

---

## 2. Hard constraints

1. **No build step, no bundler, no npm dependencies at runtime.** Plain HTML/CSS/JS served as static files.
2. **Classic scripts, not ES modules.** Every `js/*.js` file is an IIFE that attaches to the global
   namespace `HGW`:
   ```js
   (function (G) { 'use strict'; /* ... */ G.something = ...; })(globalThis.HGW = globalThis.HGW || {});
   ```
   This lets the game run from `file://` and lets Node tests `require()` the same files.
3. **Script load order matters** (each file reads what earlier files put on `HGW`):
   `config → rank → parser → effects → fgoskills → build → master → war → names → scenes → personas → engine → data → survival`.
   `index.html` and `ranking.html` load all of them; `roster.html` loads `config…war` + `voiceedit`; `submit.html` loads `config…war` + `voiceedit` + `data`. Node tests use the same order.
   When you add a file, add it to **index.html, roster.html (if needed), test/sim.js, test/interactive.js and the
   `PRECACHE` list in `sw.js`** (then bump `VERSION` there).
4. **Determinism.** A war is fully determined by *(data, seed, focus per day, decision answers)*. All
   randomness inside `warGen` must go through its seeded `rnd()` (`chance`, `pick`, `wpick`, `shuffle`).
   Never call `Math.random()` inside the engine. Adding/removing/reordering `rnd()` calls changes every
   seed's outcome (acceptable, but old shared links will replay differently). Never iterate over
   `Set`/object keys in an order that depends on anything other than insertion.
5. **`.nojekyll`** must stay at the repo root (stops GitHub's Jekyll processing).
6. External resources: only Google Fonts. No CDN scripts.
7. Mobile support is required (breakpoint **820px**; must not overflow horizontally at 390px width).
8. **PWA.** `manifest.webmanifest` + `sw.js` (service worker, registered from `index.html` and `roster.html` only on
   http(s)). Same-origin GETs are **network-first** (fresh when online, cache when offline or after `NET_TIMEOUT` 6 s;
   navigations are cached without the query string and fall back to `index.html`); Google Fonts are stale-while-
   revalidate in `hgw-fonts`. Install precaches `PRECACHE` (failures are skipped). Bump `VERSION` when `PRECACHE` or the
   worker's logic changes; ordinary content updates need no bump. Placeholder icons live in `icons/` (`icons/README.md`).

---

## 3. Repository map

```
index.html          Game (single page; inline CSS + inline UI script)
manifest.webmanifest  PWA manifest (name, colours, icons, start_url ./index.html, scope ./)
sw.js               Service worker (offline; see §2.8)
icons/              App icons (hooded figure; PNGs 192/512/maskable-512 (inside the frame)/apple-touch 180/favicon 32 (face crop), 256-colour quantised; README.md)
roster.html         Admin tool: import wiki pages, review/fix effects, export data; applies player requests
submit.html         Player request form (new servant / adjustment) → GitHub Issue URL, .json file or copied text (no server)
ranking.html        Strength ranking of all servants (spoilers: linked only at the very bottom of the game's intro)
img/classes/        Class icons, 128×128 WebP: saber archer lancer rider caster assassin berserker + extra (any extra class)
img/faces/          (optional) face portraits `<displayed true name>.webp|png|jpg` (README.md); most servants have none
.nojekyll
README.md           Japanese user/maintainer guide
AGENTS.md           This file
data/
  manifest.json     Which data files to load
  servants.json     Servant pack (hgw-servants, lean). LARGE (~40k lines) — do not read whole; inspect with node
  overrides.json    Hand-fix tables (hgw-overrides)
  survival.json     Survival-curve tally (hgw-survival, see 7.11); regenerate with tools/survival.js after data changes
img/scenes/
  README.md         Background image spec: sizes, filenames, AI image prompts (Japanese)
  *.webp            (optional) {scene}-day.webp / {scene}-night.webp
js/
  config.js         CLASS_DEFS, ENGINE tuning, WAR composition, rank tables, NP types, BATTLE_K, VOICE_SLOTS, GRADES
  rank.js           Rank string ("A+", "C~A", "B(狂化時A)", "-", "EX") → numeric object
  parser.js         Wiki markup → structured servant (parsePage, parseServant, finalize, parseClass)
  effects.js        Effect primitives (+ EFFECT_INFO/describe: who/when/what), skill dictionary, keyword rules, override tables, resolveSkill/resolveNP
  fgoskills.js      GENERATED by tools/chaldea.js: G.FGO_SKILLS = { FGO skill name: [[effectId, factor], …] } (~1100 names; do not hand-edit)
  build.js          Parsed servant → game servant (scores, effects, power); toLean/fromJSON; battleOdds
  master.js         Master structure, origins, createMaster, parseMasterText
  war.js            composeWar: pick 7 (+extra) servants for one war
  names.js          Name pools, cities, places (terrain + scene), church name, wishes. Names/cities are picked with a
                    fixed number of rnd() calls, so adding entries changes only text; adding places changes outcomes (shuffle + terrain)
  scenes.js         Scene categories + fallback chain for background images
  personas.js       Master personalities and their behavioural biases
  engine.js         The simulation (generator), ~870 lines
  data.js           Loading published data / browser-local roster / user-picked files
  survival.js       Survival curves: many auto wars → per-servant elimination days; roster fingerprint
  voiceedit.js      Per-scene voice editor (DOM, HGW.voiceEdit: mount/read/toText/parseText); used by roster.html and submit.html only
tools/
  chaldea.js        node tools/chaldea.js <chaldea-data checkout>: FGO servants' skills (dist/servants.*.json, baseSkills, baseFunctions) →
                    js/fgoskills.js. FGO buff/function types are mapped to effect primitives (upAtk→power, upDefence/subSelfdamage→guard,
                    invincible/avoidance→evade, guts→guts, crit/star→crit, NP gain/charge→np_boost, upTolerance→mental_guard,
                    pierce*→pierce, HP regain→regen (ally: heal_other), enemy down*→debuff, donotAct→charm, instantDeath→instakill;
                    ally-targeted buffs also add rally 0.3); factors summed per skill, capped 1.2. Names already resolved by SKILL_DICT are skipped
  kagemiya.js       Fetch kagemiya pages by name (EUC-JP URL) → HTML→wiki markup → parse → data/servants.json (Node CLI)
  survival.js       Build data/survival.json (loads data exactly like the game via data.js with an fs-backed fetch); --check
  datalib.js        Shared loader for tools: loadDir(dataDir) (clears E.OVERRIDE_TABLES, applies the manifest's overrides, harvest,
                    fromJSON), grades(roster) (same as the opening), sortLean(list) (class order → true name)
  incoming.js       Apply files in data/incoming/ by content (see §4.4 Uploads); deletes applied files; GITHUB_OUTPUT incoming/applied/kept
  datadiff.js       Markdown diff of two data dirs: servants added/removed/changed (sections, power, NP peak, grade), grade-only
                    moves, override tables (added/changed/removed keys); GITHUB_OUTPUT diff_*
.github/workflows/
  kagemiya.yml      workflow_dispatch "kagemiya から取り込み": runs tools/kagemiya.js, checks sim.js, rebuilds survival.json, opens a PR
  data.yml          "データの反映": on push to main touching data/incoming/**, servants.json, overrides.json, manifest.json, packs/**
                    (or by hand) — applies uploads, checks, rebuilds survival.json, reports the diff (§4.4 Uploads). Needs the repo setting
                    「Allow GitHub Actions to create and approve pull requests」; without it the run now fails (data left on data/upload-N)
data/incoming/      Upload drop folder (README.md explains it; other files are consumed by data.yml)
test/
  sim.js            N automatic wars → balance stats; or print one war's log
  interactive.js    Random focus/answers through the generator; checks replay determinism
  run.js            Parse wiki .txt files and print what was read
  rebuild.js        Rebuild exported JSON folder; print effects per servant
  skills.js         Skill dictionary: canonical names resolve via dict, generic names merge with text, references
  content.js        Content overrides (edit/remove/add skills, NPs, voice…) incl. toLean/harvest/reset
  kagemiya.js       tools/kagemiya.js: EUC-JP URLs and HTML→wiki conversion against kagemiya-lucan.html
  survival.js       Survival tally sanity + playerName never changes the outcome
  voice.js          Voice slots: every key the code uses is in VOICE_SLOTS; editing lines never changes the outcome
  fgo.js            FGO-style blocks / chant lines are not read as skills or NPs; old data is cleaned at load
  effects.js        Every EFFECTS id is read by engine/build and described; NP effect timing; identity override
  focus.js          Win rate per constant focus by servant grade vs REC_FOCUS (reads the table from index.html)
  lucan.txt, variant1.txt, master1.txt   Sample wiki pages
  kagemiya-lucan.html                    Rendered kagemiya page (content area only) for the converter test
```

Current data: 119 servants (saber 24, rider 15, caster 14, archer 13, berserker 13, lancer 12, assassin 11,
shielder 3, avenger 2, saver 1, ruler 1, extra 10); 71 of them have voice lines.

---

## 4. Data pipeline

```
wiki page text ──parsePage──▶ {info, sections, items}
               ──parseServant──▶ parsed servant (raw strings + rank objects)
               ──finalize──▶ (split "名前(読み)", rescan alt stat blocks in descriptions)
               ──buildServant──▶ game servant (scores, effects, tags, power, npPeak, review)
               ──toLean──▶ published JSON (derived fields stripped)
published JSON ──fromJSON──▶ (re-parse class, finalize, buildServant)  ← done at every page load
```

Because the game **always rebuilds from lean data at load time**, improving the parser rules, the skill
dictionary or `CLASS_DEFS` automatically applies to all previously imported servants.

### 4.1 Wiki page format (kagemiya)

Seesaa wiki markup. Typical page:

```
*基本情報
【元ネタ】アーサー王伝説
【CLASS】セイバー
【真名】…
【性別】女
【属性】秩序・善
【天地人属性】地
【その他属性】人型
【ステータス】筋力：D　耐久：C　敏捷：D　魔力：C　幸運：A　宝具：D
*【クラス別スキル】
**対魔力：A
description…
*【保有スキル】
**戦闘続行：C
description…
*【宝具】
**『宝具名』
ランク：A　種別：対城宝具　レンジ：1～99　最大捕捉：1000人
description…
*【解説】 / 【人物・性格】 / 【因縁キャラ】 / 【セリフ】(voice lines under headings like 召喚, 開始, 宝具, 会話, 絆, 聖杯について…)
```

**Fetching by name** (`tools/kagemiya.js`, run from the GitHub Actions workflow because Seesaa sends no CORS
headers, so browsers cannot fetch it): page URL is `https://seesaawiki.jp/kagemiya/d/<page name in EUC-JP
percent-encoding>` (UTF-8 encoding gives 404; a missing page is 404; `/dp/` print pages return 503). The body
is `<div class="user-area">` up to `<!-- google_ad_section_end(name=s1)`. `htmlToWiki` maps `<h3>/<h4>/<h5>`
→ `*`/`**`/`***`, `<br>` → newline, `<ruby><rb>X</rb><rt>Y</rt>` → `&ruby(Y){X}`, `<del>` → `%%…%%`,
`<b>` → `''…''`, toggle regions → `[+]title … [END]`, tables → `|a|b|`; the result parses identically to the
pasted wiki source (verified on 3 pages). Imported servants get `page` (wiki page title) so `refresh` can
re-fetch them; old data without `page` is tried as `trueName`, then `trueName(classLabel)`. Requests are
serial with a 1.5 s gap.

Pages deviate from the template often; the parser is deliberately tolerant (regex section/key matching,
`SECTIONS`, `INFO_KEYS`, `PROFILE_KEYS` in `parser.js`). Struck-through text (`%%…%%`) is dropped by default.

**FGO-style blocks** (many pages add `*【FGO風性能】` with レア度, 霊基再臨, 基本ステータス, 所有カード, 所有スキル (`***Skill1：…`),
クラススキル, アペンドスキル, 宝具, 攻撃モーション, 性能解説 …) are not game data. `parsePage` opens a section `'fgo'` at a level-1
heading matching `FGO_HEAD`, or at a deeper heading that is an FGO item name (`FGO_ITEM` inside skills/classSkills/np/other sections;
the stronger `FGO_STRONG` — FGO, アペンドスキル, 所有スキル/カード, 基本ステータス, 攻撃モーション, 絆礼装, レア度, ☆N, SkillN — in any
section but info); headings deeper than that level stay inside it as items (so its 「クラススキル」「宝具」 no longer switch sections),
and it ends at the next heading of the same or a shallower level. `'fgo'` sections give no skills/NPs/stats/info/text/voice and are
recorded in `sv.skippedItems` as `{ list: 'section', name, why: 'fgo' }`. In the 宝具 section a bare line becomes an NP item only if it
starts with 『 or is a short 「…」 without 。、！？ (longer 「…」 lines are chants and stay in the description).
**`finalize` → `cleanItems`** repairs data that was already imported (lean JSON has no source text, so this runs at every load):
in classSkills/skills/nps, an FGO item (name matches `FGO_ITEM`, or no rank and a description that is an FGO table / FGO wording —
`FGO_TABLE`, `FGO_TEXT`, `||…`) starts a zone in which items with no rank (NPs: no rank and no type) or a name seen earlier are dropped;
a rankless repeat of an earlier name is dropped anywhere; an NP with no rank and no type whose name looks like a sentence (。！？、, > 24
chars), that has no description, or whose description is only one 「…」/『…』 quote is merged into the previous NP's description (the
next one's when it comes first; `why: 'merged'`). An NP whose rank field also holds 「種別」 (`B++ 種別 対軍宝具`) is split into rank and type. Removed items are listed in
`sv.skippedItems` (`{ list: 'skills'|'nps', name, why: 'fgo'|'merged' }`), which is kept in lean data and shown in the roster detail
(「読み取りで外した項目」), in submit.html's judgement and in the import workflow's PR body. On the current data this removes 85 items
from 16 servants (their power / NP peak drop accordingly; e.g. タリエシン's and フリッツ・デュケイン's only "attack NPs" were chant lines /
FGO entries). `test/fgo.js` covers both paths.
`roster.html` accepts several pages pasted together separated by a line of `=====`.

### 4.2 Rank object (`rank.js`)

`parseRank(raw)` → `{ raw, base, plus, minus, step, score, mult, burst, range, alt, unknown, none }`

- `step`: E=1 … EX=6; each `+` adds `PLUS_STEP` (0.15), each `-` subtracts `MINUS_STEP` (0.25).
- `score`: stat scale, interpolated from `RANK_SCORE` (E10 D20 C32 B46 A62 EX80).
- `mult`: effect multiplier from `RANK_MULT` (E0.4 D0.6 C0.8 B1.0 A1.2 EX1.5).
- `burst`: momentary multiplier for `+` marks (`PLUS_BURST` [1,2,3,4]).
- `range`: for "C~A", "B/A", "C→A" → `[lo, hi]`; score is the mean; **rolled once per war** (`rollRange`).
- `alt`: parenthesised alternates, e.g. "B(狂化時A)".
- `none`: "-", "なし" (score 0). `unknown`: unreadable or "A?".
- Unreadable stats become `MISSING_STAT` ("C") and are listed in `review`.

### 4.3 Servant object

Parsed fields (kept in lean JSON): `kind:'servant', id ('<classKey>:<trueName>'), trueName, aliases,
class {key,label,raw,standard,sub}, origin, sex, alignment, attribute, traits, stats {str,end,agi,mag,luk,np:
{raw, rank}}, statsAlt [{label, stats, fromText?}], classSkills/skills [{name, rankRaw, rank, desc}],
nps [{name, reading, rankRaw, rank, typeRaw, typeKey, range, maxTargets, desc, …}], weapons, profile
{likes, dislikes, wish, imageColor, specialty, firstPerson…}, relations [{name,text}], voice {heading:[lines]},
text {commentary, personality, comment, voice, other}, info (all 【key】 pairs), warnings, body, page?`
(`page` = kagemiya page title, set by `tools/kagemiya.js`), `pageMissing? { at: 'YYYY-MM-DD', tried: [names] }` (set by a
refresh that got 404; a successful refresh replaces the entry and drops it), `skippedItems?` (see 4.1). The page to fetch is
`B.pageOf(sv)` = `PAGE_OVERRIDES[trueName]` (overrides.json `pages`, edited in the roster's 「Wikiのページ名」) → `sv.page` → null
(then the true name is tried). The browser roster may also hold `_wiki` (see 4.5).

Derived fields (added by `buildServant`, stripped by `toLean`): `contentEdited, ranks, score, statSource, tags, allSkills
(with .effects/.effectSource/.matched/.group), nps[].{attackResolved, power, burst, cost, exposure, multi,
disabled, effects}, effectSummary, power, npPeak, review, built`.

Identity: two entries with the same `class.key + trueName` are the same servant; later files win.

### 4.4 Data files

`data/manifest.json`
```json
{ "servants": ["servants.json", "packs/xxx.json"], "overrides": ["overrides.json"], "masters": [] }
```
- `servants`: all listed packs are loaded; duplicates by id → last wins.
- `overrides`: merged in order into the override tables (later wins).
- `masters`: JSON arrays of fixed-Master specs (see §7.4). Each camp has a 50% chance to draw from this pool.

`hgw-servants` pack: `{ format:'hgw-servants', version:2, lean:true, at:<ISO>, servants:[…] }`.

`hgw-overrides`: `{ format:'hgw-overrides', version:2, global:{}, servant:{}, stats:{}, np:{}, content:{}, pages:{} }` —
`E.OVERRIDE_TABLES` maps these names to the tables; data.js, tools/kagemiya.js and roster.html all use it (add new tables there).
- `global` → `SKILL_OVERRIDES`: `'skillName': [[effectId, factor, params?], …]` (all servants)
- `servant` → `SERVANT_OVERRIDES`: `'trueName/skillOrNpName': [[…]]` (one servant; `[]` = no effects)
- `stats` → `STAT_OVERRIDES`: `'trueName': { str:'B', … }` (only listed stats replaced)
- `np` → `NP_OVERRIDES`: `'trueName/npName': { attack: true|false }`
- `content` → `CONTENT_OVERRIDES`: `'trueName': { skills?, nps?, voice?, text?, profile?, relations?, base }` (see 4.5)
- `pages` → `PAGE_OVERRIDES`: `'trueName': 'kagemiya page name'` (when the page title differs from the true name, e.g. ハイヌヴェレ → ウンコ)

**Uploads (`data/incoming/`, workflow `data.yml`, `tools/incoming.js`).** The owner drops files there with any name (browser
downloads become `servants (3).json`); the roster's 公開・保存 tab links to `github.com/…/upload/main/data/incoming`. Files are
classified by content and applied in this order: `hgw-overrides` (or a bare table object) → replaces overrides.json (first, so
overrides harvested from a list uploaded at the same time survive), then lists (largest first, so a full replacement cannot wipe a
one-servant page uploaded with it), then `.txt` pages; `hgw-servants` / array / single servant → if it holds ≥ 80 % of the current ids it
**replaces** the list (servants missing from it are named in the report), else upsert by id; lean packs are taken verbatim (small
diffs), full exports go through `harvestOverrides` + `toLean(fromJSON())`; `.txt` wiki pages → `importServant` upsert (keeping the existing `page`);
requests / records / survival files are left in place and reported. The list is re-sorted (`sortLean`). The workflow snapshots
`data/` first, runs incoming.js, `test/sim.js 40` + `test/fgo.js`, rebuilds survival.json when `--check` fails, writes the
`datadiff.js` report to the job summary and, if files were applied, opens a PR (`data/upload-N`) with that body; otherwise (data
replaced directly on main) it commits only the rebuilt survival.json to main. Bot pushes use GITHUB_TOKEN, so they do not retrigger
workflows; merging the PR retriggers it once, which then finds nothing to do.

Overrides embedded in exported servant JSON (`effectSource: 'override'|'servant-override'`) are harvested
back into the tables on load (`harvestOverrides`), without overwriting existing entries.

### 4.5 Content overrides (`build.js` `applyContent`)

Hand edits of the *content* read from the wiki (the roster tool's 「内容を編集」 dialog). Each present section
replaces the wiki value wholesale: `skills: [{group:'class'|'own', name, rankRaw, desc}]` (both classSkills
and skills), `nps: [{name, reading, rankRaw, typeRaw, rangeRaw, maxRaw, desc}]`, `voice {heading:[lines]}`,
`text {…}`, `profile {…}`, `relations [{name,text}]`, `identity { trueName?, cls? }` (rename / reclassify; applied first, then
`sv.id` is recomputed; `_wiki` stashes the wiki `trueName`/`class`/`id`). `CONTENT_OVERRIDES` is keyed by the **wiki** true name
(`B.wikiName(sv)`); every other table (servant/np/stats/pages) by the displayed true name (the roster's rename moves those keys).
`B.wikiId(sv)` is the wiki id — roster.html's published-sync uses it, so a rename is only an override change. `pageOf` falls back to the
wiki true name. `base[section]` = `hashOf(contentOf(wikiValue, section))`
at edit time; if the wiki value later differs, `buildServant` adds a `review` item of kind `content`.
Sections equal to the wiki are not stored. Ranks/types are re-parsed from the raw strings (`mkSkill`, `mkNP`).

`buildServant` first restores `sv._wiki` (the wiki values stashed when an override was applied), then applies
`CONTENT_OVERRIDES[trueName]`, stashes the replaced wiki values in `sv._wiki`, re-runs `finalize`, and sets
`contentEdited` (list of sections). So the browser roster can always revert. `toLean` restores `_wiki`, i.e.
**published servants.json always holds wiki values; edits live only in overrides.json**. `fromJSON` restores
`_wiki` before `finalize`. `harvestOverrides` turns a full export that still has `_wiki` back into a
`CONTENT_OVERRIDES` entry (if none exists). Effect overrides stay keyed by skill name, so renaming a skill
detaches its effect override. `buildServant` also flags duplicate skill/NP names in `review`.

**The owner sometimes uploads `data/servants.json` directly to `main` via the GitHub web UI.** Always
branch from the latest `origin/main` and never overwrite data files you were not asked to change.

---

## 5. Effects system (`effects.js`)

The engine understands only a fixed set of **effect primitives**. Every skill and NP is mapped onto them.

### 5.1 Primitives (`EFFECTS`)

| Phase | IDs |
|---|---|
| battle | `power` (+combat power rate), `power_vs` (vs `params.tag`), `debuff`, `crit`, `pierce` (ignore defence/guts), `instakill`, `evade`, `initiative`, `charm`, `rally`, `anti_master`, `mental_guard` |
| damage | `guard`, `magic_guard`, `weakness` (vs tag), `master_guard` |
| lethal | `guts` |
| encounter | `stealth`, `detect`, `reveal` (learn names), `conceal` (hide name) |
| scout | `intel` |
| retreat | `escape`, `pin` |
| day | `regen`, `heal_other`, `territory`, `craft`, `resource`, `uncontrolled` |
| upkeep | `upkeep_down`, `upkeep_up`, `solo` (days a stray survives) |
| talk | `negotiate` |
| master | `cs_resist`, `master_buff` (`params.stat` → adds to a master stat) |
| passive | `luck`, `tag` (adds a trait tag) |
| np | `np_boost`, `np_cost`, `backfire`, `self_retire`, `disabled` |

Each has `base`, `unit` (rate/chance/days/pt/flag) and optional `fixed`/`byRank`. `params.cond`
(`'水辺'|'森'|'山'|'夜'`) makes an effect apply only on matching terrain.

**Effect spec** (used everywhere): `[effectId, factor = 1, params?]`.
**Meaning** (`E.EFFECT_INFO[id] = { who, bad?, fx(mag, params) }`, `E.describe(effect, { np, attack })` → `{ name, who, whoJa, bad,
when, text }`): who = self / enemy / ally / master / enemyMaster / none; `fx` states what the engine actually does with the magnitude
(keep it in sync with engine.js). Shown in roster.html (skill/NP tables, effect editor rows, legend) and submit.html.
**Magnitude**: `mag = base × factor × rank.mult` (`fixed` → no rank mult; `byRank` → table lookup;
unknown rank → ×0.8).

### 5.2 Skill resolution order (`resolveSkill`)

1. `SERVANT_OVERRIDES['trueName/skill']` → source `servant-override`
2. `SKILL_OVERRIDES['skill']` → `override`
3. rank "-" and description says the skill is lost or merged (`LOST_WORDS`, incl. 統合され) → `lost` (no effects)
4. `SKILL_DICT` exact or base-name match (~300 entries: the original 77 plus canonical TYPE-MOON class/personal
   skills such as 復讐者, 忘却補正, 真名看破, 神明裁決, 反骨の相, 理性蒸発, 矢除けの加護, 信仰の加護, 狂気, 妖精眼…;
   coverage was checked against the skills of all 470 FGO servants — every skill held by ≥2 of them that is not
   character-specific is in the dictionary; ~45 more generic names from the TYPE-MOON Wiki skill list (typemoon.wiki.cre.jp
   「スキル一覧」: 神速, クイックドロウ, 戦闘加速, 蛮勇, 獅子心, 至誠, 護国の鬼将, 仁王立ち, 竜の心臓/竜の炉心, 受肉精霊, 医神 …) were added
   later, ~300 entries in all) → `dict`.
   Explicit references in the description (「直感と同等」) are added on top (×0.6); 「〜との混合」 references are not
   (the dict entry already models the mix). Variants matched by base name (「黄金律(体)」「最果ての加護(羅馬)」) also
   add keyword effects read from the description (dict effects are kept; the larger factor wins).
   Shared suffixes (〇〇の神核, 〇〇の叡智/智慧, 〇〇の武練, 〇〇審美, 〇〇の託宣, 〇〇の加護/寵愛…) are `GENERIC`
   entries used as a partial-match base.
5. Text analysis: partial dict match (`dict-partial`) + references to other known skills inside the
   description (`compoundSpecs`, ×0.6: 同等/同様/相当/亜種/類似/として機能, 与える/備える, 〜の複合/混合/効果を複合)
   + per-sentence keyword `RULES` → `compound`/`keyword`. When a keyword effect duplicates a dict/reference
   effect, the larger factor wins. Names that are ordinary words (`GENERIC`: 従者, 加護, 寵愛, 特権, 指揮, 混血…)
   take this path even on an exact match, so the description still counts (source `dict-partial`).
6. Nothing found → if `G.FGO_SKILLS` (js/fgoskills.js, from Chaldea's FGO data) has the name (or its base name without
   parentheses) → those effects, source `fgo` (review: 「FGO の同名スキル…から推定」); else `[['power', 0.3]]`, source `default`

Anything not from an override or exact dict hit is added to the servant's `review` list (shown in
`roster.html` as 要確認, "needs review").

### 5.3 NP resolution (`resolveNP`)

- Type from 種別 text → `NP_TYPE` key (`anti_unit, anti_army, anti_fort, anti_nation, anti_world, barrier,
  self, special`) with `power`, `cost`, `exposure` multipliers.
- Attack or support: `NP_OVERRIDES` → disabled → self-type → non-attack wording → attack wording
  (`ATTACK_WORDS`) → barrier → support effects → otherwise guessed attack.
- On attack NPs, `power` effects from text are dropped (the NP's power is the attack), but hand-set ones (`servant-override`/`override`)
  are kept and apply while the NP's battle lasts.
- `power = rank.score × type.power` (attack NPs only); `cost = type.cost × rank.mult × (1 + np_cost)`;
  `exposure` = how likely use reveals the true name (≥1 makes it public; ≥0.8 can trigger a "witnessed" event).
- `self_retire` (servant drops out after use), `backfire`, `disabled` are detected from text.

### 5.4 Summary and power (`build.js`)

- `effectSummary`: effects summed per `id[:tag|stat][@cond]` → `{passive, onNP, from[]}`. NP effects
  count as `onNP` (applied only when the NP is used), except `master_buff`/persistent ones.
- `combatPower = weightedMean(str,end,agi,mag,luk scores; STAT_W × classWeights) × (1 + Σpower)`.
- `npPeak` = strongest usable attack NP power × (1 + np_boost).
- `battleOdds(a,b,opts)` = quick logistic estimate used by the roster tool (not by the engine).

---

## 6. Classes and war composition

`CLASS_DEFS` in `config.js` is the single registry. Each entry: `label`, `aliases` (substring matches
against the wiki 【CLASS】 field; longest hit at the earliest position wins), `slot` (`'standard'` = one
of the seven seats, `'extra'`), optional stat `weights` and `tags`. Unmatched classes become `extra` with
the wiki's own label.

`composeWar` (`war.js`, `CONFIG.WAR`): fills the 7 standard slots; with `extraChance` (0.3) one random
slot is taken by an extra-class servant (max `maxExtra` 1). If a class has no candidates, `fillWith`
decides (`'any'` default / `'extra'` / `'none'`). Duplicate class labels get suffixes （一）（二）.

**To add a class:** add one entry to `CLASS_DEFS`. Nothing else is required; old data is reclassified on load.

---

## 7. Engine (`engine.js`)

### 7.1 API

```js
// Interactive (the game):
const out = {};
const gen = HGW.engine.warGen({ roster, seed, ask: 'big', masters, out /*, player, engine, city */ });
let r = gen.next();
while (!r.done) {
  if (r.value.type === 'tick')     r = gen.next(focusKey);       // once per day; 'auto','attack',…
  else /* 'decision' */            r = gen.next(optionKey|'auto');
}
const result = r.value;               // also merged into `out`

// Fully automatic:
const result = HGW.engine.runWar({ roster, seed, focus: day => 'auto' });
```

Options: `roster` (built servants, ≥2), `seed` (string; random if omitted), `war` (overrides for `CONFIG.WAR`;
`{ extra: false }` removes extra-class servants entirely, also as substitutes; `{ pick: 'open' }` draws 7 distinct servants
uniformly from the whole roster ignoring classes — duplicates get （一）（二）, `slot` = the servant's own class, no
substitute/intrusion narration, and the prologue says the class rule is suspended), `ask` (`'never'` = never
yield decisions; anything else = yield for the player camp), `player` (camp index, `'none'` for observer,
default random), `masters` (fixed master specs), `engine` (overrides for `CONFIG.ENGINE`), `city`, `out`
(object filled live with `entries`, `meta`, `city`, `seed`, `camps`, then the result), `playerName` (renames the player
camp's Master after the camp is chosen; control chars stripped, ≤ 20 chars; no `rnd()` call, so the war is identical apart
from the name — `master.named = true`).

Yields:
- `{ type:'tick', day }` — start of each day. Answer with a `FOCUS` key. Non-blocking for the UI.
- `{ type:'decision', kind, day, phase, title, body, note, options:[{k,label,sub}], camp }` — answer with
  an option `k`; any unknown answer (e.g. `'auto'`) → the auto policy decides and the log says "おまかせ".

`ask()` only yields when the camp is the player's, `ask !== 'never'`, and the camp is not `retired`.
Every other camp makes the same decision through the `auto` callback. **All decisions should go through
`ask()`** so the player can be offered them and replays stay deterministic.

Exports: `HGW.engine = { runWar, warGen, makeRng, POLICIES, FOCUS }`.

### 7.2 Camp state (key fields)

`id, label, slot, sv (deep-copied servant; range ranks rolled), master, hp (0–100), mhp/mhpMax (master HP),
mana/manaMax, cs, alive, masterAlive, fate {day,text}, soloLeft, inChurch, merged, retired, base (place),
workshop (0–5), ally (camp id|null), policy, focus (player), stance (per battle: all|careful|retreat),
bond, knowName/knowLoc/knowPersona (Sets of camp ids), clues {campId:n}, kills, battles, npUses, temp
(battle-scoped effects), npBoost, assault (target id for tonight), betray, boostUntil, restNight,
targetPref, bounty, warned, you, gameOver, fallenPending`.

Knowledge is per camp. `known(c)` = player knows c's true name (own camp, `you.knowName`, or public via
`pubName` — e.g. after death or exposure ≥1). Text helpers: `nm(c)` (label + true name if known),
`sn(c)` (short), `mn(c)` (master name).

### 7.3 Turn structure

```
prologue: compose war, create masters (+persona), assign policies, log summons
for day = 1..maxDays (30):
  yield tick → player focus
  dayPhase:
    alliances dissolve when alive ≤ allianceBreakAt (3); persona-based AI betrayal at ≤ 4
    world event (eventChance 0.25)
    council for the player every councilEvery (5) days
    for each alive camp (shuffled):
      stray handling (recontract chance / soloLeft countdown / vanish)
      uncontrolled wandering (berserk-like)
      day action: scout | fortify | rest | ally | hide   (weighted by effects × policy; player focus overrides)
      player's life event (lifeChance 0.4)
    upkeep: mana += manaRegen + master.mana×0.15 + workshop×2 + resource×10 − upkeep × upk(c) (× spiritSave 0.6 on rest/hide days);
            a shortfall goes through drain() (see 7.5 Mana)
  checkFallen
  nightPhase (skipped on festival nights):
    each camp decides to hunt (huntBase 0.56 + power diff + class + hp + finale + policy + persona + moon …)
    hunters pick a target (known location, relative power, low hp, relations, bounty), roll find chance
    if target stayed home → fight at its base (territory/workshop bonus); possible master ambush (anti_master, persona)
    battle → checkFallen
  quiet days are collapsed into one 'quiet' log entry
  stop when ≤ 1 servant alive
end: winner (1 alive) / mutual destruction (0) / draw (time out); result
```

The last `finaleDays` (3) days add aggression.

### 7.4 Masters, policies, personas, focus

- **Master** (`master.js`): `createMaster(spec, rnd)` — every field in `spec` is used as-is, missing ones
  are rolled from the **origin** (`ORIGINS`: noble, newblood, mercenary, civilian, irregular; or a custom
  label). Stats `mana, craft, body, mind, luck` accept rank strings or 0–100 numbers. Rolled age is 16–46 skewed
  slightly young (`16 + rnd()^1.25 × 30`, ~52% under 30). Optional `skills`
  use the same effect library. `custom` holds arbitrary extra settings. `parseMasterText` reads
  wiki-style master pages. Spec may include `persona: '<key>'`.
- **Policy** (`POLICIES`): aggressive, defensive, intel, diplomacy, balanced — weights day actions and
  hunt chance. Chosen per camp at start by `autoPolicy` (servant traits × persona `policy` weights).
- **Persona** (`personas.js`, `G.PERSONAS`): rational, proud, cautious, warmonger, kind, timid, assassin,
  ambitious. Fields are additive biases: `hunt, retreat, ally, np, ambush, betray, cs` (+0 = neutral),
  `bond` (multiplier on bond gains), `policy` (multipliers), `origins` (draw weights by origin),
  `reveal` (log line, `{m}` = master name). Read in the engine via `perv(c, key)`. Other camps' personas
  are hidden; after each battle there is a `personaReveal` (0.35) chance to learn the opponent's.
- **Focus** (`FOCUS`, player only, takes effect next morning): `auto(o) attack(a) defend(d) scout(s)
  rest(r) hide(h) ally(l)` — each fixes the day action, night hunting (`true/false/null`) and battle stance.
  `auto` follows the camp policy.

### 7.5 Battle (`battle`, up to `rounds` = 4)

Battle start: every participant (incl. helpers) pays `battleMana` (5) × `upk(c)`; a stored item (`c.items`, from `craft`,
max 3) is consumed for temp guard +0.2 / power +0.05; `initiative` (≤0.5) may give `surprise` +0.08 (only rolled when > 0).

Per round:
1. Retreat-stance camps may disengage immediately (round 1).
2. Each side may use an NP (`useNP`: chance from hp, round, berserker, losing, finale, stance, persona;
   needs `cost × npCost` mana). **Which** NP is a weighted pick (`wpick`) over all usable NPs: attack NPs by
   relative power (pressed — losing, hp < 40 or finale — strongly favours the strongest; a weakened opponent
   favours lighter ones; low remaining mana penalises expensive ones), support NPs with battle effects (once per
   battle), discounted by exposure while the true name is still hidden, by partial `self_retire` and by
   `backfire`; NPs with `self_retire` ≥ 0.5 only when hp < 25 (and even then rarely). Attack NP → `npBoost = power × npPowerK (× burst)`; support NP → its effects
   go to `temp`. Using an NP may reveal the true name (else +2 clues for the opponent).
3. `power(c, o, ctx)`: combatPower(terrain) × temp power × special-attack/weakness × defence
   (guard/evade/magic_guard, reduced by opponent `pierce`) × opponent debuff × home territory/workshop ×
   knows-name 1.08 × hp factor × no-master 0.9 × low-mana 0.85 × stance × command-seal boost × surprise
   + npBoost, then ×(0.9–1.1) noise. Charm can cut the other side by 40%.
4. Winner of the exchange: logistic `p = 1/(1+exp(-(ea-eb)/BATTLE_K))`, `BATTLE_K` = 15.
5. `instakill` chance, else damage `(dmgBase 28 + rnd×dmgVar 20) × advantage`, crit ×1.5, guard reduction.
6. HP ≤ 0 → `lethal()`: `guts` (+bond) may survive at 5–15 hp; else the Master may use a command seal
   (decision `cs`: escape / rally / none); `cs_resist` can make a seal fail; otherwise `servantDown`.
7. **Master strike**: rare chance the winning side hits the enemy Master directly:
   `(masterStrike 0.006 + anti_master×0.3 + persona ambush×0.03) × (1 − master_guard − home workshop×0.04)`,
   capped at 0.15. Lethal unless saved by a command seal (`csSaveMaster` 0.5).
8. Retreat check for the weaker side (threshold `retreatAt` 35 ± stance ± persona; success from
   `retreatBase` + escape − pin + bond …).

**Allies fight together.** `joinAlly(x, enemy, home)` (night phase, before `battle`): x's ally joins with
`clamp(allyJoin 0.3 + hunting 0.15 + defending its own base 0.2 + rally(x) + rally(ally) + persona ally×0.5 − wander 0.2, 0.05, 0.85)`
(not if it already fought, hp < 40, retired, or the player's focus says `night === false`; player focus attack +0.3). Passed as
`ctx.helpA/helpB`. The helper is logged (`kind 'ally'`, big), uses NPs, adds `(combatPower × hp factor + npBoost) × allyAssist 0.45 ×
(1 + rally of both)` to its side, and when its side loses an exchange it takes the hit with `allyCover` 0.35 (lethal → `lethal()` on the
helper; it leaves when dead/escaped or hp < 25). Kills/`fin` stay with the main pair.

**Mana.** `upk(c)` = `CLASS_DEFS[class].upkeep` (berserker 1.4, others 1) × max(0.3, 1 + upkeep_up − upkeep_down). `drain(c)`: when
mana < 0 the shortfall × `drainLife` (2) comes out of the Master's HP (servant hp −min(8, short×0.3)); if the Master would drop to 0
one command seal is spent for `sealMana` (30) mana, else `masterDown` (「…に魔力を吸い尽くされ…」). `wildOf(c)` = master alive and
(berserker or `uncontrolled` ≥ `wildAt` 0.1): no low-mana power penalty, and may fire one NP per battle without enough mana
(overdraw → drain). Berserkers also pay `wildMana` (3) × upk per round. AI rests more when the Master is drained (mhp < 50%, upk > 1.2)
and hunts less with mana < 20% (non-berserkers).

**Other effect reads** (all deterministic apart from the rolls noted): `np_boost` (passive + the NP's own) multiplies attack NP power
(also in `npPeak`); `luck` adds ×0.5 to guts, ×0.3 to retreat and cuts instakill received by (1 − luck); `resource` adds mana daily;
`weakness` reduces the *weak* side's own power vs a matching opponent; cond `夜` matches night battles except on a full moon.
NP effects: battle/damage/lethal/retreat/np-phase effects (and `uncontrolled`/`upkeep_up`) apply only while the NP's battle lasts
(`E.npOnUse`, `onNP` in the summary); everything else (territory, craft, stealth, intel, negotiate, regen…) is passive while held.
`test/effects.js` fails if an `EFFECTS` id is not read by engine.js/build.js or lacks an `EFFECT_INFO` description.

**Stat roles** (`CONFIG.STAT_FX`, on top of each stat's share of `combatPower`). `d = B.statDev(score)` =
`clamp((score − 32)/30, −1, 1.6)` (C≈0, A≈+1); in the engine `sd(c,k)` for servant scores, `md(c,k)` for Master stats
(0 when the Master is dead). Master coefficients are deliberately smaller. None of these add `rnd()` calls (they only
change probabilities/magnitudes already rolled), but they change every seed's outcome compared with older versions.
- 筋力 `str`: damage dealt × (1 + str·d); 耐久 `end`: damage taken × (1 − end·d) (combined factor clamped 0.6–1.5), guts +endGuts·d.
- 敏捷 `agi`: retreat success (both the retreat-stance disengage and the weaker-side check) ± agiRetreat·(d_self − d_opp);
  night find chance ± agiFind·(d_hunter − d_target).
- 魔力 `mag`: NP cost × (1 − magCost·d) (`npCostOf`); NP power × `B.npStatMult(sv)` = 1 + magNp·d(mag).
  `npPeak` and `battleOdds` include the same factor, so the opening grade reflects it. The 宝具 stat (`np`) is the NP's own
  appraisal and is **not** used in combat (owner's decision).
- 幸運 `luk`: crit chance + lukCrit·d (≥0); instakill received × (1 − lukInstakill·d); guts + lukGuts·d.
- Master 魔術 `craft`: fortify + mCraftFort·d, scouting + mCraftScout·d, combat power × (1 + mCraftPower·d) while alive.
- Master 精神 `mind`: command-seal failure = clamp(max(0, cs_resist − bond/300) − mMindSeal·d) (low mind can fail without
  cs_resist), seal-saves-master chance + mMindSeal·d, rally hp and 3-day boost × (1 + mMindCs·d), charm resistance
  + mMindCharm·d, opponent `debuff` × (1 − mMindDebuff·d), `uncontrolled` × (1 − mMindControl·d).
- Master 幸運 `luck`: night find chance − mLuckHide·d, master-strike chance × (1 − … − mLuckHide·d), ambush guard + mLuckHide·d.
- Narration (no rnd): retreat 「持ち前の速さで…振り切った」 (agi gap ≥ 0.6), failed retreat 「…の速さが追いすがった」 (≤ −0.6, no pin),
  guts 「…の頑強な霊基は崩れなかった」 (end d ≥ 0.9), charm resisted 「…の呼びかけが引き戻した」 (mind d ≥ 0.45), seal failing
  without cs_resist 「…の令呪は、揺らぐ心のままに光を失った」.

After battle: attacker learns the defender's base; persona reveal; chance to learn the true name
(`0.1 + reveal − conceal×0.6`); clues +1 each way at battle start; related servants (因縁) know each other.

### 7.6 Defeat and the player's fallen flow

- `servantDown`: marks dead, breaks alliance, logs the death, name becomes public. AI masters go to the
  church (80% if seals remain) or vanish. A dead Master's Servant becomes a **stray** with
  `soloLeft = floor(eff(solo))` days and may **recontract** with a servant-less Master (`recontract` 0.45/day).
- Player's servant dies: with `fallenDeath` (0.12) the Master dies too → game over. Otherwise
  `fallenPending` and `checkFallen()` (called after every battle/ambush and after each phase) asks
  decision **`fallen`**: `watch` (church, keep watching; recontract offers may still come), `skip` (church,
  retired → UI fast-forwards to the end), `stray:<id>` (contract a living stray), `steal` (take another
  master's command seals: `stealBase 0.04 + craft/800 + luck/1500 (+0.04 if target hurt) − target
  master_guard×0.1`; success → take over that camp; failure → 60% death, else wounded in church).
- Player's Master dies (any cause): decision **`gameover`**: `watch` / `skip`. The camp is `retired`.
- `contract()` and `moveYou()` move the player's identity to another camp, merging knowledge.

### 7.7 Big decisions (all go through `ask`)

| kind | when | option keys |
|---|---|---|
| `council` | every 5 days, player alive with master | `assault:<id>`, `boost`, `move`, `ally:<id>`, `betray`, `deduce:<id>`, `familiar`, `recover`, `pass` (max 3 + pass, weighted by situation) |
| `cs` | servant about to die, seals left | `escape`, `rally`, `none` |
| `ally` | another camp proposes alliance | `yes`, `no` |
| `recontract` | a stray seeks a master (player servant-less) | `yes`, `no` |
| `event` | bounty issued | `join`, `ignore` |
| `event` | player spots an enemy master in town | `talk`, `follow`, `ignore` |
| `event` | rumor about an enemy whose base is unknown | `chase`, `ignore` |
| `fallen` | player's servant died | `watch`, `skip`, `stray:<id>`, `steal` |
| `gameover` | player's master died | `watch`, `skip` |

`<id>` is the **camp index** (0–6), not a servant id. Option keys are persisted in the URL for replay, so
**do not rename existing keys**; add new ones instead.

Council details: `deduce:<id>` targets the unknown enemy with most clues;
`p = clamp(0.08 + clues×0.12 + reveal + intel×0.5 + master.craft/500 − target conceal×0.5, 0.03, 0.9)`;
failure adds a clue. The church **never** reveals true names (design decision by the owner) — names are
learned by deduction, NPs, scouting, battle insight, relations, alliance, or conversation.
`familiar` costs 20 mana and may reveal one unknown enemy base.

### 7.8 Events

- **World events** (`worldEvent`, 25%/day): leyline (+mana all), disturb (−15 mana all), rain (night terrain = 水辺),
  full moon (+hunt), tremor (`tonight.stir`, +0.12 hunt, day ≥ 3), fog (`tonight.fog`, find −0.15; entries get
  `weather:'fog'`), patrol (`tonight.patrol`, −0.15 hunt, day ≥ 3), festival (no fights tonight), familiar (someone
  learns a base), witness (NP seen → overseer warning, reduces hunting), bounty (on camps with ≥2 kills or ≥2 warnings),
  spot (player decision), rumor (player decision about an enemy whose base is unknown: `chase` may reveal it — or, on
  a miss, may expose the player's base — or `ignore`).
- **Life events** (`lifeEvent`, player camp, 40%/day): meal (profile likes), talk (voice 会話), dream
  (first sentence of 解説), dislike, grail wish, likes, bond line (bond ≥70), outing, master's own day, train (+3),
  tale (first sentence of 人物・性格, ≤ 2 per war, +4), care (hp < 70: +8 hp, +3), quarrel (−3), watch (+4), stars (+4).
  They raise bond, which improves guts, retreat, seal reliability and control.
- **Narration variants**: `G.LINES` in `names.js` (key → array of templates with `{S} {M} {city} {label} {name} {base}
  {A} {B} {where} {W} {O} {by} {c} …`). `line(key, vars)` in the engine picks one by an FNV hash of
  `seed:lineN:entries.length` — **not** `rnd()` — so adding/editing variants never changes a war's outcome. Only the
  keys/vars each call passes are available; a missing var leaves `{x}` in the text.
- **Voice lines (セリフ)**: `sv.voice` is `{ wiki heading: [lines] }` with free-form headings (two wiki templates: the
  FGO-like 召喚/開始/宝具/戦闘不能/勝利/会話/絆… and a short one 自己紹介/戦闘開始/アタック/ダメージ/消滅/敗北/マイルーム…).
  The game reads them only through **scenes** in `G.VOICE_SLOTS` (`config.js`): `{ key, aliases, use }` — 召喚(自己紹介),
  開始(戦闘開始), 宝具, 戦闘不能(消滅・退場), 敗北, 勝利, 聖杯について(願い), 会話(マイルーム・主従関係), 好きなこと, 嫌いなこと, 絆.
  `G.voiceSlotOf(h)` also maps numbered headings (宝具2, 会話その3) to the base scene; `G.voiceHeadings(voice, key)` lists a scene's
  headings (key → aliases → others in wiki order); `G.voiceLines(sv, key)` pools their lines; `G.npVoiceLines(sv, np)` = 宝具 lines naming that NP (else
  lines not naming another NP). `G.VOICE_UNUSED` lists template headings the game ignores (shown as such in the roster).
  The engine's `say(c, [keys])` takes the first scene with lines and picks one by an FNV hash of
  `seed:v:entries.length:campId:key` (`vpick`) — **not** `rnd()` — so editing lines never changes the outcome. Only the
  *presence* of 会話/聖杯について/好きなこと/嫌いなこと/絆 matters (it enables life events). `finalQuote` in `index.html` uses
  `H.voiceLines` too. Uses: summon (player, 召喚), battle head (開始), NP (宝具), death (戦闘不能), end (聖杯について → 勝利),
  life talk/grail/likes/bondv, final quote (勝利/聖杯について/絆 · 絆/聖杯について/会話 · 戦闘不能/敗北/絆). When you add a new use,
  add or reuse a slot (with `use` text in Japanese) — `test/voice.js` fails if the code passes a key that is not a slot.

### 7.9 Log entries (`out.entries`)

`{ day, phase ('prologue'|'day'|'night'|'end'), kind, text, ids [camp ids], you (involves player),
quote? {who,text}, big?, head?, place?, scene?, weather? ('rain'|'moon'), fin?, q?, dk?, auto?, snap }`

- `fin` (kind `death` from battle only): `{ by: camp id of the killer, how, np }` — `how` is `'np'` (the killer's attack NP
  fired in the finishing round → text 「〇〇の宝具『…』が勝敗を決定づけた。」), `'np-earlier'` (NP used earlier in the same
  battle → 「宝具『…』で追い詰めた〇〇が、とどめを刺した。」), `'instakill'` or `'blow'`. Tracked via `c.lastNP = {name, round}`
  (set in `useNP` for attack NPs, reset per battle); `lethal(l, w, cause, round)` builds it and passes it to `servantDown`.
  The fate text also names the NP. None of this calls `rnd()`, so outcomes are unchanged.
- `q`, `dk`, `auto` (kind `choice`): the decision's title, its `kind`, and whether the auto policy answered.

Kinds: `prologue, summon, dayhead, day, night, battle, np, cs, death, event, world, life, scout, ally,
council, choice, quiet, end`. `snap` is a full per-camp snapshot from the **player's knowledge view**
(`name` null if unknown, `persona` null if unknown, `clues`, hp, mana %, cs, ally, fate, …) so the UI can
render any moment without querying the engine. `out.meta[campId]` holds static display info
(trueName, ranks, skill names, NP names, `servantId`, `policy`/`policyLabel`, `base`, and `master` = { name, sex,
age, origin, originLabel, persona, personaDesc, stats (0–100), skills, traits, catalyst, wish, cs, hpMax, manaMax }).
The meta is filled after the prologue without using `rnd()`, so it does not affect determinism.

### 7.10 Result

`{ seed, city, days, you, winner, camps:[{ id, label, slot, trueName, cls, servantId, master, origin, wish,
alive, masterAlive, fate, kills, npUses, battles, power, you, bond, policy, persona }], entries }`

---

### 7.11 Survival curves (`survival.js`)

`HGW.survival = { fingerprint, empty, tally, runner, curveOf, overall, median }`. `runner(roster, { stats?, masters? })`
continues a tally and `step(k)` runs k more auto wars (`runWar`, `player:'none'`, default war settings: 30 days, class
pick, extras on; seeds `sv0`, `sv1`, …, so a tally is reproducible and can be resumed). For each camp the elimination day is
the first entry whose `snap` shows it `alive:false` (not `fate.day`, which recontract/steal overwrite). Format:
`{ format:'hgw-survival', version:1, fp, wars, days, seedBase, servants: { '<class>:<trueName>': { n, w, d:[eliminations on
day 1..] } } }`; survivors = n − Σd. `curveOf(t, days)` → `s[0..days]` (share not yet eliminated at the end of day d).
`fingerprint(roster)` is the same hash the UI uses for records (`rosterFp`) — keep them identical.

## 8. UI (`index.html`)

Single page, two states: **briefing** (intro form) and **watching** (`body.watching`).

- **Briefing settings**: 立場, 進む速さ (1/2/4/8 = ゆっくり/ふつう/はやい/とても速い; the HUD offers 1×–16×), 一言を残す (`words` radio,
  remembered in `hgw.settings.words`; see Words below), 戦争の長さ (`#days` range 10–100, default `CONFIG.ENGINE.maxDays` 30 → passed as
  `engine: { maxDays }`), 七騎の選び方 (`pick` radio `class`/`open` → `war: { pick: 'open' }`), エクストラクラス (`extra`
  radio → `war: { extra: false }`; `warOpts()` builds the object), seed. Length/pick/extra are remembered in `localStorage`
  `hgw.settings` (URL `d`/`p`/`x` win). They change the war, so they are stored in the URL, in `hgw.save.v1` and in history
  records (`days`, `extra`, `pick`; missing = 30 / true / class via `recDays`/`recExtra`/`recPick`; all are part of
  `recordSig`, `open` only appended when set so older signatures are unchanged).
  The HUD `/N` (`#dayMax`) and the calendar (`maxDays` cells, `#calLbl`) follow the war length.
- Data loading: `data/manifest.json` via `HGW.data.loadPublished`; `?data=local` uses the roster tool's
  browser storage; on `file://` the user picks JSON files.
- Layout: HUD (DAY counter, progress, controls: pause, 1×/2×/4×/8×/16×, "next decision", auto-decide, quit,
  ⋯ menu on mobile) · left column (Master ID card with command-seal SVG, Servant panel, status bars) ·
  centre (result, scene view, mobile status strip + focus chip, focus selector, Chronicle log) · right
  (camps list, 30-day calendar) · focus bottom sheet (mobile) · decision dialog (`#dlg`, can be minimised).
- Visual style: "cyber" navy/cyan/gold (reference: Fate/EXTELLA skill screen). Colours are CSS custom
  properties on `:root` (`--cyan`, `--gold`, `--seal`, …). Log item classes are prefixed `k-<kind>`
  (a bare `.night` class once collided with the calendar style).
- Playback: the generator runs ahead; `out.entries` are replayed one by one with per-kind delays
  (`DELAY`) divided by speed. On `tick` the current focus is passed; on `decision` the dialog opens.
  "次の決断まで" renders everything until the next decision. Answer `skip` (fallen/gameover) triggers
  `fastForward()` to the end with auto answers.
- **Opening** (player is a Master, not when replaying a shared link with `c`/`f`): before any log entry is played,
  `#opening` walks through 1) the Master (from `meta.master`), 2) a strength rating of the Servant, 3) the first
  day's focus. Playback (`step()`) does not run while `op` is set, so day 1 starts with the chosen focus (it used
  to start as おまかせ). The rating is computed in the UI from the loaded roster: mean `battleOdds` pA (with and
  without NP) against every other roster servant → rank → grade via `H.gradeOfPct(pct)` (`G.GRADES` in config.js: S ≤ 10%, A ≤ 25%,
  B ≤ 45%, C ≤ 65%, D ≤ 85%, E rest — six levels like Fate ranks; EX is not used because it also means "unrateable"; the roster,
  submit form, ranking page and test/focus.js use the same function);
  plus base power / NP peak ranks, strengths/weaknesses from `effectSummary`, and a recommended focus (`REC_FOCUS[grade]`:
  measured with `test/focus.js` — same seeds, one constant focus for the whole war — S/A → auto, B/C/D → rest, E → hide (E wins
  ~0% whatever the focus; hide survives longest); the old
  trait-based rule (S/A → attack, caster → defend…) won 10% vs auto's 16%, so re-run the test after balance changes). It rates the
  Servant alone, not against the current line-up. Cached per roster (`strengthCache`); ~0.1 s for 64 servants.
  Rosters above `REF_MAX` (120) are compared against 120 evenly spaced reference servants instead of everyone.
- Focus panel: on desktop it can be collapsed to one line (「たたむ」/「ひらく」, saved in `localStorage`
  `hgw.focusCollapsed`); on ≤820px the strip chip + bottom sheet are used as before.
- Chronicle: newest first; collapsed to the latest 10 (desktop) / 5 (≤820px) matching items; "すべての記録を見る"
  expands to a scrollable box (`.logwrap.open`). Filter tabs `[data-lf]`: すべて / ★ハイライト / 自陣営 (`e.you`;
  hidden for observers). `syncLog()` applies the filter (`li.fo`) and the collapse (`li.past`) in JS — call it after
  bulk `show(e, true)` loops. **Highlight** = `hlCheck(e)`: kind `death`/`end`, or any `big` entry except `np` (an NP
  release alone decides nothing; a deciding NP is written into the `death` entry via `fin`, and such items get class `fin-np`). 「CSVで保存」 exports the entries shown so far (`out.entries.slice(0, idx)`,
  no `dayhead`; UTF-8 with BOM; columns 日, 時間帯, 種類, ハイライト, 自陣営, 関わった陣営, 本文, セリフの主, セリフ, 場所).
  The result panel adds: **purposes and arcs of the other camps** (`purposeSection`; all seven for observers; camps that
  were ever the player's are excluded) — master wish, servant wish (`profile.wish` via roster), policy label + `AIM[policy]`,
  battles/NPs/kills, most-fought opponent, fate, and up to 4 highlight entries where the camp is the subject (`ids[0]`, an
  `ally` entry, or `fin.by`); **bond chart** (`bondSection`, player only: last snapshot per day of the camp with `you`,
  forward-filled; solid while the servant is alive, dashed after; hover readout; per-day values in a `<details>`);
  **decision list** (`decisionSection`: `choice` entries with `q`, plus focus runs from `focusLog`); then the highlight
  timeline, 「自陣営の記録を見る」 and CSV export. **All result sections (`details.rsec`, `details.hl`) start collapsed.**
  The chronicle's 「CSVで保存」 (`#csvBtn`) is hidden during play and shown only after `finish()`.
- **Save / resume / records** (all in `localStorage`, nothing but seeds and answers is stored):
  - `hgw.save.v1` — one suspended war: `{ v, at, seed, view, data, fp, c, f, idx, focus, auto, speed, sum }`. Saved by
    `saveProgress()` at each tick, after each answer, on 中断 (`quit`), on `pagehide` and when the tab is hidden; not during
    the opening; cleared when the war finishes. `c` = answered choices + queued `replay`, `f` = the longer of `replayFocus`
    and `focusLog`. 「続きから」 → `start({ mode:'resume', …, to: idx })`, which `catchUp(idx)` renders instantly
    (answering decisions from `c`), then restores `focus`/`auto` and continues.
  - `hgw.history.v1` — finished wars, newest first, `HIST_MAX` (10): `{ v, at, seed, view, data, fp, c, f, sum }`, added in
    `finish()` unless an identical record exists (`recordSig` = seed|view|fp|c|f). 「最初から見る」 = `start({mode:'replay'})`,
    「結末だけ見る」 = the same + `fastForward()`, 「リンクをコピー」 = `recordUrl()`.
  - **Record housekeeping**: each record has ☆ 保護する (`keep: true`) and 消す. `trimHistory()` keeps the newest `HIST_MAX`
    unprotected plus up to `KEEP_MAX` (30) protected records (used when adding and importing). すべて消す also removes protected ones.
    Records may also carry `name` and `w` (words); replaying the same war again copies new words into a record that had none.
  - `fp` = `rosterFp()` = `HGW.survival.fingerprint(roster)` (hash of roster ids, power, npPeak in roster order). On mismatch the user is asked before replaying.
    `data:'local'` switches to the roster tool's data first.
  - Export/import file: `{ format:'hgw-records', version:1, at, history, save }`. Import merges by `recordSig`, sorts by
    `at`, keeps `HIST_MAX`; an incoming `save` replaces the current one only if there is none or the user confirms.
  - `start(o)` options: `{ seed, view, speed, c, f, to, focus, auto, mode: 'new'|'url'|'resume'|'replay' }`. The opening is
    shown only for a new war without replay data.
- **Naming** (opening page 1): `#opName` is prefilled with the rolled name. On 次へ, `applyName()` sets `playerName` and rebuilds the
  generator with the same seed (`makeGen()`, `warGen({ playerName })`), so the opening, board and log use the new name; empty =
  rolled name. Buttons: くじの名前に戻す, 前回の名前 (`hgw.settings.name`). Stored as URL `n`, `save.name`, `record.name`; not part of
  `recordSig` (it does not change the war).
- **Words** (一言を残す, like 80億分の1's 思いを残す): `armWord(e)` marks milestones while entries are shown (not during `catchUp`):
  `first` (first battle `head` involving you), `half` (dayhead ≥ ceil(maxDays/2)), `loss` (your servant's `death`). `step()` asks
  before the next `dayhead` (`askWord`: one prompt per boundary, priority loss > first > half; the others are marked asked);
  `finish()` asks `end` before rendering the result. `#wordDlg`: input ≤ 60 chars, 残す / やめておく / これからは聞かない (turns the
  setting off). Words `{ key, at: idx when written, day, q, text }` are shown in the log as `li.k-words.is-you.hl` right after
  entry `at-1` (also when replaying), saved in `save.w` / `record.w` (never in the URL). `wordsOn` is false for observers,
  record replays and URL replays with `c`/`f`. Result: `lastWordHtml()` (servant's final voice line by situation — 勝利/聖杯について/
  絆 when won, 絆/聖杯について/会話 when alive, 戦闘不能/消滅/敗北/絆 when gone — picked by an FNV hash of the seed, plus your latest
  word) and `wordsSection()`.
- **Images** (only after the war ends: result panel 「画像にする」 → `openImages()`): renders all available cards at once and shows
  them as thumbnails in `#imgDlg` (`#imgPick`, buttons `[data-card]`) — `result` (結末のまとめ), `servant` (呼んだサーヴァントの評価:
  the opening rating of the servant summoned in camp `youId` plus its survival curve when `survQuick()` finds a tally) and
  `both` (result card without its footer, `cardDivider`, then the servant card continued with `cardHead(…, top)`). Observers get
  `result` only and skip the picker. Picking one shows the preview (`#imgView`) with ← 選び直す / 保存する (download) / 共有する
  (Web Share with files, only when `canShare`). `makeCard(kind)` draws on a 4400px draft canvas, then copies it over `cardBg` at
  the content height (1200px wide); fonts are loaded first with `document.fonts.load(…, text)` (system fonts offline). There is no
  image button in the opening.
- **Survival curve in the lore dialog** (`#survBox`, `renderSurvival`): `survQuick()` uses `data/survival.json` when its `fp`
  matches the roster, else the browser cache `hgw.survival.v1`; `loadSurvival()` then tops up to `SURV_TARGET` (800) wars in
  chunks of `SURV_CHUNK` (3) with `setTimeout` gaps (longer while a war is playing), saving every 60 wars and redrawing with
  partial results. Chart: servant curve, dashed roster average, median-day marker, per-day values in `<details>`.
- **Modal dialogs**: while any `.dlg.on:not(.min)` is open, `syncLock()` (a MutationObserver on every `.dlg`) fixes the body in
  place (`body.locked`, `top: -scrollY`) so phones do not scroll the page behind; closing restores the position. Use `toTop()`
  instead of `scrollTo(0, 0)` (it defers to the lock). `.dlg-in` uses `100dvh` and `overscroll-behavior: contain`; `.dlg-foot`
  is sticky at the bottom (the confirm buttons stay reachable); the keyboard hints (`.keys`) are hidden at ≤820px.
- **Face portraits**: `H.faceCandidates(name)` → `img/faces/<encodeURIComponent(name)>.webp|png|jpg`; `H.faceUrl(name, onFound)`
  probes them once per name with `Image()` (cached promise; null until found) — expect up to three 404s per looked-up name. The UI only
  asks for servants the player may see (`canLore`: own servant or true name known). `fic(name, key, big)` renders the class icon plus a
  hidden `<img class="face" data-face>`; `fillFaces(root)` (called after the board, opening title, lore and result render) shows found faces
  and hides the icon (`.fic.has`), so with no face nothing moves. Places: Servant panel (`#svFace`, 72px float), camps list, opening
  title, lore dialog (`.face.xl`, 112px float right), result table. roster.html's detail shows the face or the expected file name
  (`.facebox`, `fillFace()`).
- **Class icons**: `H.classIcon(key)` (`config.js`) → `img/classes/<key>.webp`, non-standard classes → `extra.webp`. The UI takes
  the key from `meta.servantId` / `result.camps[].servantId` (`keyOf(id)`, `ci(key, big)`) for the camps list, the Servant panel,
  the opening's rating title, the result table and purposes; the image cards draw them via `cardIcons` (`loadCardIcons()`).
- **Stat explanations** (`TIPS`, `tipAttr(key, classKey)`, `#tipPop`): any element with `data-tip="<key>"` shows a short
  explanation on mouse hover, on tap/click (pinned until tapped again or elsewhere), and on keyboard focus (Esc closes).
  Keys: `sv.str|end|agi|mag|luk|np` (servant ranks; `data-cls` adds the class weight note from `classWeights`),
  `st.hp|mana|bond|ws|cs` (status bars, mobile strip, command-seal emblem, 令呪 in the Master card), `m.mana|craft|body|
  mind|luck` (opening Master stats), `ev.rate|power|np` (opening meters). **Texts contain no numbers, ranges or
  formulas** (owner's request; wording: 「戦闘力」 not 「地力」, 「宝具発動に要する魔力」, 「クリティカルヒット」, 魔力 → 「魔力による攻撃は、
  対魔力による影響を受けやすい」, no 対魔力 note on 筋力): they say only what each stat affects (§7.5 Stat roles). The class note says whether the
  class weighs that stat more or less, without the multiplier. Update the texts when a stat's role changes.
- **Install**: `beforeinstallprompt` shows 「アプリとして追加する」 on the intro; iOS Safari (not standalone) gets a
  「ホーム画面に追加」 hint. `--safe-t` (safe-area top) pads the HUD and intro for standalone mode.
- **Servant lore** (`#lore`): only for the player's own servant and servants whose true name is known in the
  current snapshot (`canLore`: `snap.name` or `you`), so it never spoils. Opened from the Servant panel, the camps
  list (known names get an ⓘ), the opening's rating page, and the result table. Shows 元ネタ/異名/属性/願い, an
  excerpt of 解説 (`text.commentary`, full text and 人物・性格 in `<details>`), and links: Wikipedia search for the
  true name (parentheses stripped) and for the 元ネタ, and the kagemiya page (`page` or trueName, EUC-JP encoded in
  the browser via a `TextDecoder('euc-jp')` reverse table). No external fetches. Playback pauses while it is open.
- Scenes: `setScene(scene, day|night, weather)` probes `img/scenes/{scene}-{time}.webp` along the fallback
  chain (`G.sceneCandidates`); if no image exists a procedurally drawn SVG skyline is used. 404s for
  missing images are expected.
- **URL state (replay/share)**: `?seed=<s>&view=you|all&c=<answers joined by '.'>&f=<focus codes per day>
  [&data=local][&d=<war length, only if ≠30>][&p=open (draw from all servants)][&x=0 (no extra classes)][&n=<player's name>]`. Focus codes: `o a d s r h l` (one char per day). Opening such a URL and pressing 開戦
  with the same seed replays the identical war (same data required).

`submit.html` (player request form, Japanese): loads the published roster with `data.js` (published overrides become the
baseline). Tab 新しい英霊を申請: kagemiya page name and/or pasted wiki text (parsed live with `importServant`; 「Wikiのページと同じ
内容です」 keeps the text out of the request when a page name is given). Tab 調整を希望: pick a published servant (`?servant=名`; the
game's lore dialog links here). Section 2 shows 「ゲームではこう判断されます」 (`judgeHtml`: skills by source dict/guess/default,
NPs attack/support) and, per skill/NP, the effects plus 「判断の理由」 (`whyOf`: `effectSource` + `matched`, NP `attackBasis`).
Each item has 「ここを直してほしい」 (free-text `notes[target]`, also one for ステータス), a 「〜ではない（消してほしい）」 checkbox (`drop`,
keys `s|n:index:name`; previewed via a temporary `CONTENT_OVERRIDES` entry in `withContent`) and, folded, 「効果を自分で指定する」:
stat overrides, per-skill/NP effect specs (effect + strength preset 0.4/0.7/1/1.4/2 + tag/@cond) and NP attack/support;
`withProp()` applies them temporarily to `SERVANT_OVERRIDES`/`STAT_OVERRIDES`/`NP_OVERRIDES`, rebuilds (`fromJSON(toLean())`) and shows
grade (same formula as the opening), average win rate, power and NP peak before → after. Section 3 edits セリフ (`HGW.voiceEdit`),
解説・人物, プロフィール・因縁 of the read servant, each with a free-text note; only sections that differ (`cedit`) are sent. Debounces use
one timer per function (`soon(fn)`). Output: `{ format:'hgw-request', version:1, kind:'add'|'adjust', servant, class, id, page, wiki,
overrides {servant,stats,np}, contentEdit {voice: {heading: lines|[]}, text: {key: str|''}, profile: {key: str|''}, relations: [...]},
drop {skills|nps: [{i, name}]}, contentBase {section: hashOf(contentOf(wikiOf(sv), section))}, notes [{target, text}], reason, content,
from, contact }` as a GitHub new-issue URL (title/body prefilled; the wiki text, then `contentEdit`, are dropped from the body when the
URL would exceed ~7600 chars and the player is told to attach the file, which 「GitHub で申請する」 also saves), a downloaded .json, or
copied text. The body lists 直してほしいところ and 内容の書き換え in words and ends with a ```` ```hgw-request ```` block. `roster.html`
accepts that block (or the bare JSON) pasted into 取り込み, and the file via ファイルを読む (`findRequest` / `applyRequest`): imports
`wiki` as a servant, merges `overrides`, applies `contentEdit` patches and `drop` onto the servant's current content and stores them in
`CONTENT_OVERRIDES` (merged with an existing entry; `base` = hash of the wiki value; a section equal to the wiki is removed; skipped
with a message if the servant is not in the roster yet), shows the request in `#reqBox` and as a box at the top of that servant's
detail (`lastReq`), puts the page name into the GitHub import box when there is no text, and jumps to the servant.

`roster.html` (admin tool, Japanese): import wiki text/JSON, list with review flags (要確認), per-skill
effect editor (each row explains who/when/what via `E.describe`, plus a legend of all effects), 「真名・クラスを変える」 (`#idd`,
writes `CONTENT_OVERRIDES[wikiName].identity` and moves the servant/np/stats/pages keys), 「どの英霊にも当たらない手直し」 in 公開・保存
(override keys that match no servant / skill, with 消す), stat editor and content editor (「内容を編集」: skills/NPs/voice/text/profile/relations; the voice tab shows one
field per `VOICE_SLOTS` scene with its `use`, a coverage row, per-NP line matches, unused/unknown headings (renamable), and a
「まとめてテキストで」 mode in the old `見出し：「セリフ」` format; writes
`CONTENT_OVERRIDES`) (all write overrides), "draw 7" preview, export `servants.json` (lean) and `overrides.json`.
- **Published roster sync**: on load (http(s) only) it fetches `data/manifest.json` + listed servants/overrides itself
  (`fetchPublished`, not `data.js`). An empty browser roster is replaced by the published one. Otherwise a **three-way merge**
  (`merge3`) compares the last-synced published state (`hgw.roster.base` = `{ at, sv: {id: sig}, ov: {table: {key: JSON}} }`,
  `sig` = `hashOf(canon(toLean(sv)))`), the current published state and the browser state, per servant id and per override
  key: unchanged locally → take published; changed locally → keep local. 「公開中のリストにそろえる」 applies it, 「…で置き換える」
  discards local changes. With no base yet, a local value equal to published counts as unchanged. `advanceBase()` moves the
  base forward where local and published agree (e.g. after the owner published). Local-only changes are shown as
  未公開の追加/変更 badges, a filter, and a summary in 保存.
- **Layout**: tabs `#views` (`[data-v]` roster / import / cmp / save / pool → `.view[data-view]`, `showView`, remembered in
  `hgw.roster.view`). The roster view is a list/detail browser (`#browse`): left `.lpane` (sticky, own scroll) with the toolbar and
  `#list` rows (`button.svr[data-id]`, `aria-selected`), right `#detail` (`renderDetail()`: header with ‹ › (`step`), then `body(sv, i)`:
  stats, actions, face (`.facebox`), skills/NPs, review, voice summary, profile, relations, commentary excerpt). Selection `sel` (`select(id, {open, flash, force})`, remembered in
  `hgw.roster.sel`); ↑↓/j/k move within the shown list (`shownIds`). ≤900px: one column, `#browse.show` swaps list ↔ detail
  (「← 一覧へ」). `jumpTo(id)` switches to the roster view, clears filters if needed and selects. Sync state also shows as a badge on the
  公開・保存 tab and a `#syncBanner` with 「公開中のリストにそろえる」; `status()` also shows a toast (`#toast`).
- **Wiki page name** (`pageBox`): every detail has 「Wikiのページ名」 (input + 保存 → `PAGE_OVERRIDES`; a pasted kagemiya URL is
  decoded from EUC-JP; equal to `page` or empty removes the override). `pageState(sv)`: `missing` (has `pageMissing`, no override),
  `fixed` (override set after a miss), `unknown` (no `page` and no override) → row badge 「ページ名？」 and filter chip
  「Wikiのページ名を確かめる」 (`flag: 'page'`). 「Wikiから取り直す」, the kagemiya link and search use `B.pageOf`.
- **Finding**: toolbar with search (`fold()`: NFKC, katakana→hiragana, ignores spaces/・; matches true name, aliases,
  class, origin, page, skill and NP names; `/` focuses, Enter opens the first hit, Esc clears), sort (class/name/grade/power/
  NP/review count), class select (`#clsSel`, `filter`) and toggle chips (`flag`: 要確認あり, 未公開の追加・変更, 内容を手直し中). Each row shows the S–E grade (same formula as
  the game's opening: `strengthTable`, cached per `rosterVer`, which `save()`/`rebuildAll()` bump).
- **試し戦い** (its own tab, `section#cmpPanel`): left/right pickers are text
  inputs with a `<datalist>` (`findSv` matches label, then prefix/substring of the folded name), swap, NP/home/terrain options,
  `battleOdds` result, and 「全騎との勝率」 (`vsAll`, hardest opponents first; clicking one puts it on the right). Each servant card
  has 試し戦いの左に／右に.
- **Name import**: names textarea + mode select; 「名前をコピーして GitHub を開く」 opens the workflow page (`GH_WF`) synchronously
  and copies the names (GitHub cannot prefill `workflow_dispatch` inputs). Cards have 「Wikiから取り直す」 (same, refresh mode,
  `page` or true name) and a kagemiya link (`eucEncode`, same as the game).
- Persists in `localStorage`: `hgw.roster.v2` (**lean** servants — `index.html`'s リストツールで作ったリストを使う rebuilds them with
  `fromJSON`), `hgw.overrides.v1` (includes the published overrides after a sync), `hgw.roster.base`, `hgw.roster.view`, `hgw.roster.sel`.
  `[hidden]` is forced to `display: none` (the `.row` flex rule used to override it).

---

`ranking.html` (spoiler page, linked from the intro's last `.foot.spoil` paragraph; `#rankLink` gets `?data=local` when the game
uses the roster tool's data): loads like the game (`loadPublished`, or `loadLocal` with `?data=local`), computes per servant the grade
and mean 1-on-1 win rate (same as the opening), 優勝率 = `w/n` and 生存 = `median(curveOf())` from the survival tally (data/survival.json
if the fingerprint matches, else `hgw.survival.v1`, else it tops up to 800 wars in chunks like the lore dialog and saves to the same key),
power, NP peak, and five abilities from stats + `effectSummary` (passive + onNP×0.5, terrain-bound ×0.5): 攻め (str, power, crit,
pierce, instakill, power_vs, debuff, initiative), 守り (end, guard, evade, magic_guard, mental_guard, master_guard), 粘り (end, luk, guts,
escape, regen, solo), 隠密 (agi, stealth, conceal), 索敵 (agi, detect, intel, reveal), each graded by rank within the roster (S–E) with
a bar. Sortable headers / select, class filter, search; a row opens the full name, stats, notable effects and NPs (the hardest/easiest opponent
lists were removed: they were the same strong servants for everyone). The table scrolls inside `.tbl` (sticky name column; long names are
cut with … and the class goes on a second line, full name in `title`), so the page itself never overflows. Header alignment follows the
column (`cls`: grade `ce` centred, abilities `l` left, numbers right).

## 9. Tests and verification

No test framework; plain Node scripts (Node ≥ 18).

```bash
node test/sim.js 500            # 500 auto wars: errors, win/draw ratio, median days, per-war counts, win rates
node test/sim.js 1 <seed>       # print one war's full log
node test/interactive.js 200    # random focus/answers through the generator; replays 50 and checks mismatch
node test/run.js test/lucan.txt # parse wiki text and show what was read
node test/skills.js             # skill dictionary (canonical names, generic names, references)
node test/content.js            # content overrides
node test/kagemiya.js           # kagemiya HTML → wiki markup conversion
node test/survival.js           # survival tally sanity; playerName does not change the war
node test/voice.js              # voice slots match the code; editing lines does not change the war; per-scene coverage
node test/fgo.js                # FGO-style blocks and chant lines are not read as skills/NPs (parse + load-time cleanup)
node test/effects.js            # every effect primitive is read by the engine/build and has a description; identity override round trip
node test/focus.js [N]          # is REC_FOCUS really the best constant focus per grade? (N=1000 seeds × 7 focuses, ~40 s)
node tools/survival.js [N]      # rebuild data/survival.json (default 3000 wars, ~20 s); --check compares fingerprints
node tools/kagemiya.js show ルーカン   # fetch and print what would be imported (needs network access to seesaawiki.jp)
node test/rebuild.js <dir> [out.json]   # rebuild exported JSON, print per-servant effects
python3 -m http.server          # then open http://localhost:8000/
```

Baseline with current data (119 servants, 500 wars): errors 0, ~84–86% decided (draw ~14–16%), median 18 days (P10 10,
P90 30), ~17 battles, ~27 NP uses, ~4.4 command-seal events, ~0.8 joint (allied) battles per war; berserker camps lose their Master
~4% of the time (others ~2%). Interactive: errors 0, **mismatch 0**,
~7 decisions per war.

Before opening a PR, run `sim.js` and `interactive.js` (must be `errors 0`, `mismatch 0`). Compare balance
against `origin/main` if you touch the engine or config (a `git worktree` of main is convenient). For
UI changes, check in a headless browser at desktop width and **390px** width (no horizontal overflow).
Chromium + Playwright may be available in agent sandboxes.

---

## 10. Recipes

| Task | Where / how |
|---|---|
| Add a class | One entry in `CLASS_DEFS` (`config.js`). |
| Tune balance | `CONFIG.ENGINE`, `BATTLE_K`, `STAT_W`, `RANK_SCORE`, `NP_TYPE`; re-run `sim.js`. |
| Tune what a stat does | `CONFIG.STAT_FX` (see §7.5 Stat roles). Keep Master coefficients smaller than servant ones; update `TIPS` in `index.html` if a role changes. |
| Voice heading the game should read | Add it to a slot's `aliases` in `VOICE_SLOTS` (`config.js`); a new scene needs a slot + a `say(c, ['key'])` call. |
| Teach a skill name | `SKILL_DICT` in `effects.js`: `'名前': [['effect', factor, params?], …]`. If the name is an ordinary word whose meaning depends on the description, also add it to `GENERIC`. Add canonical names to `test/skills.js`. |
| Teach a description pattern | Add a rule to `RULES` (`{ re, id, f?, not?, only? }`). Check with `test/rebuild.js` that existing servants did not change unexpectedly. |
| Fix one servant | Use `roster.html` (writes `overrides.json`) or edit `data/overrides.json` directly. Prefer overrides over editing `servants.json`. |
| New effect primitive | Add to `EFFECTS`, then read it in `engine.js` via `eff(c, id, terrain)` / `effVs`. Unread primitives do nothing. |
| New persona | Add to `G.PERSONAS` (all bias keys optional). Keep magnitudes small; `cs` and `retreat` strongly affect draw rate. |
| New big decision | Use `yield* ask(camp, kind, {title, body, options}, autoFn)`; new kinds need no UI work. Add the kind to §7.7. |
| New focus | Add to `FOCUS` with a unique one-char `code`. |
| New place / scene | `WORLD.places` in `names.js` (`terrain` must match effect conds or be null); scene in `scenes.js` with a `fallback`; image spec in `img/scenes/README.md`. |
| Master wishes | `G.WISHES_BY_ORIGIN` / `G.WISHES_COMMON` / `G.WISHES_BY_PERSONA` in `names.js` (`G.wishPool(origin, persona)`; origin entries weigh double). |
| New world/life event | Add a weighted key in `worldEvent`/`lifeEvent`; use `log()` and, if the player chooses, `ask()`. Put the text in `G.LINES` (`names.js`) and log `line(key, vars)`. |
| More wording for an existing event | Add strings to the key's array in `G.LINES`; outcomes are unaffected. |
| Fixed masters | Add a JSON array file and list it under `masters` in `manifest.json`. |
| Data changed by hand | Nothing to do: `data.yml` rebuilds `data/survival.json` on push (or upload the files to `data/incoming/` for a reviewed PR). Locally `node tools/survival.js`; the game recomputes in the browser while it does not match. |
| New servant data | Owner runs the Actions workflow 「kagemiya から取り込み」 (page names → PR), imports via `roster.html` → "公開用に保存", or drops a pack in `data/packs/` and lists it in the manifest. |
| Improve wiki reading for old data | Fix `parser.js`, then run the workflow in 取り直し mode (re-fetches every page; lean JSON has no source text). |

---

## 11. Workflow conventions

- The owner (GitHub `Pippiniden`) reviews and merges. **Do not push to `main`.** Work on a feature branch
  from the latest `origin/main` and open a PR.
- Commit messages and PR descriptions are written in Japanese for the owner.
- Keep changes focused; update `README.md` (Japanese, for humans) and this file when behaviour or formats change.
- Do not commit generated images, large temporary files, or local test output.

## 12. Gotchas

- `data/servants.json` is ~40k lines; load it with Node instead of reading it into context.
- Japanese text processing relies on regexes over full-width characters; always run `R.normalize()` first
  (full-width → half-width, unify `～〜~`, `（）`, `＋`, `？`).
- Variables used by `log()` must be declared before the first `log()` call (TDZ bit us once with `tonight`).
- `snap()` is copied into every log entry; keep it small and JSON-serialisable.
- Camp ids are array indices and stable for the whole war; servant ids are `classKey:trueName`.
- A camp can change hands (`contract`, `steal`): the player's camp id can change mid-war; the UI finds the
  player camp via `snap.find(c => c.you)`.
- Probabilities are clamped in many places; when adding terms, clamp the final value.
- The church name and all narration live in `names.js` / engine strings; never hard-code English text in the UI.
