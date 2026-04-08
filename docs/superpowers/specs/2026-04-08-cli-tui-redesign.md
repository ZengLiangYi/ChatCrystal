# CLI TUI 交互增强设计

> 日期: 2026-04-08
> 状态: 已批准
> 方案: B — 共享交互组件 + 命令间跳转

## 背景

ChatCrystal CLI (`crystal`) 当前使用 Ink 渲染终端 UI，但交互体验差：列表命令输出后直接退出，翻页需手动传 `--page` 参数，无键盘导航，无帮助提示。用户的主要操作是**浏览和检索**知识笔记，需要流畅的交互体验。

### 设计原则

- **交互增强型 CLI，不做全 TUI** — Electron/Web 是主力浏览界面，CLI 不复刻它
- **搜索是一等公民** — 语义搜索是 ChatCrystal 的差异化能力
- **方向键优先** — 上下左右箭头是直觉操作，vim 键 (j/k) 作为可选别名
- **非交互模式保留** — 管道、MCP、`--json` 场景保持纯文本/JSON 输出
- **性能优先** — 支持万条级别笔记的流畅浏览

## 一、交互组件体系

构建 4 个核心 Ink 组件，所有命令复用。

### 1.1 `<InteractiveList>` — 通用交互列表

```typescript
interface InteractiveListProps<T> {
  items: T[]
  columns: ColumnDef[]        // 列定义（字段、宽度、对齐）
  fetchPage: (page: number) => Promise<T[]>  // 按需加载分页
  total: number               // 总条数
  pageSize?: number           // 每页条数，默认 20
  onSelect: (item: T) => void // Enter 回调
  onSearch?: () => void       // / 键回调
  renderPreview?: (item: T) => React.ReactNode // 预览渲染
}
```

功能：
- **上/下箭头**移动光标，高亮当前行（反色）
- **懒加载分页**：滚动到底部自动加载下一页，已加载数据保持在内存
- **内联预览**：当前选中项下方展示 2-3 行摘要（窄终端 <120 列）
- **双栏预览**：终端宽度 ≥120 列时自动切换为左列表 + 右预览布局
- **Home/End** 跳到首/末条
- j/k 作为方向键别名（不显示在提示中）

### 1.2 `<DetailView>` — 全屏详情

```typescript
interface DetailViewProps {
  content: NoteDetail          // 笔记完整数据
  onBack: () => void           // Esc/q 返回
  onPrev?: () => void          // ← 上一条
  onNext?: () => void          // → 下一条
  position?: string            // 如 "2/243" 显示在状态栏
}
```

功能：
- 全屏渲染：标题、标签、创建时间、摘要、关键结论、代码片段
- Markdown 格式化渲染
- **上/下箭头**滚动长内容
- **←/→** 直接切换上一条/下一条，不需要返回列表
- 底部关联笔记区域（来自 relations API）

### 1.3 `<SearchBar>` — 搜索输入

```typescript
interface SearchBarProps {
  onSubmit: (query: string) => void  // Enter 确认搜索
  onCancel: () => void               // Esc 取消
  placeholder?: string
}
```

功能：
- **Enter 触发搜索**（语义搜索需要 embedding 计算，不适合即时过滤）
- **Esc** 取消回到列表
- 搜索历史：**上/下箭头**翻看之前的搜索词

### 1.4 `<StatusBar>` — 底栏提示

```typescript
interface StatusBarProps {
  hints: Array<{ key: string; label: string }>  // 快捷键提示
  info?: string                                  // 左侧信息如 "2/243"
}
```

功能：
- 固定在终端底部
- 左侧：上下文信息（页码、结果数）
- 右侧：当前视图的快捷键提示
- 根据当前视图自动切换提示内容

## 二、命令交互流程

### 2.1 交互模式检测

进入交互模式的条件（三个全部满足）：
1. stdout 是 TTY（非管道）
2. 未传 `--json` 参数
3. 未传 `--no-interactive` 参数

否则走原有的纯文本/JSON 输出，保证管道和 MCP 兼容性。

### 2.2 命令交互能力矩阵

