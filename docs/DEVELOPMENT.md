# 开发与本地出图

话卷使用 React、TypeScript 和 Vite，编辑内核为 Tiptap。网页预览、PNG 和命令行出图共用 `ConversationCanvas`。服务端只提供静态文件，运行时不需要数据库、API Key 或 AI 服务。

提交问题或改动见[贡献指南](../CONTRIBUTING.md)。

## 环境

使用 Node.js 22.13 以上、npm 和仓库中的 `package-lock.json`：

```bash
npm ci
npm run dev
```

开发服务默认只监听本机。若需要从其他设备访问，显式传入 `--host` 并确认网络访问范围。网页字体已随依赖和构建提供，无需安装系统字体。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/app/`、`src/editor/` | 工作台、输入、历史与编辑操作 |
| `src/data/`、`schemas/` | 文档类型、校验和迁移 |
| `src/project/`、`src/persistence/` | 导入导出、附件和浏览器存储 |
| `src/renderer/`、`src/export/` | 共用画布、资源就绪检查、PNG 和分段 |
| `src/i18n/` | 界面与成图标签语言 |
| `src/styles/` | 工作台和成图样式，语义变量在 `tokens.css` |
| `cli/`、`src/cli/` | 离线命令和渲染页 |
| `fixtures/` | 虚构示例、边界输入和本地资源 |
| `skills/convoscroll/` | 可独立使用的浏览器出图 Skill |

正文存为 Markdown，身份、附件、思考和工具记录使用结构化字段。修改前可参照 [Schema](SCHEMA.md)、[项目与 Markdown 格式](PROJECT_FORMAT.md) 和 [测试数据](FIXTURES.md)。

## 检查

```bash
npm run typecheck
npm test
npm run build
npm run licenses:check
```

涉及导入、附件、渲染或导出时，追加浏览器与 CLI 检查；修改成图还应检查长代码、公式、宽表、多图和分段：

```bash
npm run test:cli
node scripts/compare-web-export.mjs
node scripts/check-release-boundaries.mjs
```

这些命令默认使用本机 Google Chrome。发布边界检查也接受 `--browser chromium` 或 `--browser webkit`；相应浏览器须已安装。其他浏览器回归脚本通过 `CONVOSCROLL_REVIEW_URL` 指定预览地址，默认端口为 43179。测试产物写入 `output/`。

Schema 和示例检查使用 Python 3 与 `jsonschema`：

```bash
python3 scripts/validate-project.py
```

同一操作系统与 Chrome 版本下，网页和 CLI 的 PNG 应逐字节一致。跨浏览器或系统检查布局、字体和内容完整性，不要求相同哈希。Safari 或 iPhone 的输入和下载须在实际设备上检查。

## 可选的命令行出图

CLI 默认使用已安装的 Google Chrome：

```bash
node cli/convoscroll.mjs render conversation.md -o conversation.png
node cli/convoscroll.mjs render conversation.convcanvas -o conversation.png --scale 2
node cli/convoscroll.mjs render conversation.md -o conversation.png --project conversation.convcanvas
node cli/convoscroll.mjs --help
```

首次运行会构建独立渲染页，后续按源码和资源变化重建。渲染拦截外部网络请求，只读取明确提供的输入和本地附件。同名输出文件会被覆盖，输入、附件和符号链接受保护。中途强制结束可能留下不完整的输出。

若系统没有 Google Chrome，可按需要安装与项目版本对应的 Chromium：

```bash
node node_modules/playwright-core/cli.js install chromium
node cli/convoscroll.mjs render conversation.md --browser chromium -o conversation.png
```

Linux 缺少浏览器系统依赖时，可使用 `install --with-deps chromium`，可能需要管理员权限。`--browser chromium` 不会让所有开发检查自动切换浏览器。

## 静态部署

`npm run build` 生成 `dist/`。部署时启用 HTTPS，配置单页应用回退，并应用 `public/_headers` 中的响应头。`dist-cli/` 只供本机命令行使用，不部署为网站。

仓库提供 Cloudflare Workers Static Assets 配置。自部署前核对 `wrangler.jsonc` 中的 Worker 名称、账户和域名，使用自己的目标。先试运行打包：

```bash
npm run cloudflare:dry-run
```

确认构建和目标后，`npm run cloudflare:deploy` 会上传并发布。换域名不会迁移浏览器草稿，使用 `.convcanvas` 导出与导入。

更新依赖后重新生成第三方许可：

```bash
npm run licenses:generate
npm run licenses:check
```

## 自动检查和发布

[CI](../.github/workflows/ci.yml) 在 PR、main 更新和手动运行时执行应用与 CLI 测试、构建、许可、Schema、生产边界和网页/CLI PNG 对照。PNG 只比较同一次运行中的网页与 CLI 输出。

`lexencole/convoscroll` 的 main 检查通过后，可将生成的 `dist/` 部署到 Cloudflare。启用方式：

1. 创建 GitHub `production` Environment，只允许 main 部署。
2. 添加 Environment secret `CLOUDFLARE_API_TOKEN`，以及 Environment variables `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_CUSTOM_DOMAIN`。域名填写主机名，如 `example.com`，不带协议或路径。Token 按 [Cloudflare 文档](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 限制到实际账户与域名资源。
3. 将 Repository variable `ENABLE_CLOUDFLARE_DEPLOY` 设置为 `true`。未设置时只运行检查。

部署只使用检查通过且仍为 main 最新提交的构建。PR 和 fork 不发布。Fork 若需要自动发布，须先调整 workflow 中的仓库限制和自己的 Worker 目标。项目选择 GitHub Actions 时，不再为同一 Worker 同时启用 Workers Builds。

`scripts/write-deploy-config.mjs` 从基础配置与 Environment variables 生成忽略的 `output/ci-wrangler.json`。此脚本要求 `wrangler.jsonc` 保持标准 JSON 语法。关闭自动发布时清除 `ENABLE_CLOUDFLARE_DEPLOY`；回退版本可使用 Cloudflare 的部署记录或提交代码回退后重新推送 main。
