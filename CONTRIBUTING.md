# Contributing to ChatCrystal

感谢你对 ChatCrystal 的关注！我们欢迎任何形式的贡献。
Thanks for your interest in ChatCrystal! We welcome contributions of all kinds.

---

## 目录 / Table of Contents

- [开始之前 / Before You Start](#开始之前--before-you-start)
- [开发环境 / Development Setup](#开发环境--development-setup)
- [项目结构 / Project Structure](#项目结构--project-structure)
- [开发流程 / Development Workflow](#开发流程--development-workflow)
- [提交规范 / Commit Convention](#提交规范--commit-convention)
- [Pull Request 流程 / Pull Request Process](#pull-request-流程--pull-request-process)
- [报告 Bug / Reporting Bugs](#报告-bug--reporting-bugs)
- [功能建议 / Feature Requests](#功能建议--feature-requests)

---

## 开始之前 / Before You Start

- 请先阅读 [Code of Conduct](CODE_OF_CONDUCT.md) / Please read our [Code of Conduct](CODE_OF_CONDUCT.md)
- 对于重大变更，请先开 Issue 讨论 / For major changes, please open an Issue first to discuss
- 确保你的 Node.js 版本 >= 20 / Make sure you have Node.js >= 20

## 开发环境 / Development Setup

```bash
# 1. Fork 并克隆仓库 / Fork and clone the repo
git clone https://github.com/<your-username>/ChatCrystal.git
cd ChatCrystal

# 2. 安装依赖 / Install dependencies
npm install

# 3. 启动开发服务器（前端 + 后端）/ Start dev server (frontend + backend)
npm run dev
```

启动后：
- 后端 API: `http://localhost:3721`
- 前端页面: `http://localhost:13721`

After starting:
- Backend API: `http://localhost:3721`
- Frontend: `http://localhost:13721`

### 代码检查 / Linting

```bash
npm run lint        # 检查 / Check
npm run lint:fix    # 自动修复 / Auto-fix
```

## 项目结构 / Project Structure

```
ChatCrystal/
├── shared/     # 共享类型 (无构建步骤) / Shared types (no build step)
├── server/     # Fastify 后端 / Fastify backend
├── client/     # React 前端 (Vite + Tailwind CSS) / React frontend
├── electron/   # Electron 桌面应用 / Electron desktop app
└── scripts/    # 发布与工具脚本 / Release & utility scripts
```

## 开发流程 / Development Workflow

1. 从 `main` 创建你的分支 / Create a branch from `main`
   ```bash
   git checkout -b feat/your-feature
   ```
2. 进行修改并确保 lint 通过 / Make changes and ensure lint passes
3. 提交你的更改 / Commit your changes（见下方提交规范 / see commit convention below）
4. 推送到你的 Fork / Push to your fork
5. 创建 Pull Request / Open a Pull Request

## 提交规范 / Commit Convention

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：
Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <description>
```

常用 type / Common types:
| type | 说明 / Description |
|------|-------------------|
| `feat` | 新功能 / New feature |
| `fix` | Bug 修复 / Bug fix |
| `docs` | 文档变更 / Documentation |
| `refactor` | 重构（不改变行为）/ Refactoring (no behavior change) |
| `style` | 代码格式 / Code style (formatting, etc.) |
| `test` | 测试 / Tests |
| `chore` | 构建/工具变更 / Build or tooling changes |

常用 scope / Common scopes:
`client`, `server`, `shared`, `electron`, `cli`, `docs`, `ci`

示例 / Examples:
```
feat(client): add dark mode toggle
fix(server): handle empty conversation parsing
docs: update README installation steps
```

## Pull Request 流程 / Pull Request Process

1. 确保 PR 描述清晰，说明做了什么以及为什么 / Ensure PR description explains what and why
2. 关联相关 Issue（如有）/ Link related Issues (if any)
3. 确保 CI 检查通过 / Ensure CI checks pass
4. 等待维护者审核 / Wait for maintainer review
5. 根据反馈进行修改 / Address review feedback

### PR 标题格式 / PR Title Format

与提交规范一致 / Same as commit convention:
```
feat(client): add dark mode toggle
```

## 报告 Bug / Reporting Bugs

使用 [Bug Report](https://github.com/ZengLiangYi/ChatCrystal/issues/new?template=bug_report.yml) 模板，包含：
Use the [Bug Report](https://github.com/ZengLiangYi/ChatCrystal/issues/new?template=bug_report.yml) template, including:

- 清晰的复现步骤 / Clear steps to reproduce
- 期望与实际行为 / Expected vs actual behavior
- 版本与运行环境 / Version and environment
- 相关日志或截图 / Relevant logs or screenshots

## 功能建议 / Feature Requests

使用 [Feature Request](https://github.com/ZengLiangYi/ChatCrystal/issues/new?template=feature_request.yml) 模板。
Use the [Feature Request](https://github.com/ZengLiangYi/ChatCrystal/issues/new?template=feature_request.yml) template.

---

如有疑问，请在 [Discussions](https://github.com/ZengLiangYi/ChatCrystal/discussions) 中提问。
If you have questions, feel free to ask in [Discussions](https://github.com/ZengLiangYi/ChatCrystal/discussions).
