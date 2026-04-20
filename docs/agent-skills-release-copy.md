# ChatCrystal Skills Release Copy

This file contains ready-to-use copy for publishing the new ChatCrystal skills to skills.sh, GitHub, and developer communities.

## Repository Install Block

Use this block in announcements, release notes, or README snippets:

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

## Short Repo Description

ChatCrystal now ships three portable agent skills for project memory recall and task writeback. They work as lightweight skills on their own and unlock full memory-loop behavior when connected to ChatCrystal Core through MCP.

## Skills.sh / Store Summary

ChatCrystal publishes three focused skills instead of one umbrella package:

- `chatcrystal-task-recall` recalls project-first and global-supplement memories before substantial work
- `chatcrystal-debug-recall` recalls historical fixes, pitfalls, and root causes for debugging work
- `chatcrystal-task-writeback` writes durable fixes, patterns, pitfalls, and decisions back into ChatCrystal after meaningful work

Each skill is self-contained, store-friendly, and designed to degrade safely when ChatCrystal Core is unavailable.

## GitHub Release Note Copy

### ChatCrystal Agent Skills

This release formalizes the first publishable ChatCrystal skills:

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

What changed:

- moved from local dogfooding drafts to tracked, publishable skill folders
- added self-contained `SKILL.md` instructions and `agents/openai.yaml` metadata for each skill
- documented full mode with `recall_for_task` and `write_task_memory`
- documented degraded mode so skills never pretend memory was recalled or persisted when Core is unavailable

Install:

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

To enable full memory-loop behavior, run ChatCrystal Core locally and expose the `chatcrystal` MCP server.

## Community Post Copy

### English

ChatCrystal now has 3 publishable agent skills:

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

They let agents recall project history before work, recall past fixes during debugging, and write durable task memories back after substantial work.

They also degrade safely: if ChatCrystal Core is not available, they keep working without pretending memory was recalled or saved.

Install:

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

### 中文

ChatCrystal 现在正式提供 3 个可发布的 agent skill：

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

它们分别解决三件事：

- 开工前回忆当前项目的历史经验
- debug 时召回过去的根因、修复和坑点
- 完工后把可复用经验写回 ChatCrystal

如果没有接入 ChatCrystal Core，它们也会安全降级：继续帮助完成任务，但不会伪装成“已经完成长期记忆召回/持久化”。

安装：

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```