| 命令 | 交互模式 | 非交互模式 |
|------|---------|-----------|
| `notes list` | InteractiveList → DetailView | 原有表格输出 |
| `notes get <id>` | DetailView（支持 ←/→） | 原有文本输出 |
| `notes relations <id>` | InteractiveList → DetailView | 原有表格输出 |
| `search <query>` | InteractiveList → DetailView | 原有表格输出 |
| `conversations` | InteractiveList → 跳转对应笔记 | 原有表格输出 |
| `tags` | InteractiveList → 该标签的笔记列表 | 原有表格输出 |
| `import` | 保持现有 ImportPanel | 保持不变 |
| `summarize` | 保持现有 SummarizePanel | 保持不变 |
| `config/serve/status/mcp` | 不变 | 不变 |

### 2.3 视图栈与命令间跳转

用一个简单的视图栈管理返回路径：

```
notes list:
  ├─ Enter → push DetailView（笔记详情）
  │    ├─ Esc → pop 返回列表（恢复光标位置）
  │    └─ ←/→ → 上一条/下一条
  ├─ / → push SearchBar
  │    └─ Enter → push SearchResultList
  │         ├─ Enter → push DetailView
  │         └─ Esc → pop 逐级返回
  └─ q → 退出

tags:
  └─ Enter → push 该标签下的 notes list（完整交互）
       └─ Esc → pop 返回 tags 列表

conversations:
  └─ Enter → 有对应笔记则 push DetailView，无则提示"未总结，按 s 立即总结"

notes relations <id>:
  └─ Enter → push 关联笔记的 DetailView
       └─ Esc → pop 返回 relations 列表
```

## 三、布局与视觉

### 3.1 自适应布局

**窄终端（<120 列）— 内联预览模式：**

```
┌──────────────────────────────────────────┐
│ 📋 笔记 (243)                    /:搜索  │
├──────────────────────────────────────────┤
│   API 缓存策略          #api  2025-01-15 │
│ ▸ 数据库迁移方案      #mysql  2025-01-14 │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ 讨论了从 MySQL 5.7 迁移到 8.0 的方案，    │
│ 重点关注 JSON 字段兼容性和索引重建策略...  │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│   React 状态管理        #react 2025-01-13 │
│   Docker 部署优化      #devops 2025-01-12 │
├──────────────────────────────────────────┤
│ 2/243  ↑↓:移动 Enter:查看 /:搜索 q:退出  │
└──────────────────────────────────────────┘
```

**宽终端（≥120 列）— 双栏预览模式：**

```
┌──────────────────────┬─────────────────────────┐
│ 📋 笔记 (243)        │ 数据库迁移方案           │
├──────────────────────┤ 标签: #mysql #migration  │
│   API 缓存策略        │ 创建: 2025-01-14        │
│ ▸ 数据库迁移方案      │─────────────────────────│
│   React 状态管理      │ 讨论了从 MySQL 5.7 迁移  │
│   Docker 部署优化     │ 到 8.0 的方案，重点关注   │
│   WebSocket 长连接    │ JSON 字段兼容性和索引重建 │
│   Git 工作流规范      │ 策略。                   │
│   ...                │                         │
│                      │ 关键结论:                │
│                      │ 1. 先升级测试环境...      │
│                      │ 2. JSON 字段需要...       │
├──────────────────────┴─────────────────────────┤
│ 2/243  ↑↓:移动 Enter:全屏 /:搜索 q:退出        │
└────────────────────────────────────────────────┘
```

### 3.2 全屏详情视图

```
┌────────────────────────────────────────────────┐
│ 数据库迁移方案                                   │
│ 标签: #mysql #migration   创建: 2025-01-14      │
│────────────────────────────────────────────────│
│                                                │
│ ## 摘要                                        │
│ 讨论了从 MySQL 5.7 迁移到 8.0 的完整方案...      │
│                                                │
│ ## 关键结论                                     │
│ 1. JSON 字段兼容性：需要将 TEXT+JSON_EXTRACT     │
│    迁移为原生 JSON 类型...                       │
│ 2. 索引重建策略：使用 pt-online-schema-change... │
│                                                │
│ ## 代码片段                                     │
│ ```sql                                         │
│ ALTER TABLE users ADD COLUMN meta JSON...       │
│ ```                                            │
│                                                │
│ ## 关联笔记                                     │
│ → MySQL 性能优化  → Docker 部署优化              │
│                                                │
├────────────────────────────────────────────────┤
│ [2/243] Esc:返回  ←/→:上/下一条  ↑↓:滚动       │
└────────────────────────────────────────────────┘
```

