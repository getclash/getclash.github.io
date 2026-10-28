# Clash 下载指南

独立整理 Clash / Mihomo 生态软件、维护状态、GitHub 加速下载和原创使用教程的 Astro 静态网站。正式地址为 **[https://getclash.github.io/](https://getclash.github.io/)**，对应仓库为 `getclash/getclash.github.io`。本站与所列项目没有隶属关系，不提供代理节点或订阅。

界面使用 Astro 自定义主题，采用文档站的清晰导航、阅读排版和平台分类体验。所有内容在构建时生成 HTML，搜索、筛选和对比等增强交互在浏览器中运行。

首批数据核验日期：**2026-10-27**。维护状态和收录版本以条目来源为准；目录不承诺覆盖所有临时分支。

## 本地开发与构建

使用 Node.js 24；持续集成也固定为该版本。首次开发或更新依赖后，先按锁文件安装依赖：

```sh
npm ci
```

启动 Astro 开发服务：

```sh
npm run dev
```

访问 [http://127.0.0.1:4321](http://127.0.0.1:4321)。预览服务仅监听本机，Astro 会监听源码变化并更新页面。按 Ctrl+C 停止。

```sh
npm run build
npm run check
```

`npm run build` 使用 Astro 生成 `dist/`，不要直接编辑该目录。`npm run check` 校验构建结果，涵盖页面标题与描述唯一性、自引用 canonical、中文语言标记、单一 H1、JSON-LD、站内链接和片段、网站地图、数据引用，以及下载来源和加速前缀。不逐一请求外部链接，也不验证二进制文件安全性。正式发布前还需运行下方的 `npm run export:pages`，同步仓库根目录的发布文件。

需要为其他独立域名生成页面时，可设置 `SITE_URL`；默认值仍为 `https://getclash.github.io`。这是根站部署配置，迁移到带子目录的项目站点时还需调整站内资源路径。

## 内容与资料维护

| 文件 | 内容 |
| --- | --- |
| `data/site.json` | 站点网址、仓库、描述、核验日期、下载前缀和 Bing 验证码 |
| `data/desktop-apps.json` | 桌面及跨平台客户端，包含历史项目 |
| `data/ecosystem-apps.json` | 移动端、内核、面板与路由器等生态项目 |
| `data/guides.json` | 教程正文、阅读要点、参考来源与相关文章 |
| `data/faq.json` | 常见问题分类、答案、排查步骤与相关阅读 |
| `src/pages/` | Astro 页面及静态路由 |
| `src/layouts/` | 共享页面外壳、导航和 SEO 标签 |
| `src/lib/content.mjs` | 软件与教程数据整合、页面内容和辅助方法 |
| `src/styles/` | 自定义主题样式 |
| `data/app-icons.json` | 官方项目图标的路径、来源与署名记录 |
| `public/` | 浏览器交互脚本、图标、分享图及原样复制的静态资源 |
| `astro.config.mjs` | Astro 静态构建配置 |
| `scripts/check.mjs` | 数据、静态页面与下载链接校验 |

软件 `slug` 在两份软件数据中必须唯一，并与详情页地址对应；教程 `slug` 在教程数据中唯一。`relatedApps` 和 `relatedGuides` 必须引用现有条目。新增资料时保留项目仓库、官方发布记录或维护者文档等来源；不要仅凭最近没有更新就断言停更，也不要把第三方重打包标成原作者官方版本。

`npm run refresh` 只核验 GitHub 上游并生成 `data/release-report.json`，不会自动修改软件资料。报告列出版本变化、归档状态差异、失效地址和缺少安装资产等情况；人工核对后再更新目录并重新构建。该报告已排除在 Git 跟踪之外。可选 `GITHUB_TOKEN` 环境变量仅用于 API 请求，不写入日志或报告；GitHub API 限流或原仓库失效时不应猜测下载地址。

## 下载加速与历史项目

默认前缀为 **`https://gh-proxy.com/`**，可在 `data/site.json` 的 `downloadProxy` 修改。软件数据保存原始 GitHub Release 资产地址，例如：

```text
https://github.com/OWNER/REPOSITORY/releases/download/TAG/FILE
```

构建时将加速前缀与原地址拼接，生成下载按钮；`data-download-source` 保留原始来源，便于核对。线路用法参见 [GH-Proxy 使用说明](https://gh-proxy.com/docs/quick-start)。第三方服务的可用性可能变化，本站不存储或修改安装包，也不承诺加速效果。

访问者可以在“下载说明”页保存自己的 HTTPS 加速前缀，仅影响当前浏览器。商店和维护者官方分发页直接使用相应入口，不套用 GitHub 文件加速。

当原仓库删除、原始资产撤回或无法核验可信安装包时，设置 `kind: "unavailable"` 和 `url: null`，保留历史条目、维护状态与迁移说明。不要为了凑齐下载按钮拼造 GitHub 地址。仍可核验的历史包必须写明版本；预发布版也要明确标注。

## GitHub Pages 发布

当前网站使用 GitHub Pages 的 **Deploy from a branch → `main` → `/(root)`** 模式。GitHub 直接发布仓库根目录，因此仅构建 `dist/` 不会更新线上页面，也不需要切换至 GitHub Actions 发布。

每次修改内容、样式或配置后运行：

```sh
npm run export:pages
```

该命令会先构建和校验，再将生成页面、`_astro/` 打包资源、公开资源、网站地图及 `.nojekyll` 复制到仓库根目录。`.pages-manifest.json` 记录本批生成文件，后续仅按该清单清理旧产物，包括 Astro 新构建不再使用的带哈希资源，不覆盖 `src/`、`data/`、`scripts/`、`public/`、`.github/`、`astro.config.mjs`、`package.json` 或 README 等源码。请勿手工编辑根目录的生成文件；新增顶层页面或资源目录时，应先更新导出脚本的目录白名单。

检查变更后，将源码、根目录生成文件和 `.pages-manifest.json` 一并提交并推送到 `main`。GitHub 自带的 **pages build and deployment** 流程会发布这些根文件。

仓库的 `.github/workflows/pages.yml` 使用 Node.js 24 和 `npm ci`，然后依次重新构建、校验内容、执行以下一致性检查，不另外运行部署任务，避免与分支发布竞争：

```sh
node scripts/export-pages.mjs --check
```

如果 CI 提示根产物不同，请本地重新运行 `npm run export:pages` 并提交生成差异。只提交源码而忘记导出，线上页面会保留旧内容。

部署后核对首页、软件详情页、教程、`404.html`、`robots.txt` 和 `sitemap.xml`。分支发布配置参考 [配置 GitHub Pages 发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## Bing 验证与提交

在 [Bing Webmaster Tools](https://www.bing.com/webmasters/) 添加 `https://getclash.github.io/`，选择 HTML Meta 标签验证。将 Bing 提供的 `msvalidate.01` 标签中 **content 的值**写入 `data/site.json`：

```json
"bingVerification": "Bing 提供的验证码"
```

默认留空时不会生成验证标签。也可以通过构建环境变量 `BING_VERIFICATION` 设置实际值。设置后运行 `npm run export:pages`，提交并推送更新；重新部署后查看首页源代码，确认验证码正确，再回 Bing 完成验证。

验证后提交网站地图 **[https://getclash.github.io/sitemap.xml](https://getclash.github.io/sitemap.xml)**，并使用 URL Inspection 检查首页和重要的软件、教程页面。`robots.txt` 已声明网站地图；404 页面设为 `noindex`，不会进入地图。提交只帮助发现页面，不保证收录或排名。相关说明见 [Bing 网站验证帮助](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b) 和 [URL Inspection](https://www.bing.com/webmasters/help/URL-Inspection-55a30305)。
