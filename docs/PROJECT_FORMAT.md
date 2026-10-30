# 项目文件和导入格式

话卷支持三种导入格式，导入后都转换为同一个 `ConversationDocument`（见 [SCHEMA.md](SCHEMA.md)）：

- `.convcanvas` 项目文件：完整的文档和附件原文件，用于保存、备份和换设备。
- Conversation Markdown：用 HTML 注释标出消息和内容，适合人和 AI 书写。v1 只表达消息和正文；v2 增加思考过程、工具记录、图片和文件。
- 普通 Markdown：整段作为一条 AI 消息。

预览和 PNG 只读取转换后的文档，不读取项目文件本身。

## `.convcanvas` v1

`.convcanvas` 是标准的 ZIP 单文件，MIME 为 `application/vnd.convcanvas+zip`。导入时按扩展名或 ZIP 文件头识别。包内只接受 Manifest 声明的固定入口和附件路径：

```text
project.convcanvas
├── manifest.json
├── document.json
└── assets/
    ├── 0000.bin
    ├── 0001.bin
    └── ...
```

附件保存原始二进制和 MIME。`.bin` 只是包内的安全文件名，不改变内容类型。用户的文件名只保存在 Manifest 和 Asset 信息中，不参与路径拼接。

### Manifest

`manifest.json` 和 `document.json` 必须是有效 UTF-8 JSON；编码损坏时拒绝整个导入，不以替代字符改写内容。Markdown 导入也要求有效 UTF-8。工具与未知内容的 JSON 嵌套限制见 [Schema 运行时约束](SCHEMA.md#block)。Manifest v1 只接受以下字段：

```json
{
  "format": "conversation-canvas-project",
  "packageVersion": 1,
  "schemaVersion": 1,
  "createdAt": "2026-08-27T00:00:00.000Z",
  "appVersion": "0.1.0",
  "documentPath": "document.json",
  "documentByteSize": 1234,
  "documentSha256": "<64 位小写十六进制>",
  "assets": [
    {
      "assetId": "asset-example",
      "storageKey": "asset:asset-example",
      "fileName": "example.png",
      "mimeType": "image/png",
      "state": "available",
      "path": "assets/0000.bin",
      "byteSize": 2048,
      "sha256": "<64 位小写十六进制>"
    },
    {
      "assetId": "asset-missing",
      "storageKey": "asset:asset-missing",
      "fileName": "missing.pdf",
      "mimeType": "application/pdf",
      "state": "missing"
    }
  ]
}
```

规则：

1. `packageVersion`、`schemaVersion` 和浏览器 IndexedDB 的 `storageVersion` 是三个独立的版本号。
2. `document.json` 是完整的 `ConversationDocument`，须通过 v1 校验。
3. 导出时，所有 Asset 的来源统一写为 `source.kind: local` 和 `storageKey: asset:<assetId>`，不包含原浏览器的 IndexedDB 键、Object URL、Base64 或设备上的临时路径。
4. `UnsupportedBlock.raw` 原样保留；其中的附件引用按 [Schema 规则](SCHEMA.md#未知内容)识别。
5. 可用的文档和附件，其字节数和 SHA-256 须与 Manifest 一致。
6. `missing` 状态的附件没有路径、字节数和摘要。导出遇到缺失附件时默认停止，用户明确确认后才生成带缺失状态的项目文件。
7. 当前读取器无法完整保留的 Manifest 字段会阻止导入；文档中未知类型的 Block 转为 `UnsupportedBlock`，原始 JSON 放入 `raw`。

### 上限

| 项目 | 上限 |
| --- | ---: |
| 压缩后的文件 | 100 MiB |
| 展开后的总大小 | 160 MiB |
| 单个附件 | 32 MiB |
| ZIP 条目数 | 512 |

编辑器为新增附件设置 82 MiB 的预算，按“仍被引用的已知附件总量”计算。82 MiB 附件 + 16 MiB 文档 + 1 MiB Manifest + 1 MiB 元数据和压缩开销，正好不超过 100 MiB。每次添加附件前都会实际序列化当前文档；文档已超过 16 MiB 时不允许继续添加。Markdown 文件先受 8 MiB 读取上限保护，转换后的文档再受 16 MiB 的编辑上限保护；导出始终以最终的 100 / 160 MiB 检查为准。

82 MiB 是编辑器的写入预算，16 MiB 和 1 MiB 是预留空间，都不是 `.convcanvas` v1 的读写限制。只要压缩后不超过 100 MiB、展开后不超过 160 MiB、单个附件不超过 32 MiB，早期版本生成的项目文件仍可导入和重新导出，包括文档或 Manifest 超过预留空间的，以及缺失附件超过 510 个的（缺失附件不占 ZIP 条目）。512 的上限只计实际的 ZIP 条目。已知附件总量降到预算以内之前，不能再添加附件。

从 IndexedDB 恢复项目时，按顺序读取每个仍被引用的本地附件，用实际的 `Blob.size` 校正 `byteSize`，不信任可能过期的元数据：

- 原文件丢失时，项目仍可打开，但清除该附件的 `byteSize`，并阻止继续添加附件，直到用户删除这个附件或重新导入。
- 原文件实际超过 32 MiB 时，须先删除才能继续添加附件。
- 读取出错时进入恢复错误界面，不当作缺失或 0 字节处理。
- 测试附件和不再被引用的旧记录不参与校正。

导入项目文件时，同样以 Manifest 和校验过的二进制的实际字节数覆盖文档中过期的 `byteSize`；`missing` 的附件清除大小。

### 导入检查

以下情况阻止导入：绝对路径、反斜杠、`..`、重复路径或重叠的数据范围、未声明的条目、缺少固定入口、摘要不符、版本高于当前支持的版本。

读取器只接受单卷、未加密、非 ZIP64、不使用数据描述符的 Store / DEFLATE ZIP；项目上限远低于需要 ZIP64 的大小。话卷自身生成的项目文件都符合这一要求，其他工具重新打包时也须遵守。除 Manifest 中文件所需的空父目录外，目录条目一律拒绝。

导入过程：

1. 先只展开 Manifest，拒绝所有未声明的条目。
2. 再按文档和 Manifest 中附件的顺序逐个、分块解压。处理大条目时，压缩输入或实际输出每达到 1 MiB 就让出一次事件循环。
3. 按实际输出（而不是 ZIP 中声明的大小）实时检查 32 / 160 MiB 上限，并核对实际字节数和 CRC-32。伪造的大小既不会让截断的内容通过，也不会导致无限制的解压。
4. 解析、迁移、Schema 和引用校验、导入预览都在内存中完成；用户确认之前不写入 IndexedDB。
5. 确认后，文档和所有可用附件在同一个读写事务中替换；事务失败时由浏览器回滚。

## 浏览器本地存储 v1

数据库名为 `conversation-canvas`，版本为 `1`：

- `projects`：以 `current` 为键，保存当前的 `ConversationDocument`、保存时间和 `storageVersion`。
- `assets`：以 `storageKey` 为键，保存 `bytes: ArrayBuffer`、文件名、MIME、字节数和保存时间。读取时按 MIME 还原 Blob；兼容旧记录的 `blob` 字段，数据库版本不变。

新附件先写入 `assets`，成功后才把 Asset 和 Block 加入文档。原文件已写入、但在提交文档前上传被取消或目标消息已失效时，立即删除该记录。运行时为 Blob 创建 Object URL，刷新或替换项目后重新创建，卸载或替换时释放。已提交的附件从文档中删除后，原文件不立即回收，以便撤销；项目被确认替换时才清理旧的附件。

## 普通 Markdown

没有 Conversation Markdown 版本头的 `.md` 或纯文本文件，导入为：

- 文档标题：文件名去掉 `.md`。
- 一条 `assistant` 消息，显示名称为 `Assistant`。
- 一个内容保持原样的 Markdown Block。
- 网页导入时成图语言使用当前界面语言；命令行导入普通 Markdown 默认中文。

导入时不猜测角色、消息边界、工具调用、图片或附件；需要这些结构时使用 Conversation Markdown v2。

### 正文任务列表

正文使用 `- [ ] 待办` 和 `- [x] 已完成` 表示任务，完成标记也接受大写 `X`；普通项、任务项可混排和嵌套。话卷同时识别尚无文字的 `- [ ]`、`- [x]`，用于保存编辑中的空任务项。需要显示字面方括号时写作 `- \[ ]`。这些标记保存在原有 Markdown `source` 中，不增加文档字段；其他 Markdown 软件对空任务项的显示可能不同。 直接编辑时也可输入 `- []`，会即时转换并保存为标准 `- [ ]`；导入文件或粘贴的 `[]` 仍按普通文字处理。

## Conversation Markdown v1

第一个非空行须为版本头。文档信息最多出现一次，且位于第一条消息之前；每条消息的正文成为一个 Markdown Block。

```md
<!-- conversation-markdown:v1 -->
<!-- document: {"title":"旅行计划","locale":"zh-CN"} -->

<!-- message: {"role":"user","displayName":"周川"} -->
请规划一个两日行程。
<!-- /message -->

<!-- message: {"role":"assistant","displayName":"Atlas","model":"Demo 2.4"} -->
第一天去博物馆，第二天步行游览老城。
<!-- /message -->
```

文档信息只接受 `title`、`subtitle`、`locale`。`locale` 控制成图标签，使用 `en` 或 `zh-CN`，也接受对应地区变体；省略或暂不支持的值按中文显示，原值保留。此规则同样适用于 v2，与网页界面语言无关，且不翻译已有正文或名称。

消息信息只接受：

- `role`：`user | assistant | system | developer | tool | unknown`
- `sourceRole`：`role` 为 `unknown` 时必填
- `displayName`
- `model`
- `status`：`complete | streaming | error | cancelled`

标记须独占一行。代码块中的 `<!-- /message -->` 按普通代码保留，不结束消息。非法 JSON、未知的字段或角色、重复的文档信息、消息之外的正文、缺少结束标记、版本过高，都会使整个文件导入失败，不部分导入。

v1 不表达图片、文件、思考过程、工具调用和暂不支持的内容；这些内容须使用 v2 或 `.convcanvas`。样例见 [`fixtures/import/conversation-v1.md`](../fixtures/import/conversation-v1.md)。

## Conversation Markdown v2

v2 主要供 AI Agent 生成对话文件，在 v1 的基础上增加思考过程、工具记录、图片和文件。它仍然只转换为 Schema v1 的 `ConversationDocument`，不引入新的 Block 类型。网页导入和命令行出图使用同一个解析器（`src/project/markdown-import.ts`）。

```md
<!-- conversation-markdown:v2 -->
<!-- document: {"title":"海边那一集"} -->

<!-- message: {"role":"user","displayName":"周川"} -->
帮我看看这张图
<!-- image: {"src":"./images/beach.png","alt":"海边照片"} -->
<!-- /message -->

<!-- message: {"role":"assistant","model":"Claude Opus 4.5"} -->
<!-- reasoning: {"title":"思考了 12 秒","durationMs":12000} -->
截图中可见的思考内容（Markdown）
<!-- /reasoning -->
<!-- tool-call: {"toolName":"web_search","input":{"query":"进击的巨人 海边"}} -->
<!-- tool-result: {"output":{"results":3}} -->
正文 Markdown……
<!-- file: {"src":"notes.pdf","label":"笔记"} -->
<!-- /message -->
```

### 与 v1 相同的规则

- 第一个非空行是版本头；文档信息最多一次，位于第一条消息之前。
- 所有标记独占一行，JSON 须合法；出现未知字段时整个文件导入失败，不部分导入。
- 代码块中的任何标记都按普通代码保留。
- v1 文件继续按 v1 的规则导入；v1 中出现的 v2 标记只是普通文本。

### 消息

除 v1 的字段外，v2 允许 `timestamp`（带时区的 ISO 8601，例如 `2026-10-04T09:30:00+08:00`）。

### 内容标记

消息内的普通文本按出现顺序成为 Markdown Block，标记把正文分开。每段正文首尾的空行会被去掉，只有空白的段落不生成 Block；整条消息没有内容时，保留一个空的 Markdown Block。

| 标记 | 形式 | 字段 | 默认值 |
| --- | --- | --- | --- |
| `reasoning` | 有正文，以 `<!-- /reasoning -->` 结束；内部不能再放其他标记 | `title`、`summary`、`status`、`durationMs`、`displayState`、`exportState` | 标题“思考过程”、`neutral`、`collapsed`、`current` |
| `tool-call` | 单行 | `toolName`（必填）、`callId`、`summary`、`input`、`status`、`durationMs`、`displayState`、`exportState` | 自动生成 `callId`、`input: {}`、`neutral`、`collapsed`、`current` |
| `tool-result` | 单行 | `callId`、`summary`、`output`、`status`、`durationMs`、`displayState`、`exportState` | 对应文档中最近的一个工具调用、`output: {}`、`success`、`collapsed`、`current` |
| `image` | 单行 | `src`（必填）、`alt`、`caption`、`width`（`small \| medium \| full`） | `alt` 为文件名，`width: full` |
| `file` | 单行 | `src`（必填）、`label` | `label` 为文件名 |

默认值与网页中新建同类 Block 时相同。`status` 取 `neutral | pending | running | success | error`，`durationMs` 为非负的毫秒数。

### 本地文件引用

- `src` 只接受相对于 Markdown 文件的路径，使用 `/` 分隔。网址、`data:`、绝对路径、`~`、反斜杠，以及经 `..` 越出 Markdown 所在目录的路径都会被拒绝。
- 图片格式限于 `png`、`jpg` / `jpeg`、`gif`、`webp`、`svg`、`avif`。文件按扩展名推断 MIME，无法识别时为 `application/octet-stream`。
- 同一路径被同类标记多次引用时，只建立一个 Asset。
- 单个文件的上限同样为 32 MiB。读取文件、记录大小和图片尺寸由调用方（命令行出图）完成，解析器本身不访问文件系统。
- 浏览器无法读取本地的相对路径，因此网页导入含 `src` 的 v2 文件时会拒绝，并提示先用命令行出图加 `--project` 生成 `.convcanvas` 再导入。不含本地文件的 v2 文件可以直接在网页中导入。

### 确定性与报错

- 命令行按出现顺序生成 ID，同一输入得到相同的文档。
- 标记错误的位置写作 `line:行号.字段`。文档校验错误（例如重复的 `callId`）会换算回对应 Block 所在的行，写作 `line:行号 (原路径)`。

样例见 [`fixtures/conversation-v2.md`](../fixtures/conversation-v2.md)，其中引用了 `fixtures/assets/` 下的图片和附件。
