# ConversationDocument Schema v1

`ConversationDocument` 是编辑、导入、预览、保存和导出的唯一数据源。新文档使用整数 `schemaVersion: 1`。

- 机器可读定义：[`schemas/conversation-document.schema.json`](../schemas/conversation-document.schema.json)
- 历史 v0 定义：[`schemas/conversation-document.v0.schema.json`](../schemas/conversation-document.v0.schema.json)
- 运行时校验与迁移：[`src/data/document-loader.ts`](../src/data/document-loader.ts)

两份 JSON Schema 均为 Draft 2020-12。v1 遇到未声明的字段时报错，不通过删除字段来“修复”输入。

## 顶层结构

```text
ConversationDocument
├── schemaVersion: 1
├── id
├── metadata
├── canvas
├── theme
├── messages[]
└── assets[]
```

- Document、Message、Block 和 Asset 都有稳定的 ID；排序、修改内容和展开 / 收起不得重新生成 ID。
- `messages[]` 是有序的独立消息，不强制 User 与 Assistant 成对。
- `metadata.createdAt`、`metadata.updatedAt` 和 Message 的 `timestamp` 须为带时区的 ISO 8601 date-time；`updatedAt` 不得早于 `createdAt`。
- `metadata.locale` 控制成图标签，`en` 及 `en-*` 使用英文，`zh` 及其地区变体使用简体中文；缺失或暂不支持的值回退中文，原值保留。界面语言独立保存于浏览器，不属于文档。修改成图语言不翻译已有正文、标题、名称或附件。
- `theme.id` 引用稳定的主题标识，目前唯一的正式值为 `warm-editorial-v1`。
- 空文档和编辑中的空 Message 可以使用空数组。

## Canvas

只接受以下两种组合：

| preset | CSS 宽度 | 导出倍率 | 像素宽度 |
| --- | ---: | ---: | ---: |
| `portrait` | 480 | 3 | 1440 |
| `wide` | 720 | 2 | 1440 |

默认为 Portrait。Wide 是单次导出的选项，不改写项目的默认画布。

## Message

| 字段 | 必填 | 含义 |
| --- | :---: | --- |
| `id` | 是 | 稳定的 Message ID |
| `role` | 是 | `user \| assistant \| system \| developer \| tool \| unknown` |
| `blocks[]` | 是 | 有序的内容 Block |
| `sourceRole` | | 来源中的原始角色；`role` 为 `unknown` 时必填 |
| `displayName` / `model` | | 显示名称和模型标注 |
| `avatarAssetId` | | 须指向 `kind: image` 的 Asset |
| `timestamp` | | 带时区的 ISO date-time |
| `status` | | `complete \| streaming \| error \| cancelled` |

Message 的 `status` 只描述消息的交付状态，与思考过程、工具调用的执行状态无关。

## Block

| `type` | 用途 | 主要数据 |
| --- | --- | --- |
| `markdown` | 正文 | Markdown `source`，不执行任意 HTML |
| `image` | 正文图片 | `assetId`、替代文字、说明、宽度 `small \| medium \| full` |
| `file` | 非图片附件 | `assetId`、可选的显示名称 |
| `reasoning` | 用户提供的思考过程或摘要 | Markdown 内容、执行状态、时长、显示与导出状态 |
| `toolCall` | 工具调用 | `callId`、工具名、JSON 输入、执行状态 |
| `toolResult` | 工具结果 | `callId`、JSON 输出、执行状态 |
| `unsupported` | 已识别但暂不支持的内容 | 原始类型、原因和完整的 JSON `raw` |

思考过程和工具记录使用两个独立的字段：

- `displayState: collapsed | expanded`：预览中的展开状态。在编辑界面点画布上的箭头会写回文档，可以撤销。
- `exportState: current | collapsed | expanded`：逐块的导出方式，编辑界面不提供修改入口，来自导入的数据或旧项目。文档中有不是 `current` 的值时，网页导出默认按每一块的设置，否则默认按当前看到的样子；命令行默认按每一块的设置。本次导出的全局设置可以覆盖它；导出结束或取消后恢复预览状态，不修改文档。

