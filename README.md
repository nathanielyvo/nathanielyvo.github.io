# Runxi Cheng · 个人学术主页 / Academic Homepage

[中文](#中文) · [English](#english)

---

## 中文

这是一个零依赖的静态学术主页。所有内容都写在 `data/content.js` 一个文件里,运行 `node build.mjs` 就会渲染成 `index.html`。不开 JavaScript 也能读到全部内容,页面运行时不向任何第三方发请求。

### 目录结构

```
data/content.js          ← 唯一需要编辑的内容文件
build.mjs                ← 生成器(Node 22,无 npm 依赖)
index.html, 404.html     ← 生成结果(不要手改,会被覆盖)
robots.txt, .nojekyll    ← 同样由 build.mjs 生成(.gitignore 缺失时也会补上);填好网址后还会生成 sitemap.xml
assets/css/style.css     ← 样式(浅色 / 深色主题、响应式、打印版简历)
assets/js/main.js        ← 渐进增强:主题切换、窄于 1000px 时的 “Contents” 目录菜单、摘要 / BibTeX 按钮与复制、
                           Selected / All 筛选、图片灯箱
assets/fonts/            ← 自托管 EB Garamond:拉丁文正体 / 斜体,另有两个只含希腊字母的小文件(如 τ),
                           只有页面用到时才会下载。许可为 SIL OFL 1.1,见 OFL.txt。中文使用系统字体
assets/img/              ← 头像 profile.jpg、favicon.svg、apple-touch-icon.png、og-image.png(社交分享卡片)
assets/papers/           ← 各论文的示意图(teaser)原图,点击图片时在灯箱里显示
assets/papers/thumbs/    ← 页面上实际显示的 WebP 缩略图(由 _tools/thumbs.mjs 生成)
assets/papers/full/      ← 可选:比原图更清晰的版本,只在灯箱里打开(见 “添加一篇论文”)
assets/Runxi_Cheng_CV.pdf ← 页面上 “CV” 链接指向的简历,由 _tools/cv.mjs 从本页的打印版生成(不含电话号码)
_tools/                  ← 维护脚本:thumbs.mjs(缩略图)、og.mjs(分享卡片)、cv.mjs(简历 PDF)、shot.mjs(截图)、
                           edge.mjs(公用)
```

### 修改内容

1. 编辑 `data/content.js`。
2. 运行 `node build.mjs`(需要 Node.js 22 或更新版本,不需要 `npm install`)。最后打印的 `!` 开头的行是提醒,比如缩略图、分享卡片或简历 PDF 比内容旧、网址还没确认;以 `·` 开头的行只是说明(比如某个 PDF 链接改用了 arXiv)。它们都不会中断构建。
3. 本地预览:

   ```bash
   python3 -m http.server 8000
   # 浏览器打开 http://localhost:8000/
   ```

   请用上面的方式预览,不要直接双击 `index.html`。在 `file://` 下浏览器会拦截网页字体,也会限制剪贴板,看到的效果和线上不一样。

内容里按普通键盘输入即可,生成器会自动做排版处理:

- 直引号 `'` `"` 会转成弯引号。
- 会议名和年份之间用不换行空格连起来(如 “ICLR 2026”)。
- 带数字、缩写或很短一段的连字符词(如 CET-6、top-k)不会在行尾被拆开;其他连字符词只在两端对齐的正文里断行,而且只断在自己的连字符处。
- 正文(简介、新闻、经历条目、TL;DR、摘要)两端对齐并自动断字;窄屏和手机上改为左对齐、不断字。
- 课程成绩里的 `A-` 显示为带真正减号的 “A−”。

生成器还会做安全检查:

- 内容里出现类似电话号码的字符串时,构建直接报错并停止。
- 链接到的本地 PDF 里检测到疑似电话号码时,会给出警告。

### 更换头像

用新照片覆盖 `assets/img/profile.jpg`。页面按 3:4 的竖幅完整显示整张照片(其他比例会居中裁掉多出的部分),所以最好直接用 3:4 的照片。建议至少 450×600,文件尽量小于 150 KB。如果换成其他文件名,同时修改 `content.js` 里的 `person.photo`。

换完后依次运行 `node _tools/og.mjs`(更新分享卡片)和 `node build.mjs`。

### 添加一篇论文

在 `content.js` 的 `publications` 数组里加一项。论文按类别分组显示,顺序是 会议论文 → 预印本 → 技术报告 → 其他贡献(Other Contributions,见下面的 `role`)。每个类别内,本人为第一作者或共同一作的论文排在前面,其余按年份从新到旧排列;年份相同的保持数组里的先后顺序。所以新条目放在数组的哪个位置都可以。示例:

```js
{
  id: 'my-new-paper',                 // 唯一 id,用作页面锚点 #pub-my-new-paper
  short: 'NewMethod',                 // 在新闻和经历中引用时显示的短名
  title: 'Full Paper Title',
  authors: ['Runxi Cheng*', 'Co Author*', 'Advisor'],  // 名字后加 * 表示共同一作;本人名字会自动加粗
  venue: 'ICLR 2027',                 // 徽章上的会议名
  venueNote: 'Oral',                  // 可选:Oral / Spotlight / Under Review 等
  venueFull: 'International Conference on Learning Representations (ICLR) 2027',
  year: 2027,
  status: 'published',                // 'published' 会议论文 | 'preprint' 预印本 | 'report' 技术报告
  selected: true,                     // 是否出现在 “Selected” 筛选里
  tags: ['Model Merging'],
  tldr: '一句话概括(英文)。',
  abstract: '摘要全文……',
  teaser: 'assets/papers/my-new-paper.png',  // 示意图放在 assets/papers/;png / jpg / svg 均可
  teaserCaption: '图注。',
  teaserWide: false,                  // 可选:横长的流程图设为 true,会以通栏显示
  links: { paper: 'https://…', arxiv: 'https://arxiv.org/abs/…', pdf: 'https://arxiv.org/pdf/…', code: 'https://github.com/…' },
  bibtex: `@inproceedings{…}`,
}
```

可选字段:

- `titleAlt`:论文曾用的标题。
- `firstAuthor: true`:作者列表里看不出本人是共同一作时,用它补充说明。
- `role` 与 `authorsNote`:本人不在作者列表中时,如实说明所做的贡献。这样的条目不和署名论文混在一起,而是单独列在 “Other Contributions” 下(如 SIGMA),徽章旁标注 “Contributor”。

关于链接:`pdf` 如果指向 raw.githubusercontent.com(PMLR 的 PDF 放在那里,国内经常打不开),而这篇论文又有 arXiv 版本,页面上的 “PDF” 会改为链接 arXiv 的 PDF,“Paper” 仍然指向会议页面;`content.js` 里保留原地址,构建时会打印一行说明。

摘要和 BibTeX 用的是原生的 `<details>` 折叠面板,默认收起;不开 JavaScript 也能点开。开着 JavaScript 时由链接行里的 “Abstract” “BibTeX” 按钮控制,并多一个 “Copy” 按钮。

论文编号 [1]、[2]…… 会按上面的顺序自动计算,新闻和经历里的引用编号也会同步更新。

加了示意图以后,先运行 `node _tools/thumbs.mjs`,再运行 `node build.mjs`。脚本会在 `assets/papers/thumbs/` 里生成约 60 KB 以内的 WebP 缩略图,原图保留给灯箱。png / jpg 缺缩略图时构建会提醒。本身已经很小的 svg 不需要缩略图。

灯箱不会把位图放大到超过它本身的像素(否则会糊);svg 可以任意放大。如果原图不够清晰(比如很宽的流程图),可以另外放一张高清版到 `assets/papers/full/`,文件名与原图相同、扩展名为 `.webp`(也可以是 `.png` / `.jpg`),例如从论文的矢量原图按 2–3 倍导出。灯箱会改为打开这张图,并按它一半的像素尺寸显示(高分屏上正好清晰);页面本身仍然只加载缩略图。

**Selected / All 筛选**:开着 JavaScript 时,页面默认只显示 `selected: true` 的论文。点 “All”,或者访问 `…/?pubs=all#publications`,可以看到全部论文。不开 JavaScript 或打印时,总是列出全部论文。

### 添加一条新闻

在 `news` 数组的**最前面**加一项(最新的在前):

```js
{ date: '2026.10', text: '<b>NewMethod</b> accepted to <b>ICLR 2027</b>.', paper: 'my-new-paper' },
```

- `date` 格式为 `YYYY.MM`。
- `text` 可以包含 `<b>`、`<em>`、`<a>`。
- `paper` 可选;填写后,会在论文短名后自动加上可点击的 [n] 编号。

荣誉(`honors`)的 `year` 显示在右侧的日期栏里(手机上在同一行右端);没填年份的条目那里留空,补上即可。

新闻超过 11 条时,只显示最近 10 条,其余折叠在 “Show N earlier items” 按钮后面。现在的 9 条全部显示。这个数字在 `build.mjs` 顶部的 `NEWS_VISIBLE` 里修改。

### 网址与社交分享卡片

网站的公开网址取自环境变量 `SITE_URL`,没有时取 `content.js` 里的 `meta.url`。生成器**不会猜**网址。在网址确定之前:

- canonical 链接、`og:url`、结构化数据(JSON-LD)里的 `url` / `@id` 和 `sitemap.xml` 都不输出,`robots.txt` 里也没有 Sitemap 一行;
- 打印版和简历 PDF 上不印网址;
- 分享卡片的图片标签(`og:image` / `twitter:image`)整个不输出,`twitter:card` 退回纯文字的 `summary`——这些标签只接受绝对地址,`assets/img/og-image.png` 在网址确定前用不上;
- `404.html` 按网站位于域名根目录(`/`)处理:它的样式表、图标按根路径引用,回首页的链接指向 `/`。为防万一,这个页面会把自己用到的那几条样式内嵌在 `<style>` 里(从 `style.css` 原样摘出),所以即使样式表没加载到(放在子路径、或本地双击打开),它仍是纸色版式而不是浏览器默认的 Times;但那种情况下回首页的链接仍会指错,所以网址一确定就该复查这一页。

每次构建都会提醒这一点。网址确定后,把它写进 `meta.url`,然后依次运行 `node _tools/og.mjs`、`node build.mjs` 和 `node _tools/cv.mjs`。

`assets/img/og-image.png` 是在微信、Slack、X 等处分享链接时显示的卡片。它由 `node _tools/og.mjs` 根据 `content.js` 生成,用到的字段是姓名、职位、单位、地点、研究方向、头像和网址。这些字段一旦改动,`node build.mjs` 会提醒你重新生成卡片。

### 简历 PDF

`node _tools/cv.mjs` 用无界面浏览器把本页的打印版(A4)存成 `assets/Runxi_Cheng_CV.pdf`,所以 PDF 里的作者、标题、会议和本人角色与页面完全一致。旧文件会先备份到 `_variants/`(同一天只备份第一次)。脚本会再检查一遍 PDF 里没有电话号码,也没有本地预览地址。`content.js` 比 PDF 新时,`node build.mjs` 会提醒重新生成。

如果更想用自己排版的 LaTeX 简历,直接用它覆盖 `assets/Runxi_Cheng_CV.pdf` 即可(注意不要带电话号码),之后就不要再运行 `cv.mjs`。

`_tools/` 里的脚本需要本机装有 Microsoft Edge 或 Google Chrome,会以无界面方式调用。其他浏览器路径可以用 `BROWSER=/path/to/browser` 指定。

### 部署到 GitHub Pages

1. 在 GitHub 新建一个名为 `<你的用户名>.github.io` 的公开仓库。
2. 把本目录推送上去。`.gitignore` 已经排除了 `_shots/`、`_variants/` 和 `.DS_Store`,`git add .` 不会带上截图和方案稿:

   ```bash
   git init && git add . && git commit -m "Homepage"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<你的用户名>.github.io.git
   git push -u origin main
   ```

3. 在仓库的 **Settings → Pages** 中,把 **Source** 设为 “Deploy from a branch”,分支选 `main`、目录选 `/ (root)`。几分钟后即可通过 `https://<你的用户名>.github.io/` 访问。
4. 把最终网址(例如 `https://<你的用户名>.github.io/`,或者自己的域名)写进 `meta.url`,然后重新运行 `node _tools/og.mjs`、`node build.mjs` 和 `node _tools/cv.mjs`,再提交一次。

`.nojekyll` 让 GitHub 原样发布文件。`robots.txt` 不让搜索引擎收录以 `_` 开头的目录。每次修改内容后:`node build.mjs`,然后 `git commit` 并 `git push`。

也可以部署到任何静态托管服务(Netlify、Cloudflare Pages、Vercel、学校服务器等):上传整个目录即可,不需要构建命令。

### 仅用于开发的目录

- `_variants/`(设计方案稿)和 `_shots/`(截图)网站用不到,可以删除,也不会被提交。
- `_tools/` 请保留,更新缩略图、分享卡片和简历 PDF 要用到它。

截图示例:

```bash
node _tools/shot.mjs http://localhost:8000/ _shots/home.png --dark --mobile
```

---

## English

A zero-dependency static academic homepage. All content lives in one file, `data/content.js`. Running `node build.mjs` renders it into `index.html`. The page is fully readable without JavaScript and makes no third-party requests at runtime.

### Layout

```
data/content.js          ← the only file you normally edit
build.mjs                ← the generator (Node 22, no npm packages)
index.html, 404.html     ← generated output (do not edit by hand; it is overwritten)
robots.txt, .nojekyll    ← also generated by build.mjs (plus .gitignore if it is missing); sitemap.xml too, once the address is set
assets/css/style.css     ← styles (light / dark themes, responsive layout, print-as-CV)
assets/js/main.js        ← progressive enhancement: theme toggle, the "Contents" menu below 1000px, abstract / BibTeX
                           buttons and copy, Selected / All filter, figure lightbox
assets/fonts/            ← self-hosted EB Garamond: Latin roman / italic, plus two tiny Greek-only files (e.g. τ)
                           that download only when the page uses them. SIL OFL 1.1, see OFL.txt. Chinese uses system fonts
assets/img/              ← profile.jpg, favicon.svg, apple-touch-icon.png, og-image.png (social card)
assets/papers/           ← full-size paper teaser figures (shown in the lightbox)
assets/papers/thumbs/    ← the WebP renditions shown on the page (made by _tools/thumbs.mjs)
assets/papers/full/      ← optional sharper renditions, opened only in the lightbox (see "Adding a paper")
assets/Runxi_Cheng_CV.pdf ← the PDF behind the "CV" link, printed from this page by _tools/cv.mjs (no phone number)
_tools/                  ← maintenance scripts: thumbs.mjs (thumbnails), og.mjs (social card), cv.mjs (CV PDF),
                           shot.mjs (screenshots), edge.mjs (shared)
```

### Editing content

1. Edit `data/content.js`.
2. Run `node build.mjs` (needs Node.js 22 or newer; no `npm install`). Lines starting with `!` at the end are reminders, for example a thumbnail, social card or CV PDF older than the content, or an unconfirmed site address. Lines starting with `·` are notes only (for example, a PDF link that now points to arXiv). None of them stops the build.
3. Preview locally:

   ```bash
   python3 -m http.server 8000
   # then open http://localhost:8000/
   ```

   Preview this way rather than by opening `index.html` directly. Under `file://`, browsers block the web fonts and restrict the clipboard, so the page does not look the way it will online.

Type plain ASCII in the content; the generator handles the typography:

- Straight quotes become curly quotes.
- A venue and its year are joined by a no-break space (e.g. "ICLR 2026").
- A hyphenated compound with a figure, an acronym or a very short part (CET-6, top-k) is never broken at a line end. Other compounds break only in justified prose, and only at their own hyphen.
- Prose (bio, news, experience bullets, TL;DRs, abstracts) is justified and hyphenated; on narrow screens and phones it is set ragged-right, without hyphenation.
- A grade written `A-` is set as "A−" with a true minus sign.

The generator also runs some safety checks:

- It stops with an error if anything that looks like a phone number appears in the content.
- It warns if a linked local PDF seems to contain one.

### Replacing the photo

Overwrite `assets/img/profile.jpg` with the new photo. The page shows the whole photo as a 3:4 portrait (any other shape is cropped evenly to fit), so a 3:4 photo works best. At least 450×600; try to keep it under 150 KB. If you use a different file name, update `person.photo` in `content.js` too.

Then run `node _tools/og.mjs` (to refresh the social card) and `node build.mjs`.

### Adding a paper

Add an entry to the `publications` array in `content.js`. See the example in the Chinese section above.

Papers are grouped as conference papers → preprints → technical reports → other contributions (see `role` below). Within a group:

- papers on which you are first or co-first author come first;
- the rest follow, newest year first;
- ties keep their order in `content.js`.

So a new entry can go anywhere in the array.

Key fields:

- `authors`: a trailing `*` marks equal contribution. Your own name is bolded automatically.
- `status`: `'published'`, `'preprint'` or `'report'`.
- `selected`: include the paper in the "Selected" filter.
- `venueNote`: optional. `Oral`, `Spotlight` or `Best …` get the highlighted badge; `Under Review` is shown quietly.
- `teaser`: a png/jpg/svg in `assets/papers/`. Set `teaserWide: true` to show a wide pipeline figure at full column width.
- `links`: `paper`, `arxiv`, `pdf` and `code`.

Optional fields:

- `titleAlt`: a former title of the paper.
- `firstAuthor: true`: marks you as co-first author when the byline alone does not show it.
- `role` and `authorsNote`: an honest description of your contribution when you are not on the byline. Such entries are not mixed with the papers you authored: they are listed under "Other Contributions" (SIGMA, for example) and marked "Contributor" next to the badge.

Links: when `pdf` points to raw.githubusercontent.com (where PMLR keeps its PDFs; it often does not load from mainland China) and the paper has an arXiv version, the page's "PDF" link goes to the arXiv PDF instead, while "Paper" still opens the proceedings page. `content.js` keeps the original address, and the build prints a note.

Abstracts and BibTeX are native `<details>` panels, closed by default, and they open without JavaScript too. With JavaScript, the "Abstract" and "BibTeX" buttons in the link row drive them, and a "Copy" button appears.

Reference numbers [1], [2], … follow the order above and are recomputed automatically. Citations in News and Experience stay in sync.

After adding a figure, run `node _tools/thumbs.mjs` and then `node build.mjs`. The script writes a WebP of about 60 KB or less to `assets/papers/thumbs/`, and the original stays behind the lightbox. The build warns if a png/jpg figure has no current thumbnail. Small SVGs need none.

The lightbox never enlarges a bitmap beyond its own pixels (it would look soft); SVGs scale freely. If a figure is not sharp enough (a very wide pipeline figure, say), add a high-resolution rendition to `assets/papers/full/` with the same base name and a `.webp` extension (`.png` / `.jpg` also work), for example exported from the paper's vector figure at 2–3×. The lightbox then opens that file and shows it at half its pixel size, which is sharp on high-density screens. The page itself still loads only the thumbnail.

**Selected / All.** With JavaScript on, the list opens on the papers marked `selected: true`. Click "All", or link to `…/?pubs=all#publications`, to see every paper. Without JavaScript, and in print, every paper is listed.

### Adding news

Add an item at the **top** of the `news` array (newest first):

```js
{ date: '2026.10', text: '<b>NewMethod</b> accepted to <b>ICLR 2027</b>.', paper: 'my-new-paper' },
```

- `date` uses the format `YYYY.MM`.
- `text` may contain `<b>`, `<em>` and `<a>`.
- `paper` is optional. When set, a clickable [n] reference is added after the paper's short name.

The `year` of each entry in `honors` is shown in the date column on the right (at the end of the line on phones). Entries without a year leave it blank; add the year to fill it.

Once there are more than 11 items, the 10 most recent are shown and the rest fold behind a "Show N earlier items" button. All nine current items are shown. Change this with `NEWS_VISIBLE` at the top of `build.mjs`.

### Site address and social card

The public address comes from the `SITE_URL` environment variable, or else from `meta.url` in `content.js`. The generator **never guesses** it. Until it is set:

- the canonical link, `og:url`, the JSON-LD `url` / `@id` and `sitemap.xml` are left out, and `robots.txt` has no Sitemap line;
- printed copies and the CV PDF carry no web address;
- the social-card image tags (`og:image` / `twitter:image`) are left out altogether and `twitter:card` falls back to the text-only `summary`, because those tags only accept an absolute URL; `assets/img/og-image.png` is unused until the address is known;
- `404.html` assumes the site sits at the root of its domain (`/`): its stylesheet, icons and its link home are all root-relative. As insurance it also inlines the handful of rules it needs (copied verbatim from `style.css` at build time), so it keeps the paper palette and both themes even when that stylesheet does not load — a project subpath, or a local `file://` preview. The link home is still wrong in that case, so re-check this page as soon as the address is confirmed.

Every build reminds you of this. Once the address is confirmed, put it in `meta.url`, then run `node _tools/og.mjs`, `node build.mjs` and `node _tools/cv.mjs`.

`assets/img/og-image.png` is the card shown when the link is shared (WeChat, Slack, X, …). `node _tools/og.mjs` draws it from `content.js`, using the name, position, affiliation, location, research interests, photo and address. `node build.mjs` warns when any of these has changed since the card was made.

### The CV PDF

`node _tools/cv.mjs` prints this page with its A4 print stylesheet, in a headless browser, to `assets/Runxi_Cheng_CV.pdf`. The PDF therefore shows exactly the same authors, titles, venues and roles as the page. The previous file is first copied to `_variants/` (once per day). The script checks the PDF again for phone numbers and for the local preview address. `node build.mjs` reminds you to rerun it when `content.js` is newer than the PDF.

If you would rather use a CV typeset in LaTeX, overwrite `assets/Runxi_Cheng_CV.pdf` with it (without the phone number) and stop running `cv.mjs`.

The `_tools/` scripts drive a headless Microsoft Edge or Google Chrome. Point them at another browser with `BROWSER=/path/to/browser`.

### Deploying to GitHub Pages

1. Create a public repository named `<username>.github.io`.
2. Push this folder to it. `.gitignore` already excludes `_shots/`, `_variants/` and `.DS_Store`, so `git add .` leaves the screenshots and drafts out:

   ```bash
   git init && git add . && git commit -m "Homepage"
   git branch -M main
   git remote add origin https://github.com/<username>/<username>.github.io.git
   git push -u origin main
   ```

3. In the repository, open **Settings → Pages**. Set **Source** to "Deploy from a branch", choose branch `main` and folder `/ (root)`. The site appears at `https://<username>.github.io/` after a few minutes.
4. Put the final address (for example `https://<username>.github.io/`, or your own domain) in `meta.url`. Then run `node _tools/og.mjs`, `node build.mjs` and `node _tools/cv.mjs` again, and commit once more.

`.nojekyll` makes GitHub publish the files as they are. `robots.txt` keeps the `_`-prefixed folders out of search engines. After each change, run `node build.mjs`, then `git commit` and `git push`.

Any other static host (Netlify, Cloudflare Pages, Vercel, a university server) also works: upload the whole folder. No build command is needed.

### Development-only folders

- `_variants/` (design drafts) and `_shots/` (screenshots) are not needed by the site. You can delete them, and they are not committed.
- Keep `_tools/`: it is needed to refresh the thumbnails, the social card and the CV PDF.

Example screenshot:

```bash
node _tools/shot.mjs http://localhost:8000/ _shots/home.png --dark --mobile
```
