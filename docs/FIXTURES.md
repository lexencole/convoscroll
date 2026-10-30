# 示例与测试数据

`fixtures/` 下的数据是渲染、导出、导入和容错的共同测试输入，也提供网页上的默认示例。内容全部虚构，资源都在仓库内，不包含真实对话、密钥或远程依赖。

测试数据使用稳定 ID 和固定的时间、名称、模型、资源路径；正常数据符合 Schema v1，异常数据须注明预期失败点。

## 文件

| 文件 | 用途 | 校验结果 |
| --- | --- | --- |
| `story.fixture.json` | 故事示例：多轮对话与常用富内容 | 通过 |
| `basic.fixture.json` | 简洁示例：最小的正常对话，中文界面首次打开时显示 | 通过 |
| `basic-en.fixture.json` | 英文简洁示例，英文界面首次打开或主动载入时显示 | 通过 |
| `story-en.fixture.json` | 对应的英文故事，英文界面主动载入时显示 | 通过 |
| `rich.fixture.json` | 覆盖所有 Block 类型、状态和失败情形（仅开发环境） | 通过 |
| `long.fixture.json` | 长文本、多轮消息和长图高度的压力测试（仅开发环境） | 通过 |
| `broken.fixture.json` | 未知版本和字段、重复 ID、错误的时间、状态和资源引用 | 失败（有意） |
| `conversation-v2.md` | Conversation Markdown v2 样例，引用 `assets/` 中的图片和附件 | — |
| `import/conversation-v1.md` | Conversation Markdown v1 样例 | — |

`broken.fixture.json` 的 JSON 语法本身合法，只是有意违反 Schema。语法损坏的 JSON 作为字符串样例放在导入测试中。

网页正式版只提供 Story 和 Basic；Rich 和 Long 只在开发环境的文档菜单中出现，名称为“测试：所有内容类型”和“测试：超长对话”。

## 覆盖范围

| 场景 | Basic | Rich | Long | Broken |
| --- | :---: | :---: | :---: | :---: |
| User / Assistant | ✓ | ✓ | ✓ | ✓ |
| System / Developer / Tool 角色 | | ✓ | | ✓ |
| 中英文混排 | ✓ | ✓ | ✓ | ✓ |
| 多级标题、段落、强调 | | ✓ | ✓ | ✓ |
| 有序 / 无序 / 任务列表 | | ✓ | ✓ | |
| 引用与链接 | | ✓ | | ✓ |
| 行内代码与代码块 | | ✓ | ✓ | ✓ |
| 超长代码行 | | ✓ | | |
| 行内公式与块级公式 | | ✓ | ✓ | |
| 表格与宽表格 | | ✓ | ✓ | |
| 本地图片与图注 | | ✓ | ✓ | 错误引用 |
| 非图片文件 | | ✓ | | |
| 思考过程展开 / 收起 | | ✓ | | |
| 工具调用成功 / 失败 | | ✓ | | ✓ |
| 工具结果 | | ✓ | | |
| 暂不支持的内容 | | ✓ | | 未知的原始类型 |
| 消息头像 / 时间 / 状态 | | ✓ | | 错误的时间、状态、头像 |
| 图片 small / medium / full | | ✓ | | 错误引用 |
| 图片来源无法解析 | | ✓ | | 未登记的附件 |
| 大量消息 / 很高的画布 | | | ✓ | |
| 缺少必填字段 | | | | ✓ |

## 各份数据

### Story（故事示例）

《慢性复活可行性研究》：围绕昼夜作息的示例对话，用户为 Levi，AI 为 Claude。共 8 条消息、14 个 Block：9 个 Markdown、1 张图片、1 个文件、1 段思考过程、1 次工具调用及其结果。

“载入故事示例”会替换当前画布，可通过撤销恢复。示例覆盖常用 Markdown 格式、代码、公式、表格和附件；思考过程和工具调用为固定演示数据，不执行实际工具。