`toolCall` 与 `toolResult` 通过 `callId` 关联，各自保留独立的 Block ID。工具结果的工具名从文档中对应的调用解析，不重复存储。`input`、`output` 和 `unsupported.raw` 只接受合法的 JSON 值，按原样保留，不执行其中的内容。

运行时限制这些 JSON 值的容器嵌套最多 128 层，分别从 `input`、`output`、`raw` 的第一个对象或数组计数。超限返回 `JSON_DEPTH_EXCEEDED`，拒绝导入或保存并保留原输入，不截断数据。此限制保护浏览器的校验、序列化和渲染，不改变 Schema v1 的字段结构。

## Asset

Block 中不保存临时 Object URL、远程 URL 或二进制内容，只保存 `assetId`。`assets[]` 保存附件信息和本地来源：

- `source.kind: fixture`：仅用于仓库内的测试资源，路径限制在 `fixtures/assets/` 下。
- `source.kind: local`：记录本地存储中的 `storageKey`，原文件保存在浏览器 IndexedDB 的 `assets` 中。

`image` Block 和头像只能引用图片类 Asset，`file` Block 只能引用文件类 Asset。运行时由 Blob 重建的 Object URL 不写回文档；解析失败时显示固定的替代内容，不修改文档。

## 本地存储和项目文件

- 浏览器中的当前项目保存在 IndexedDB：`projects` 存文档和保存时间，`assets` 存原文件和附件信息。
- 导入导出不改变 Schema。`.convcanvas` 中的 `document.json` 是完整的 `ConversationDocument`，附件来源统一写为 `asset:<assetId>`，导入后再映射为当前浏览器中新的 `storageKey`。
- `manifest.json` 使用独立的 `packageVersion`，IndexedDB 使用独立的 `storageVersion`，二者都不复用 `schemaVersion`。
- 项目文件格式、校验和、安全上限和 Conversation Markdown 见 [`PROJECT_FORMAT.md`](./PROJECT_FORMAT.md)。

## 校验、迁移与恢复

加载顺序：

```text
读取原始 JSON
→ 识别 schemaVersion
→ 复制后按版本迁移
→ 按 v1 校验结构和取值
→ 校验 ID、附件、头像、工具调用和时间之间的关系
→ 全部通过后才交给渲染或项目状态
```

- `migrateConversationDocumentV0` 只接受 v0：先深复制全部 JSON，把版本改为 `1`，再经过同一个 v1 校验；不修改原输入。
- v1 校验检查未知字段、ID 重复、附件类型、头像引用、重复或找不到对应调用的工具记录、时间格式和先后顺序。时间必须是有效公历日期；不存在的日期和 `24:00` 不自动换算为下一日。
- 遇到更高的版本、损坏的 JSON 或校验失败时，返回带路径的错误和未修改的原数据，不当作空文档处理。
- `serializeConversationDocument` 输出格式固定的 JSON；`restoreConversationDocument` 解析后同样须经过 v1 校验。序列化再恢复后与原文档完全一致，包括工具的 JSON 内容和 `unsupported.raw`。

## 未知内容

Schema 不直接接受任意未知的 Block `type`。外部 Adapter 或迁移程序应把已识别但不支持的结构转换为 `unsupported`，并把未改动的原始数据放入 `raw`，用于查看、保存和恢复。

`raw` 是不透明的数据。导入导出时，不得把恰好像文件名、`storageKey` 或测试路径的字符串当作引用并改写。保留附件时只识别精确的 Asset ID 和 `asset:<assetId>`；同一个标记匹配多个 Asset 时导出失败。其他引用方式须由带版本的字段或 Adapter 定义。
