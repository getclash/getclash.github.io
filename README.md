# Clash 图鉴

独立整理 Clash / Mihomo 生态软件、维护状态、GitHub 加速下载和原创使用教程的静态网站。正式地址为 **[https://getclash.github.io/](https://getclash.github.io/)**，对应仓库为 `getclash/getclash.github.io`。本站与所列项目没有隶属关系，不提供代理节点或订阅。

首批数据核验日期：**2026-10-27**。维护状态和收录版本以条目来源为准；目录不承诺覆盖所有临时分支。

## 本地开发与构建

需要 Node.js 20 或更新版本。项目没有第三方运行依赖，无需安装 npm 包。

```sh
npm run dev
```

访问 [http://127.0.0.1:4321](http://127.0.0.1:4321)。预览服务仅监听本机，启动时先构建；修改 `data/`、`public/` 或构建脚本后会自动重新生成，刷新浏览器即可查看。按 Ctrl+C 停止。

```sh
npm run build
npm run check
```

构建产物位于 `dist/`，不要直接编辑该目录。校验涵盖页面标题与描述唯一性、自引用 canonical、中文语言标记、单一 H1、JSON-LD、站内链接和片段、网站地图、数据引用，以及下载来源和加速前缀。不逐一请求外部链接，也不验证二进制文件安全性。

需要为其他独立域名生成页面时，可设置 `SITE_URL`；默认值仍为 `https://getclash.github.io`。这是根站部署配置，迁移到带子目录的项目站点时还需调整站内资源路径。

## 内容与资料维护

| 文件 | 内容 |
| --- | --- |
| `data/site.json` | 站点网址、仓库、描述、核验日期、下载前缀和 Bing 验证码 |
| `data/desktop-apps.json` | 桌面及跨平台客户端，包含历史项目 |
| `data/ecosystem-apps.json` | 移动端、内核、面板与路由器等生态项目 |
| `data/guides.json` | 原创教程正文、参考来源、相关软件与教程 |
| `public/` | 样式、浏览器交互脚本、图标及分享图 |
| `scripts/build.mjs` | 由数据生成静态 HTML、网站地图和公开目录数据 |

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

仓库名应为 `getclash.github.io`，并归 `getclash` 用户或组织所有。在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中，将 **Source** 设为 **GitHub Actions**。

仓库内的 Pages 工作流应依次执行：

1. 检出源代码并设置 Node.js 20 或更新版本。
2. 运行 `npm run build` 和 `npm run check`。
3. 使用 Pages artifact 上传 `dist/`。
4. 通过 Pages 部署任务发布，并启用 `pages: write`、`id-token: write` 权限和 `github-pages` 环境。

部署后核对首页、软件详情页、教程、`404.html`、`robots.txt` 和 `sitemap.xml`。GitHub Pages 配置参考 [使用自定义工作流部署](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## Bing 验证与提交

在 [Bing Webmaster Tools](https://www.bing.com/webmasters/) 添加 `https://getclash.github.io/`，选择 HTML Meta 标签验证。将 Bing 提供的 `msvalidate.01` 标签中 **content 的值**写入 `data/site.json`：

```json
"bingVerification": "Bing 提供的验证码"
```

默认留空时不会生成验证标签。也可以通过构建环境变量 `BING_VERIFICATION` 设置实际值。重新部署后查看首页源代码，确认验证码正确，再回 Bing 完成验证。

验证后提交网站地图 **[https://getclash.github.io/sitemap.xml](https://getclash.github.io/sitemap.xml)**，并使用 URL Inspection 检查首页和重要的软件、教程页面。`robots.txt` 已声明网站地图；404 页面设为 `noindex`，不会进入地图。提交只帮助发现页面，不保证收录或排名。相关说明见 [Bing 网站验证帮助](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b) 和 [URL Inspection](https://www.bing.com/webmasters/help/URL-Inspection-55a30305)。