### 3.3 搜索视图

```
┌──────────────────────────────────────────┐
│ 🔍 搜索: █                               │
│ (Enter 确认，Esc 取消)                    │
├──────────────────────────────────────────┤
│                                          │
│   （搜索中显示 spinner）                   │
│   （结果出来后切换为 InteractiveList）      │
│                                          │
├──────────────────────────────────────────┤
│ 找到 15 条结果                            │
└──────────────────────────────────────────┘
```

### 3.4 视觉风格

| 元素 | 样式 |
|------|------|
| 高亮行（当前选中） | 反色（白底黑字） |
| 标签 | cyan 色 `#tag` |
| 分隔线 | dim 灰色虚线 |
| 标题栏 | bold 白色 |
| 状态栏 | dim 背景 + bold 键名 |
| 预览区文字 | dim 灰色 |
| 搜索匹配高亮 | yellow bold |

## 四、国际化 (i18n)

轻量级 locale 对象方案，不引入 i18n 框架。

### 4.1 结构

```typescript
// ui/locale/zh.ts
export default {
  notesTitle: '📋 笔记',
  searchPlaceholder: '搜索...',
  hints: {
    move: '↑↓:移动',
    open: 'Enter:查看',
    search: '/:搜索',
    quit: 'q:退出',
    back: 'Esc:返回',
    scroll: '↑↓:滚动',
    prevNext: '←/→:上/下一条',
    fullscreen: 'Enter:全屏',
    retry: 'r:重试',
  },
  searchResult: (n: number) => `找到 ${n} 条结果`,
  pageInfo: (cur: number, total: number) => `${cur}/${total}`,
  noNotes: '还没有笔记',
  noNotesHint: '运行 crystal import 导入对话，然后 crystal summarize --all 生成',
  noResults: '未找到匹配结果，试试其他关键词',
  notSummarized: '该对话尚未总结',
  serverStarting: '正在启动服务器...',
  loadFailed: '加载失败',
  searchConfirm: 'Enter 确认',
  searchCancel: 'Esc 取消',
}

// ui/locale/en.ts
export default {
  notesTitle: '📋 Notes',
  searchPlaceholder: 'Search...',
  hints: {
    move: '↑↓:Move',
    open: 'Enter:Open',
    search: '/:Search',
    quit: 'q:Quit',
    back: 'Esc:Back',
    scroll: '↑↓:Scroll',
    prevNext: '←/→:Prev/Next',
    fullscreen: 'Enter:Fullscreen',
    retry: 'r:Retry',
  },
  searchResult: (n: number) => `Found ${n} results`,
  pageInfo: (cur: number, total: number) => `${cur}/${total}`,
  noNotes: 'No notes yet',
  noNotesHint: 'Run crystal import to import conversations, then crystal summarize --all',
  noResults: 'No matches found, try different keywords',
  notSummarized: 'This conversation has not been summarized',
  serverStarting: 'Starting server...',
  loadFailed: 'Failed to load',
  searchConfirm: 'Enter to confirm',
  searchCancel: 'Esc to cancel',
}
```

### 4.2 语言检测优先级

1. `crystal config` 中的 `locale` 设置
2. 环境变量 `LANG`（如 `zh_CN.UTF-8` → `zh`）
3. 默认 `en`

### 4.3 CJK 宽度处理

中文提示比英文宽（如 "↑↓:移动" vs "↑↓:Move"），StatusBar 使用字符显示宽度（非 `.length`）计算布局。复用项目已有的 CJK 双宽字符对齐逻辑（`formatter.ts`）。

## 五、数据加载与性能

### 5.1 分页策略

采用"offset/limit + 懒加载"模式：

