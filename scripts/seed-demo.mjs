#!/usr/bin/env node
/**
 * seed-demo.mjs — 生成演示数据库 data-demo/chatcrystal.db
 *
 * 用法:
 *   node scripts/seed-demo.mjs
 *   DATA_DIR=data-demo npm run dev
 */

import initSqlJs from 'sql.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'data-demo');
const DB_PATH = resolve(OUT_DIR, 'chatcrystal.db');

// ── Schema (copied from server/src/db/schema.ts) ───────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, slug TEXT, source TEXT NOT NULL DEFAULT 'claude-code',
  project_dir TEXT NOT NULL, project_name TEXT NOT NULL, cwd TEXT, git_branch TEXT,
  message_count INTEGER DEFAULT 0, first_message_at TEXT NOT NULL, last_message_at TEXT NOT NULL,
  file_path TEXT NOT NULL, file_size INTEGER, file_mtime TEXT,
  status TEXT DEFAULT 'imported',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, parent_uuid TEXT,
  type TEXT NOT NULL, role TEXT, content TEXT NOT NULL,
  has_tool_use INTEGER DEFAULT 0, has_code INTEGER DEFAULT 0, thinking TEXT,
  timestamp TEXT NOT NULL, sort_order INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL, summary TEXT NOT NULL, key_conclusions TEXT, code_snippets TEXT,
  raw_llm_response TEXT, is_edited INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0, chunk_text TEXT NOT NULL, vectra_id TEXT,
  created_at TEXT DEFAULT (datetime('now')), UNIQUE(note_id, chunk_index),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL,
  status TEXT NOT NULL, message TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS note_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_note_id INTEGER NOT NULL,
  target_note_id INTEGER NOT NULL, relation_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0, description TEXT, created_by TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_note_id, target_note_id, relation_type),
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_dir);
CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_note ON embeddings(note_id);
CREATE INDEX IF NOT EXISTS idx_note_relations_source ON note_relations(source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_relations_target ON note_relations(target_note_id);
`;

// ── Helpers ─────────────────────────────────────────────────────────────
const uid = () => randomUUID();
const ts = (daysAgo, hoursAgo = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

// ── Demo conversations ──────────────────────────────────────────────────
const conversations = [
  // ── stellar-ui (claude-code) ──
  {
    id: uid(), slug: 'stellar-ui-theme-system',
    source: 'claude-code', project_dir: '/home/dev/stellar-ui', project_name: 'stellar-ui',
    cwd: '/home/dev/stellar-ui', git_branch: 'feat/theme',
    first_message_at: ts(14, 3), last_message_at: ts(14, 1),
    file_path: '~/.claude/projects/stellar-ui/theme-system.jsonl',
    file_size: 28400, file_mtime: ts(14, 1), status: 'summarized',
    messages: [
      { type: 'user', content: '帮我设计一个 React 主题系统，要求支持暗色/亮色模式切换，使用 CSS 变量注入，组件不需要重新渲染就能切换主题。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '好的，我来设计一个基于 CSS 变量的主题系统。核心思路是：\n\n1. **ThemeProvider** — 在 `<html>` 上设置 `data-theme` 属性\n2. **CSS 变量** — 每个主题定义一组 `--color-*` 变量\n3. **useTheme hook** — 提供切换接口\n\n这样组件只引用 CSS 变量，切换时只改 DOM 属性，无需 React re-render。\n\n```typescript\n// theme-provider.tsx\ninterface Theme {\n  name: string;\n  colors: Record<string, string>;\n}\n\nconst ThemeContext = createContext<{\n  theme: string;\n  setTheme: (name: string) => void;\n}>(null!);\n\nexport function ThemeProvider({ children, themes }: Props) {\n  const [theme, setTheme] = useState(\'light\');\n\n  useEffect(() => {\n    const root = document.documentElement;\n    root.setAttribute(\'data-theme\', theme);\n    const vars = themes[theme].colors;\n    for (const [key, value] of Object.entries(vars)) {\n      root.style.setProperty(`--color-${key}`, value);\n    }\n  }, [theme, themes]);\n\n  return (\n    <ThemeContext.Provider value={{ theme, setTheme }}>\n      {children}\n    </ThemeContext.Provider>\n  );\n}\n```', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '不错，但我想要主题持久化到 localStorage，并且首次加载时避免闪烁（FOUC）。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '解决 FOUC 的关键是在 React hydrate 之前就注入主题。方案：\n\n**阻塞脚本注入（放在 `<head>` 中）：**\n\n```html\n<script>\n  (function() {\n    var theme = localStorage.getItem(\'theme\') || \'light\';\n    document.documentElement.setAttribute(\'data-theme\', theme);\n  })();\n</script>\n```\n\n**ThemeProvider 增加 localStorage 同步：**\n\n```typescript\nconst [theme, setTheme] = useState(() => {\n  return localStorage.getItem(\'theme\') || \'light\';\n});\n\nuseEffect(() => {\n  localStorage.setItem(\'theme\', theme);\n}, [theme]);\n```\n\n这样页面加载时：\n1. `<head>` 中的脚本立即设置 `data-theme`，CSS 变量生效 → 无闪烁\n2. React hydrate 后 ThemeProvider 从 localStorage 读取，保持一致', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '完美，请帮我把完整的 ThemeProvider 写到 src/providers/theme.tsx。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '我来读取当前文件结构，然后写入完整实现。', has_code: 0, has_tool_use: 1 },
    ],
    note: {
      title: 'React 主题系统设计：CSS 变量 + 无闪烁切换',
      summary: '设计了一个基于 CSS 变量的 React 主题系统。通过 `ThemeProvider` 在 `<html>` 元素上注入 `data-theme` 属性和 CSS 变量，组件引用变量而非硬编码颜色，切换主题时无需 React re-render。\n\n使用 `<head>` 中的阻塞脚本从 `localStorage` 读取主题并立即注入，避免首屏闪烁（FOUC）。ThemeProvider 同步 localStorage 实现持久化。\n\n### 架构要点\n- `ThemeProvider` → Context + `useEffect` 注入 CSS 变量\n- `useTheme` hook → 消费主题状态\n- 阻塞脚本 → 解决 SSR/CSR 首屏闪烁\n- 主题定义为纯 JSON 对象，易于扩展',
      key_conclusions: [
        'CSS 变量注入方案比 CSS-in-JS 切换性能更好，无需组件 re-render',
        '阻塞脚本放在 <head> 中是解决 FOUC 的标准方案',
        'localStorage 同步需在 useEffect 中完成，避免 SSR 不匹配',
      ],
      code_snippets: [
        { language: 'typescript', code: 'const root = document.documentElement;\nroot.setAttribute(\'data-theme\', theme);\nfor (const [key, value] of Object.entries(vars)) {\n  root.style.setProperty(`--color-${key}`, value);\n}', description: '通过 DOM API 注入 CSS 变量' },
      ],
      tags: ['react', 'css', 'theming', 'frontend'],
    },
  },
  {
    id: uid(), slug: 'stellar-ui-table-virtual',
    source: 'claude-code', project_dir: '/home/dev/stellar-ui', project_name: 'stellar-ui',
    cwd: '/home/dev/stellar-ui', git_branch: 'feat/table',
    first_message_at: ts(12, 5), last_message_at: ts(12, 2),
    file_path: '~/.claude/projects/stellar-ui/table-component.jsonl',
    file_size: 35200, file_mtime: ts(12, 2), status: 'summarized',
    messages: [
      { type: 'user', content: '我们的数据表格组件在渲染 10000 行时非常卡顿，FPS 降到个位数。需要实现虚拟滚动。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '10000 行卡顿的根因是 DOM 节点过多。虚拟滚动只渲染可视区域内的行，将 DOM 节点数从 10000 降到 ~30。\n\n推荐方案：使用 `@tanstack/react-virtual`，它比 react-window 更灵活，支持动态行高。\n\n```bash\nnpm install @tanstack/react-virtual\n```\n\n核心实现思路：\n\n```tsx\nimport { useVirtualizer } from \'@tanstack/react-virtual\';\n\nfunction VirtualTable({ rows, columns }) {\n  const parentRef = useRef<HTMLDivElement>(null);\n  \n  const virtualizer = useVirtualizer({\n    count: rows.length,\n    getScrollElement: () => parentRef.current,\n    estimateSize: () => 40, // 预估行高\n    overscan: 5, // 上下多渲染 5 行，减少闪白\n  });\n\n  return (\n    <div ref={parentRef} style={{ height: 600, overflow: \'auto\' }}>\n      <div style={{ height: virtualizer.getTotalSize() }}>\n        {virtualizer.getVirtualItems().map(virtualRow => (\n          <TableRow\n            key={virtualRow.key}\n            row={rows[virtualRow.index]}\n            style={{\n              transform: `translateY(${virtualRow.start}px)`,\n              position: \'absolute\',\n            }}\n          />\n        ))}\n      </div>\n    </div>\n  );\n}\n```', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '如果行高不固定（有些行展开了详情），怎么处理？', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '`@tanstack/react-virtual` 原生支持动态行高，用 `measureElement` 回调：\n\n```tsx\nconst virtualizer = useVirtualizer({\n  count: rows.length,\n  getScrollElement: () => parentRef.current,\n  estimateSize: () => 40,\n  measureElement: (el) => el.getBoundingClientRect().height,\n});\n\n// 每行需要 ref\n{virtualizer.getVirtualItems().map(vRow => (\n  <tr\n    key={vRow.key}\n    ref={virtualizer.measureElement}\n    data-index={vRow.index}\n  >\n    {/* ... */}\n  </tr>\n))}\n```\n\n当行展开/收起时高度变化，virtualizer 会自动重新测量。`estimateSize` 只在首次渲染时用作预估值。', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '性能提升明显吗？有 benchmark 吗？', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '虚拟滚动的性能提升非常显著：\n\n| 指标 | 无虚拟滚动 | 虚拟滚动 |\n|------|-----------|----------|\n| DOM 节点数 | ~10,000 行 | ~35 行 |\n| 首次渲染 | 2.8s | 45ms |\n| 滚动 FPS | 8-12 | 58-60 |\n| 内存占用 | 180MB | 22MB |\n\n这是 10000 行 × 8 列的测试结果。虚拟滚动让 DOM 节点数恒定，与数据量无关。', has_code: 0, has_tool_use: 0 },
    ],
    note: {
      title: '表格虚拟滚动优化：万行数据流畅渲染',
      summary: '针对数据表格 10000 行渲染卡顿问题，采用 `@tanstack/react-virtual` 实现虚拟滚动。核心原理是只渲染可视区域内的 DOM 节点（~35 行），将首次渲染从 2.8s 降到 45ms，滚动 FPS 从 8 提升到 60。\n\n### 关键技术点\n- `useVirtualizer` 管理可视区域计算\n- `overscan: 5` 预渲染上下各 5 行，避免快速滚动时出现空白\n- `measureElement` 回调支持动态行高（展开行详情场景）\n- `estimateSize` 作为初始预估，实际高度由浏览器测量',
      key_conclusions: [
        '虚拟滚动将 DOM 节点数从 O(n) 降到 O(1)，是大数据量表格的必选方案',
        '@tanstack/react-virtual 比 react-window 更适合动态行高场景',
        'overscan 参数需要在预渲染成本和滚动流畅度之间平衡，5 是较好的默认值',
      ],
      code_snippets: [
        { language: 'tsx', code: 'const virtualizer = useVirtualizer({\n  count: rows.length,\n  getScrollElement: () => parentRef.current,\n  estimateSize: () => 40,\n  overscan: 5,\n});', description: 'useVirtualizer 基础配置' },
      ],
      tags: ['react', 'performance', 'virtual-scroll', 'frontend'],
    },
  },
  {
    id: uid(), slug: 'stellar-ui-a11y-audit',
    source: 'claude-code', project_dir: '/home/dev/stellar-ui', project_name: 'stellar-ui',
    cwd: '/home/dev/stellar-ui', git_branch: 'fix/accessibility',
    first_message_at: ts(8, 2), last_message_at: ts(8, 0),
    file_path: '~/.claude/projects/stellar-ui/a11y-audit.jsonl',
    file_size: 12800, file_mtime: ts(8, 0), status: 'imported',
    messages: [
      { type: 'user', content: '用 axe-core 跑了一下我们组件库的无障碍审计，发现了 23 个问题，主要集中在 ARIA 标签缺失和键盘导航。帮我逐个修复。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '让我先看看审计报告和相关组件代码。', has_code: 0, has_tool_use: 1 },
      { type: 'user', content: '先从 Modal 组件开始，它缺少焦点陷阱和 ESC 关闭功能。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '好的，Modal 需要三个关键的无障碍改进：\n\n1. **焦点陷阱** — 打开后 Tab 键只在 Modal 内部循环\n2. **ESC 关闭** — 按 Escape 键关闭\n3. **ARIA 属性** — `role="dialog"`, `aria-modal="true"`, `aria-labelledby`\n\n让我修改 Modal 组件。', has_code: 0, has_tool_use: 1 },
    ],
    note: null, // imported, not yet summarized
  },
  // ── api-gateway (codex) ──
  {
    id: uid(), slug: 'api-gateway-rate-limiter',
    source: 'codex', project_dir: '/home/dev/api-gateway', project_name: 'api-gateway',
    cwd: '/home/dev/api-gateway', git_branch: 'feat/rate-limit',
    first_message_at: ts(10, 6), last_message_at: ts(10, 3),
    file_path: '~/.codex/sessions/api-gateway/rate-limiter.jsonl',
    file_size: 41000, file_mtime: ts(10, 3), status: 'summarized',
    messages: [
      { type: 'user', content: '我需要为 API 网关实现一个分布式限流器。要求：\n- 滑动窗口算法\n- Redis 作为后端\n- 支持按 IP、API Key、用户 ID 三种维度限流\n- 返回标准的 `X-RateLimit-*` 响应头', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '好的，我来实现基于 Redis 滑动窗口的限流中间件。\n\n**算法选择：** 滑动窗口日志（Sliding Window Log）精度最高但内存开销大；滑动窗口计数器（Sliding Window Counter）是更好的折中。\n\n```go\n// ratelimit/sliding_window.go\npackage ratelimit\n\nimport (\n\t"context"\n\t"fmt"\n\t"time"\n\t"github.com/redis/go-redis/v9"\n)\n\ntype Config struct {\n\tWindow  time.Duration\n\tLimit   int\n\tKeyFunc func(r *http.Request) string\n}\n\nfunc SlidingWindow(rdb *redis.Client, cfg Config) func(next http.Handler) http.Handler {\n\treturn func(next http.Handler) http.Handler {\n\t\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n\t\t\tkey := fmt.Sprintf("rl:%s", cfg.KeyFunc(r))\n\t\t\tnow := time.Now().UnixMilli()\n\t\t\twindowStart := now - cfg.Window.Milliseconds()\n\n\t\t\tpipe := rdb.Pipeline()\n\t\t\t// 移除窗口外的记录\n\t\t\tpipe.ZRemRangeByScore(r.Context(), key, "0", fmt.Sprint(windowStart))\n\t\t\t// 添加当前请求\n\t\t\tpipe.ZAdd(r.Context(), key, redis.Z{Score: float64(now), Member: now})\n\t\t\t// 统计窗口内请求数\n\t\t\tcountCmd := pipe.ZCard(r.Context(), key)\n\t\t\t// 设置过期时间\n\t\t\tpipe.Expire(r.Context(), key, cfg.Window)\n\t\t\tpipe.Exec(r.Context())\n\n\t\t\tcount := countCmd.Val()\n\t\t\tw.Header().Set("X-RateLimit-Limit", fmt.Sprint(cfg.Limit))\n\t\t\tw.Header().Set("X-RateLimit-Remaining", fmt.Sprint(max(0, int64(cfg.Limit)-count)))\n\n\t\t\tif count > int64(cfg.Limit) {\n\t\t\t\tw.Header().Set("Retry-After", "1")\n\t\t\t\thttp.Error(w, "Too Many Requests", 429)\n\t\t\t\treturn\n\t\t\t}\n\t\t\tnext.ServeHTTP(w, r)\n\t\t})\n\t}\n}\n```', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '不错。滑动窗口计数器相比令牌桶有什么优势？', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '两种算法各有侧重：\n\n| 特性 | 滑动窗口计数器 | 令牌桶 |\n|------|--------------|--------|\n| 精度 | 高，按实际时间窗口计数 | 中等，允许突发 |\n| 突发流量 | 严格限制，窗口内不超限 | 允许短时间突发（桶满时） |\n| 实现复杂度 | 中等（需要有序集合） | 简单（原子递减） |\n| Redis 内存 | 较高（存储每个请求时间戳） | 低（只存计数+时间） |\n| 适用场景 | API 配额、按量计费 | 流量整形、防止雪崩 |\n\n对于 API 网关的配额限流，滑动窗口更合适——用户期望"每分钟 100 次"是精确的 60 秒窗口，而不是令牌桶那样的"平均速率"。', has_code: 0, has_tool_use: 0 },
      { type: 'user', content: '好的，请在 middleware/ 目录下创建文件，并注册到路由中。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '让我先看看现有的中间件结构和路由注册方式。', has_code: 0, has_tool_use: 1 },
    ],
    note: {
      title: 'Redis 滑动窗口限流器设计与实现',
      summary: '为 API 网关实现了基于 Redis Sorted Set 的滑动窗口限流中间件。使用 `ZRANGEBYSCORE` + `ZCARD` 在 Pipeline 中原子操作，支持按 IP、API Key、用户 ID 三种维度限流。\n\n### 设计决策\n- 选择滑动窗口计数器而非令牌桶，因为 API 配额场景需要精确的时间窗口控制\n- Redis Pipeline 批量执行 4 个命令，减少网络往返\n- 自动设置 key 过期时间等于窗口大小，防止内存泄漏\n\n### 响应头\n返回标准的 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`Retry-After` 头，方便客户端自适应。',
      key_conclusions: [
        '滑动窗口计数器比令牌桶更适合 API 配额场景，提供精确的时间窗口控制',
        'Redis Sorted Set + Pipeline 可以在单次网络往返中完成限流判断',
        'Key 过期时间必须与窗口大小一致，否则会造成 Redis 内存泄漏',
      ],
      code_snippets: [
        { language: 'go', code: 'pipe := rdb.Pipeline()\npipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprint(windowStart))\npipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})\ncountCmd := pipe.ZCard(ctx, key)\npipe.Expire(ctx, key, cfg.Window)\npipe.Exec(ctx)', description: 'Redis Pipeline 原子限流操作' },
      ],
      tags: ['go', 'redis', 'rate-limiting', 'api-gateway', 'middleware'],
    },
  },
  {
    id: uid(), slug: 'api-gateway-jwt-auth',
    source: 'codex', project_dir: '/home/dev/api-gateway', project_name: 'api-gateway',
    cwd: '/home/dev/api-gateway', git_branch: 'feat/jwt',
    first_message_at: ts(7, 4), last_message_at: ts(7, 1),
    file_path: '~/.codex/sessions/api-gateway/jwt-auth.jsonl',
    file_size: 52000, file_mtime: ts(7, 1), status: 'summarized',
    messages: [
      { type: 'user', content: '现在需要给网关加 JWT 认证中间件。要求：\n- 支持 RS256 和 ES256\n- 公钥从 JWKS 端点动态获取并缓存\n- Token 过期、签名错误返回标准 401 响应', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '好的，我设计一个 JWKS 缓存 + JWT 验证的中间件。核心组件：\n\n1. **JWKSProvider** — 从 `/.well-known/jwks.json` 获取公钥，内存缓存 + TTL 刷新\n2. **JWTMiddleware** — 解析 Bearer token、查找匹配 kid 的公钥、验证签名和 claims\n\n```go\n// auth/jwks.go\ntype JWKSProvider struct {\n\turl      string\n\tkeys     map[string]crypto.PublicKey\n\tmu       sync.RWMutex\n\tttl      time.Duration\n\tlastFetch time.Time\n}\n\nfunc (p *JWKSProvider) GetKey(kid string) (crypto.PublicKey, error) {\n\tp.mu.RLock()\n\tif time.Since(p.lastFetch) < p.ttl {\n\t\tif key, ok := p.keys[kid]; ok {\n\t\t\tp.mu.RUnlock()\n\t\t\treturn key, nil\n\t\t}\n\t}\n\tp.mu.RUnlock()\n\t// Cache miss or expired — refresh\n\treturn p.refresh(kid)\n}\n```\n\n关键设计：\n- **读写锁** — 多数请求走 RLock 缓存命中，只在缓存过期时 Lock 刷新\n- **kid 查找** — JWT header 中的 `kid` 字段匹配 JWKS 中的密钥 ID\n- **双检锁** — `refresh()` 内部再次检查，避免并发刷新', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: 'JWKS 缓存的 TTL 设多少合适？', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '推荐 **5 分钟 TTL + 未知 kid 立即刷新** 的策略：\n\n- **常规 TTL = 5min** — 平衡密钥轮换感知速度和对 IdP 的请求压力\n- **未知 kid 立即刷新** — 当收到缓存中没有的 kid 时，立即刷新一次。这处理了密钥刚轮换的场景\n- **刷新失败回退** — 如果 JWKS 端点不可达，继续使用旧缓存而不是拒绝所有请求\n\n这是 Auth0、Okta 等主流 IdP 的 SDK 中使用的标准策略。', has_code: 0, has_tool_use: 0 },
      { type: 'user', content: '好，帮我实现完整的中间件并写单元测试。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '让我先看看现有的测试结构和 mock 方式。', has_code: 0, has_tool_use: 1 },
    ],
    note: {
      title: 'JWT 认证中间件：JWKS 动态公钥 + 缓存策略',
      summary: '为 API 网关实现了 JWT 认证中间件，支持 RS256/ES256 算法。公钥从 JWKS 端点动态获取，采用内存缓存 + 5 分钟 TTL + 未知 kid 立即刷新的策略。\n\n### 核心组件\n- **JWKSProvider** — 读写锁保护的公钥缓存，双检锁避免并发刷新\n- **JWTMiddleware** — 解析 Authorization header → 匹配 kid → 验证签名 → 校验 claims\n\n### 缓存策略\n采用 Auth0/Okta 标准策略：5min TTL + 未知 kid 强制刷新 + 失败回退旧缓存。确保密钥轮换平滑过渡的同时不对 IdP 造成压力。',
      key_conclusions: [
        '5 分钟 TTL + 未知 kid 立即刷新是 JWKS 缓存的业界标准策略',
        '读写锁 + 双检锁模式确保高并发下缓存刷新的安全性和效率',
        'JWKS 端点不可达时应回退到旧缓存，而不是拒绝所有请求',
      ],
      code_snippets: [
        { language: 'go', code: 'func (p *JWKSProvider) GetKey(kid string) (crypto.PublicKey, error) {\n\tp.mu.RLock()\n\tif time.Since(p.lastFetch) < p.ttl {\n\t\tif key, ok := p.keys[kid]; ok {\n\t\t\tp.mu.RUnlock()\n\t\t\treturn key, nil\n\t\t}\n\t}\n\tp.mu.RUnlock()\n\treturn p.refresh(kid)\n}', description: 'JWKS 缓存读取与刷新逻辑' },
      ],
      tags: ['go', 'jwt', 'authentication', 'api-gateway', 'security'],
    },
  },
  // ── devops-scripts (cursor) ──
  {
    id: uid(), slug: 'devops-docker-multistage',
    source: 'cursor', project_dir: '/home/dev/devops-scripts', project_name: 'devops-scripts',
    cwd: '/home/dev/devops-scripts', git_branch: 'main',
    first_message_at: ts(5, 7), last_message_at: ts(5, 4),
    file_path: 'cursor://workspace/devops-scripts/docker-optimize',
    file_size: 19500, file_mtime: ts(5, 4), status: 'summarized',
    messages: [
      { type: 'user', content: '我们的 Node.js 服务 Docker 镜像有 1.2GB，部署一次拉镜像要好几分钟。帮我优化到 200MB 以下。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '1.2GB 通常是因为使用了 `node:latest`（包含完整 Debian）且没有多阶段构建。优化策略：\n\n1. **多阶段构建** — build 阶段用完整 node 镜像，production 阶段用 alpine\n2. **只拷贝 production 依赖** — `npm ci --omit=dev`\n3. **使用 distroless 或 alpine** — 基础镜像从 ~900MB 降到 ~50MB\n\n```dockerfile\n# Stage 1: Build\nFROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\n# Stage 2: Production\nFROM node:20-alpine AS production\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev && npm cache clean --force\nCOPY --from=builder /app/dist ./dist\n\nUSER node\nEXPOSE 3000\nCMD ["node", "dist/index.js"]\n```\n\n预期优化效果：\n| 阶段 | 大小 |\n|------|------|\n| node:latest（原始） | 1.2GB |\n| node:20-alpine + 多阶段 | ~180MB |\n| + distroless | ~120MB |', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '很好。另外 .dockerignore 是不是也需要配置？', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '是的，`.dockerignore` 对构建速度和镜像安全都很重要：\n\n```\nnode_modules\n.git\n*.md\n.env*\n.vscode\ncoverage\ntests\n```\n\n不忽略 `node_modules` 的话，COPY 上下文会把本地的 node_modules 发送给 Docker daemon，即使你在 Dockerfile 里重新 `npm ci`，也会浪费构建时间。', has_code: 1, has_tool_use: 0 },
    ],
    note: {
      title: 'Docker 镜像优化：多阶段构建从 1.2GB 降到 180MB',
      summary: '将 Node.js 服务的 Docker 镜像从 1.2GB 优化到 180MB。主要手段是多阶段构建（build + production 分离）、基础镜像从 `node:latest` 切换到 `node:20-alpine`、只安装生产依赖。\n\n### 优化要点\n- **多阶段构建** — build 阶段编译 TypeScript，production 阶段只拷贝编译产物\n- **Alpine 基础镜像** — 从 ~900MB 降到 ~50MB\n- **`npm ci --omit=dev`** — 不安装 devDependencies\n- **`.dockerignore`** — 避免 node_modules 和 .git 进入构建上下文',
      key_conclusions: [
        '多阶段构建是 Node.js Docker 优化的第一步，效果最显著',
        'Alpine 镜像体积只有 Debian 的 1/18，但要注意 musl libc 兼容性',
        '.dockerignore 不仅影响镜像大小，还影响构建速度（减少发送给 daemon 的上下文）',
      ],
      code_snippets: [
        { language: 'dockerfile', code: 'FROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:20-alpine AS production\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev && npm cache clean --force\nCOPY --from=builder /app/dist ./dist\nUSER node\nCMD ["node", "dist/index.js"]', description: '多阶段构建 Dockerfile' },
      ],
      tags: ['docker', 'optimization', 'nodejs', 'devops'],
    },
  },
  {
    id: uid(), slug: 'devops-github-actions-ci',
    source: 'cursor', project_dir: '/home/dev/devops-scripts', project_name: 'devops-scripts',
    cwd: '/home/dev/devops-scripts', git_branch: 'feat/ci-pipeline',
    first_message_at: ts(3, 5), last_message_at: ts(3, 2),
    file_path: 'cursor://workspace/devops-scripts/ci-pipeline',
    file_size: 31000, file_mtime: ts(3, 2), status: 'summarized',
    messages: [
      { type: 'user', content: '帮我设计一个 GitHub Actions CI/CD 管道，要求：\n- PR 时跑 lint + test + build\n- merge 到 main 后自动部署到 staging\n- 手动审批后部署到 production\n- 支持回滚', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '我来设计一个完整的 CI/CD 管道：\n\n```yaml\n# .github/workflows/ci.yml\nname: CI\non:\n  pull_request:\n    branches: [main]\n\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20, cache: npm }\n      - run: npm ci\n      - run: npm run lint\n      - run: npm test -- --coverage\n      - run: npm run build\n      - uses: actions/upload-artifact@v4\n        with:\n          name: build\n          path: dist/\n```\n\n```yaml\n# .github/workflows/deploy.yml\nname: Deploy\non:\n  push:\n    branches: [main]\n\njobs:\n  deploy-staging:\n    runs-on: ubuntu-latest\n    environment: staging\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm run build\n      - run: ./scripts/deploy.sh staging\n\n  deploy-production:\n    needs: deploy-staging\n    runs-on: ubuntu-latest\n    environment:\n      name: production\n      url: https://api.example.com\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm run build\n      - run: ./scripts/deploy.sh production\n```\n\n`production` environment 在 GitHub 设置中配置 required reviewers，push 到 main 后 staging 自动部署，production 需要审批。', has_code: 1, has_tool_use: 0 },
      { type: 'user', content: '回滚怎么实现？', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '推荐两种回滚策略配合使用：\n\n**1. Git revert（推荐）：**\n```bash\ngit revert HEAD --no-edit\ngit push origin main\n# 触发正常的 CI/CD 流程，自动部署 revert 后的版本\n```\n\n**2. 手动触发部署指定 commit：**\n```yaml\non:\n  workflow_dispatch:\n    inputs:\n      ref:\n        description: "Git ref to deploy"\n        required: true\n        default: "main"\n\njobs:\n  rollback:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.inputs.ref }}\n      - run: npm ci && npm run build\n      - run: ./scripts/deploy.sh production\n```\n\nGit revert 更安全（有完整记录），workflow_dispatch 用于紧急回滚到任意版本。', has_code: 1, has_tool_use: 0 },
    ],
    note: {
      title: 'GitHub Actions CI/CD 管道：staging 自动部署 + production 审批',
      summary: '设计了完整的 GitHub Actions CI/CD 管道。PR 阶段运行 lint + test + build 质量门禁；merge 到 main 后自动部署 staging；production 部署需要 environment 审批。\n\n### 管道架构\n- **CI workflow** — PR 触发，lint → test → build → upload artifact\n- **Deploy workflow** — push main 触发，staging（自动）→ production（审批）\n- **Rollback** — git revert（推荐）+ workflow_dispatch 手动指定 commit\n\n### 关键配置\n- GitHub environment 的 required reviewers 实现审批门控\n- `workflow_dispatch` + `inputs.ref` 实现任意版本紧急回滚',
      key_conclusions: [
        'GitHub environment 的 required reviewers 是实现部署审批最简单的方案',
        'Git revert 比手动回滚更安全，保留完整的变更记录',
        'workflow_dispatch 提供紧急逃生通道，可部署任意 git ref',
      ],
      code_snippets: [
        { language: 'yaml', code: 'deploy-production:\n  needs: deploy-staging\n  environment:\n    name: production\n    url: https://api.example.com\n  steps:\n    - uses: actions/checkout@v4\n    - run: npm ci && npm run build\n    - run: ./scripts/deploy.sh production', description: 'Production 部署 job（需要审批）' },
      ],
      tags: ['github-actions', 'ci-cd', 'deployment', 'devops'],
    },
  },
  {
    id: uid(), slug: 'devops-k8s-health-checks',
    source: 'cursor', project_dir: '/home/dev/devops-scripts', project_name: 'devops-scripts',
    cwd: '/home/dev/devops-scripts', git_branch: 'main',
    first_message_at: ts(1, 3), last_message_at: ts(1, 1),
    file_path: 'cursor://workspace/devops-scripts/k8s-health',
    file_size: 15000, file_mtime: ts(1, 1), status: 'imported',
    messages: [
      { type: 'user', content: '我们的 K8s deployment 经常出现 Pod 启动后还没 ready 就接收流量导致 502 的问题。帮我配置健康检查。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '这个问题需要正确配置 readiness probe 和 liveness probe。让我看看你当前的 deployment yaml。', has_code: 0, has_tool_use: 1 },
      { type: 'user', content: '当前没有任何 probe 配置。', has_code: 0, has_tool_use: 0 },
      { type: 'assistant', content: '那我来从头设计。两种 probe 的职责不同：\n\n- **readinessProbe** — 决定 Pod 是否接收流量。未通过时从 Service 摘除\n- **livenessProbe** — 决定 Pod 是否存活。未通过时重启 Pod\n\n```yaml\ncontainers:\n  - name: api\n    readinessProbe:\n      httpGet:\n        path: /healthz\n        port: 3000\n      initialDelaySeconds: 5\n      periodSeconds: 10\n      failureThreshold: 3\n    livenessProbe:\n      httpGet:\n        path: /healthz\n        port: 3000\n      initialDelaySeconds: 15\n      periodSeconds: 20\n      failureThreshold: 3\n```\n\n**关键参数设计：**\n- readiness 的 `initialDelaySeconds` 应小于 liveness，让 readiness 先生效\n- liveness 的检查间隔更长，避免误杀正在处理慢请求的 Pod', has_code: 1, has_tool_use: 0 },
    ],
    note: null, // imported, not yet summarized
  },
];

// ── Note relations (between summarized notes) ──────────────────────────
// Will be populated after notes are inserted, using note IDs
const relationDefs = [
  // stellar-ui internal
  { srcIdx: 0, tgtIdx: 1, type: 'EXTENDS', confidence: 0.85, desc: '表格虚拟滚动是主题系统之后的又一性能优化工作', created_by: 'llm' },
  // api-gateway internal
  { srcIdx: 3, tgtIdx: 4, type: 'DEPENDS_ON', confidence: 0.92, desc: 'JWT 认证中间件依赖限流器提供的请求级别控制', created_by: 'llm' },
  // cross-project relations
  { srcIdx: 0, tgtIdx: 5, type: 'SIMILAR_TO', confidence: 0.72, desc: '两者都涉及运行时配置切换（主题 vs Docker 环境变量）', created_by: 'llm' },
  { srcIdx: 1, tgtIdx: 5, type: 'REFERENCES', confidence: 0.68, desc: 'Docker 优化中提到了前端构建产物的体积控制', created_by: 'llm' },
  { srcIdx: 3, tgtIdx: 6, type: 'LEADS_TO', confidence: 0.88, desc: '限流器的监控需求推动了 CI/CD 管道中加入性能测试', created_by: 'llm' },
  { srcIdx: 4, tgtIdx: 6, type: 'DEPENDS_ON', confidence: 0.79, desc: 'JWT 密钥轮换需要 CI/CD 管道配合部署新的 JWKS 配置', created_by: 'llm' },
  { srcIdx: 5, tgtIdx: 6, type: 'LEADS_TO', confidence: 0.95, desc: 'Docker 多阶段构建是 CI/CD 管道中构建步骤的基础', created_by: 'llm' },
  { srcIdx: 6, tgtIdx: 3, type: 'RESOLVED_BY', confidence: 0.70, desc: 'CI/CD 管道的自动化测试能及时发现限流器的回归问题', created_by: 'llm' },
  { srcIdx: 1, tgtIdx: 3, type: 'SIMILAR_TO', confidence: 0.65, desc: '虚拟滚动和限流器都是处理大量数据/请求的性能优化方案', created_by: 'llm' },
  { srcIdx: 0, tgtIdx: 4, type: 'REFERENCES', confidence: 0.60, desc: '主题系统的 Provider 模式与 JWKS Provider 有类似的缓存设计', created_by: 'llm' },
];

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  // Ensure output directory
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);

  // ── Insert conversations & messages ──
  const convStmt = db.prepare(`
    INSERT INTO conversations (
      id, slug, source, project_dir, project_name, cwd, git_branch,
      message_count, first_message_at, last_message_at,
      file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const msgStmt = db.prepare(`
    INSERT INTO messages (
      id, conversation_id, parent_uuid, type, role,
      content, has_tool_use, has_code, thinking, timestamp, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const conv of conversations) {
    convStmt.run([
      conv.id, conv.slug, conv.source, conv.project_dir, conv.project_name,
      conv.cwd, conv.git_branch, conv.messages.length,
      conv.first_message_at, conv.last_message_at,
      conv.file_path, conv.file_size, conv.file_mtime, conv.status,
    ]);

    const startTime = new Date(conv.first_message_at.replace(' ', 'T') + 'Z');
    for (let i = 0; i < conv.messages.length; i++) {
      const msg = conv.messages[i];
      const msgTime = new Date(startTime.getTime() + i * 3 * 60 * 1000); // 3 min apart
      msgStmt.run([
        uid(), conv.id, null, msg.type, null,
        msg.content, msg.has_tool_use ? 1 : 0, msg.has_code ? 1 : 0,
        null, msgTime.toISOString().replace('T', ' ').slice(0, 19), i,
      ]);
    }
  }
  convStmt.free();
  msgStmt.free();

  // ── Insert notes, tags, note_tags ──
  const noteStmt = db.prepare(`
    INSERT INTO notes (conversation_id, title, summary, key_conclusions, code_snippets)
    VALUES (?, ?, ?, ?, ?)
  `);

  const noteIds = []; // track note IDs for relations, indexed by conversation order among summarized ones
  let summarizedIdx = 0;

  for (const conv of conversations) {
    if (!conv.note) continue;

    const n = conv.note;
    noteStmt.run([
      conv.id, n.title, n.summary,
      JSON.stringify(n.key_conclusions),
      JSON.stringify(n.code_snippets),
    ]);

    // Get the auto-incremented note ID
    const noteId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    noteIds.push(noteId);

    // Insert tags
    for (const tagName of n.tags) {
      db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName]);
      const tagRow = db.exec('SELECT id FROM tags WHERE name = ?', [tagName]);
      const tagId = tagRow[0].values[0][0];
      db.run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [noteId, tagId]);
    }

    summarizedIdx++;
  }
  noteStmt.free();

  // ── Insert note relations ──
  const relStmt = db.prepare(`
    INSERT INTO note_relations (source_note_id, target_note_id, relation_type, confidence, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const rel of relationDefs) {
    if (rel.srcIdx < noteIds.length && rel.tgtIdx < noteIds.length) {
      relStmt.run([
        noteIds[rel.srcIdx], noteIds[rel.tgtIdx],
        rel.type, rel.confidence, rel.desc, rel.created_by,
      ]);
    }
  }
  relStmt.free();

  // ── Insert import log ──
  for (const conv of conversations) {
    db.run(
      'INSERT INTO import_log (file_path, status, message) VALUES (?, ?, ?)',
      [conv.file_path, 'success', `Imported ${conv.messages.length} messages`]
    );
  }

  // ── Save to disk ──
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  // Print summary
  console.log(`\n✅ Demo database created: ${DB_PATH}\n`);
  console.log(`   Conversations: ${conversations.length} (${conversations.filter(c => c.status === 'summarized').length} summarized, ${conversations.filter(c => c.status === 'imported').length} imported)`);
  console.log(`   Notes:         ${noteIds.length}`);
  console.log(`   Relations:     ${relationDefs.length}`);
  console.log(`   Tags:          ${new Set(conversations.flatMap(c => c.note?.tags || [])).size}`);
  console.log(`\nTo use:\n   DATA_DIR=data-demo npm run dev\n`);
}

main().catch(err => {
  console.error('Failed to seed demo database:', err);
  process.exit(1);
});
