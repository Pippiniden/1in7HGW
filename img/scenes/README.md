# 背景画像（情景）

観戦画面の上部に出る背景です。ここに画像を置くと、SVGで描いている街並みの代わりに使われます。

## ファイル名と置き方

`{種類}-day.webp`（昼）と `{種類}-night.webp`（夜）の2枚で1組です。

- 推奨サイズ：**1920×640**（横3：縦1）。小さくても 1500×500 以上
- 形式：WebP（1枚300KB前後まで）。JPEGやPNGにしたいときは `js/scenes.js` の `ext` を変える
- 画面の幅によって左右が切れます。スマホでは中央の6割ほどしか見えないので、**見せたいものは中央に**置く
- 下側に場所の名前の帯が重なるので、下の1/6には大事なものを置かない
- 人物・文字・ロゴは入れない

置いていない種類は、下の「代わり」の画像を使います。それも無ければ今の街並みのSVGになるので、1枚ずつ増やしていけます。

## まず作る12枚（基本の6種類×昼夜）

| 種類 | ファイル | 使われる場面 |
|---|---|---|
| 市街地 | `city-day.webp` / `city-night.webp` | 駅前の繁華街。場所が分からない場面すべて（開幕など） |
| 住宅街 | `residential-day.webp` / `residential-night.webp` | 新興住宅地 |
| 水辺 | `waterside-day.webp` / `waterside-night.webp` | 港・河川敷・海浜公園（専用の画像が無いとき） |
| 森 | `forest-day.webp` / `forest-night.webp` | 郊外の森 |
| 山と寺社 | `shrine-day.webp` / `shrine-night.webp` | 神社の裏山 |
| 工場跡 | `industrial-day.webp` / `industrial-night.webp` | 閉鎖中の工場跡 |

## あれば使う種類

| 種類 | ファイル名の頭 | 場所 | 代わり |
|---|---|---|---|
| 港湾倉庫街 | `harbor` | 港湾倉庫街 | 水辺 |
| 河川敷 | `river` | 河川敷 | 水辺 |
| 海浜公園 | `beach` | 海浜公園 | 水辺 |
| 廃寺 | `temple` | 山中の廃寺 | 山と寺社 |
| 路地 | `alley` | 旧市街の路地 | 住宅街 |
| 学園 | `school` | 夜の学園 | 住宅街 |
| 屋上 | `rooftop` | 高層ビルの屋上 | 市街地 |
| 洋館 | `mansion` | 丘の上の洋館 | 森 |
| 地下 | `underground` | 地下駐車場 | 工場跡 |
| 教会 | `church` | 監督役の教会（保護・情報） | 山と寺社 |

種類を増やすときは `js/scenes.js` に1行足し、`js/names.js` の場所の `scene` に書きます。

## 生成用の指示文

全部の画像で絵柄をそろえるため、共通部分の後ろに場面ごとの文を足して使ってください。

**共通（先頭に付ける）**

```
anime background art, highly detailed, cinematic wide shot, 3:1 panoramic aspect ratio,
a quiet provincial Japanese city in the present day, urban fantasy atmosphere,
subtle magical tension in the air, deep blue color palette with cyan highlights,
no people, no characters, no text, no logo, no watermark
```

**除外（ネガティブ指定が使える場合）**

```
people, person, character, silhouette of people, text, letters, signboard text, logo, watermark, frame, border, blurry, lowres
```

**時間帯（どちらかを最後に付ける）**

- 昼：`clear afternoon light, soft clouds, calm and ordinary atmosphere, slightly desaturated`
- 夜：`night, deep navy sky, scattered stars, faint moonlight, glowing windows and street lamps, cyan ambient glow, ominous calm`

**場面**

| 種類 | 指示文 |
|---|---|
| city | `station front shopping street, mid-rise buildings and neon-less shop signs, pedestrian crossing, overhead power lines, view along the street` |
| residential | `newly developed residential area on a gentle slope, rows of two-story houses, small park with a streetlight, road curving into the distance` |
| waterside | `harbor and riverside, concrete embankment, calm water reflecting the sky, distant bridge and cranes` |
| forest | `dense forest on the edge of town, narrow path disappearing between tall cedar trees, mossy ground, light filtering through the canopy` |
| shrine | `long stone stairway up a wooded hill to a small Shinto shrine, red torii gate, stone lanterns` |
| industrial | `abandoned factory site, rusted pipes and tanks, broken windows, cracked concrete yard, chain-link fence` |
| harbor | `harbor warehouse district, rows of corrugated warehouses, shipping containers, gantry cranes, wet asphalt` |
| river | `wide river with grassy embankments, a long steel bridge, baseball field on the riverbed` |
| beach | `seaside park with a promenade and railing, sandy beach, breakwater and lighthouse in the distance` |
| temple | `abandoned mountain temple, weathered wooden main hall, overgrown stone garden, fallen leaves` |
| alley | `narrow alley in the old town, wooden houses and small shops, hanging lanterns, stone pavement` |
| school | `empty high school grounds, school building with many windows, sports field, clock on the facade` |
| rooftop | `rooftop of a high-rise building, railing and water tank, the whole city spread out below` |
| mansion | `old western-style mansion on a hill surrounded by trees, iron gate, overgrown garden` |
| underground | `underground parking garage, concrete pillars, fluorescent lights, painted parking lines, long perspective` |
| church | `small church on a hill, stone walls and a bell tower, cemetery with crosses, cypress trees` |

例（森・夜）：共通 ＋ `dense forest on the edge of town, …` ＋ 夜の文。