1. **首次加载**：请求第 1 页（20 条）+ total 总数
2. **滚动到底部**：自动请求下一页，追加到列表
3. **已加载数据**保持在内存，不重复请求
4. **视图栈返回时**：恢复已加载数据和光标位置，不重新请求

当前 API 使用 offset/limit 分页，SQLite 对 offset 性能在万条级别没有问题，无需改为游标分页。

### 5.2 请求取消

- **搜索**：新搜索发起时，AbortController 取消前一个未完成请求
- **翻页**：快速滚动时 debounce 200ms 后触发加载
- **视图切换**：离开当前视图时取消进行中请求

### 5.3 预览数据复用

```
列表 API → { id, title, summary, tags, createdAt }  → 列表 + 内联预览（无额外请求）
详情 API → { ...完整字段 }                           → 全屏详情（按需加载）
关联 API → { relatedNotes[] }                        → 详情底部关联区域（按需加载）
```

### 5.4 渲染性能

- **Viewport clipping**：InteractiveList 只渲染可视区域的行，不渲染屏幕外数据
- **最小化重绘**：光标移动只更新变化的行，利用 Ink 的 React reconciliation
- **预览区 key**：`key={selectedId}` 避免无效 diff
- **宽度检测**：仅在 resize 事件时重新计算，不在每次渲染时检测

## 六、错误处理与边界情况

### 6.1 服务器未启动

交互模式保持现有自动启动逻辑：首次请求连接失败时显示 spinner "正在启动服务器..."，成功后自动加载数据。启动失败则显示错误信息 + 退出。

### 6.2 空状态

- **笔记为 0 条**：显示引导文案（"运行 crystal import 导入对话"）
- **搜索无结果**：显示 "未找到匹配结果，试试其他关键词"
- **对话未总结**：conversations 列表选中后提示 "该对话尚未总结，按 s 立即总结"，按 s 触发 summarize 并显示 SummarizePanel

### 6.3 终端尺寸

- **最小宽度**：60 列，低于此值显示警告
- **最小高度**：10 行，低于此值退回非交互模式
- **resize 事件**：自动重新计算布局，120 列阈值触发双栏/单栏切换

### 6.4 网络/API 错误

- **加载失败**：列表区域显示错误信息 + "按 r 重试"
- **搜索失败**：SearchBar 下方显示错误，不清空搜索词
- **翻页失败**：保留已加载数据，底部显示 "加载失败，按 r 重试"

## 七、文件结构

```
server/src/cli/ui/
├── components/
│   ├── InteractiveList.tsx    // 通用交互列表（新增）
│   ├── DetailView.tsx         // 全屏详情（新增）
│   ├── SearchBar.tsx          // 搜索输入（新增）
│   ├── StatusBar.tsx          // 底栏提示（新增）
│   ├── Spinner.tsx            // 保持不变
│   ├── ProgressBar.tsx        // 保持不变
│   └── TaskList.tsx           // 保持不变
├── hooks/
│   ├── useKeyboard.ts         // 键盘事件统一处理（新增）
│   ├── useViewStack.ts        // 视图栈管理（新增）
│   ├── usePagination.ts       // 懒加载分页逻辑（新增）
│   └── useTerminalSize.ts     // 终端尺寸检测 + 自适应（新增）
├── locale/
│   ├── index.ts               // 语言检测 + locale 加载（新增）
│   ├── zh.ts                  // 中文（新增）
│   └── en.ts                  // 英文（新增）
├── views/
│   ├── NotesListView.tsx      // notes list 交互视图（新增）
│   ├── NoteDetailView.tsx     // notes get 交互视图（新增）
│   ├── SearchView.tsx         // search 交互视图（新增）
│   ├── ConversationsView.tsx  // conversations 交互视图（新增）
│   ├── TagsView.tsx           // tags 交互视图（新增）
│   └── RelationsView.tsx      // notes relations 交互视图（新增）
├── ImportPanel.tsx             // 保持不变
└── SummarizePanel.tsx          // 保持不变
```

新增文件约 18 个（4 组件 + 4 hooks + 3 locale + 6 views + 1 入口），不修改现有 Ink 组件。