英文故事 `story-en.fixture.json` 为《Slow Resurrection: A Feasibility Study》，包含相同的消息、格式、数值，以及英文图表和 CSV。

### Basic（简洁示例）

《剩饭放了一夜》：一问一答两条消息，用户为 Levi，AI 为 Claude，不带时间和状态。中文界面首次打开且没有已有项目时显示，用于检查基本编辑、保存与导出。

英文版 `basic-en.fixture.json` 为《Rice left out overnight》，与中文简洁示例内容对应；ID、语言和正文独立保存。切换界面不自动替换已打开的示例。

### Rich

Rich 共 10 条消息、24 个 Block，覆盖全部内容类型和多种执行状态，详见上表；嵌套 `raw` 用于检查项目往返是否保留原数据。

### Long

用于检查布局高度、滚动和导出内存。共 25 条消息、33 个 Block，同时包含短问题、长回答、列表、代码、公式、9 列宽表格和 3 张图片，其中至少一条是很长的 Assistant 回答。3× 导出时分为两张。

### Broken

包含以下有意构造的错误：

- 缺少文档或 Message 的必填字段。
- 重复或为空的 Message ID。
- 未登记的 `assetId` 和错误的头像类型。
- 未知的原始 `type` 和未知字段。
- 错误的消息时间和状态、错误的执行状态、不合理的时长、重复的工具 Call ID。

`python3 scripts/validate-project.py` 和运行时校验都应查出 7 类结构错误和 4 类引用错误，每个错误对应带路径的诊断。

## 资源

`fixtures/assets/` 中的资源由本项目制作，通过 Asset 引用。

- `sleep-shift.svg`：Story 的睡眠时段图，数据一致性由 `src/data/story-sleep-chart.test.ts` 检查。
- `sleep-week.csv`：Story 的作息记录附件。
- `sleep-shift-en.svg`、`sleep-week-en.csv`：对应的英文图表和作息记录，数值与中文版一致。
- `sea-horizon.svg`、`sea-character-notes.md`：`conversation-v2.md` 与 CLI 测试使用的资源，也用于恢复引用这些路径的已有项目。地平线示意图的几何关系由 `src/data/sea-horizon-diagram.test.ts` 检查。
- `sample-landscape.svg`：Long 和 Broken 使用的横向示例图。
- `spoiler-free-watch-poster.svg`、`lin-an-avatar.svg`：只用于 Rich。
- `sea-character-notes.csv`、`sample-avatar.svg`：当前的示例不再引用，保留在资源映射中，以便早期保存的项目仍能显示。

模型图标的 SVG 来源和 MIT 许可见 `src/models/vendor/README.md`。

## 表格的限制

Markdown 表格使用等分列宽和单元格内换行。列很多或单元格文字很长时，即使没有横向溢出也可能难以阅读；更高的导出倍率只提高像素密度，不增加排版空间，Wide 720px 只提供更宽的单次导出画布。

导出只在完整的消息或 Block 之间分段，单个 Markdown Block 中的长表不会按行分页；超过单段的安全高度时会阻止导出，提示用户拆分或降低倍率。Rich 的 7 列和 Long 的 9 列压力表用于检查窄列换行与内容完整性。

## 校验

结构与跨引用校验见 [SCHEMA.md](SCHEMA.md#校验迁移与恢复)，文件、图片和总量上限见 [PROJECT_FORMAT.md](PROJECT_FORMAT.md)。

## 常见代码语言

`syntax/samples.json` 是 29 种常见语言的无隐私代码片段，覆盖中文、emoji 和 HTML 内嵌脚本/样式。真实 Shiki 测试使用同一组片段，浏览器检查脚本 `scripts/check-code-languages.mjs` 由此生成临时 Conversation Markdown，检查编辑、语言切换与撤销、纯文本回退及网页/CLI PNG 一致性；生成文件留在 `output/`。支持语言与别名统一在 `src/renderer/code-languages.ts` 维护。
