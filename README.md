<p align="center">
  <img src="https://raw.githubusercontent.com/lanyijianke/AnySkill/master/assets/icon.png" width="128" height="128" alt="AnySkill" />
</p>

<h1 align="center">AnySkill</h1>

<p align="center">
  <strong>Your Personal, Free Skill Management Terminal</strong><br/>
  Manage, load, and share AI skills in VS Code
</p>

<p align="center">
  <a href="https://open-vsx.org/extension/anyskill/anyskill">
    <img src="https://img.shields.io/open-vsx/v/anyskill/anyskill?style=flat-square&label=Open%20VSX" alt="Open VSX" />
  </a>
  <a href="https://github.com/lanyijianke/AnySkill">
    <img src="https://img.shields.io/github/stars/lanyijianke/AnySkill?style=flat-square&label=Stars" alt="Stars" />
  </a>
  <a href="https://github.com/lanyijianke/AnySkill/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
  </a>
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

---

<a id="english"></a>

## What is AnySkill?

AnySkill is a VS Code extension that gives you a full GUI for managing your personal AI skill library. Skills are stored in a private GitHub repository and loaded on-demand into any AI coding assistant — keeping your projects clean and your skills always available.

## Why AnySkill?

- **Lightweight** — Skills load into memory on demand. Nothing is written to your project unless you choose to download.
- **Clean codebase** — No scattered prompt files across repositories. One central repo holds everything.
- **Cross-IDE** — Auto-detects Antigravity, Claude Code, and Cursor, downloading to the correct directory.
- **Cloud backup** — Your skills live in a private GitHub repository. Never lose a valuable prompt again.

## Quick Start

1. Install the extension and click the **AnySkill** icon on the Activity Bar.
2. Run `AnySkill: Initialize` from the Command Palette (`Cmd+Shift+P`).
3. Enter your GitHub Token and connect to your skill repository.
4. Manage your skills from the sidebar — load, download, upload, delete.

## Commands

| Command | Description |
|---------|-------------|
| `AnySkill: Initialize` | Connect to your skill repo and install the engine |
| `AnySkill: Load Skill` | Open skill content in editor (read-only) |
| `AnySkill: Download Skill` | Download to current project's skill directory |
| `AnySkill: Sync All` | Batch download all skills |
| `AnySkill: Upload Skill` | Create a new skill and push to cloud |
| `AnySkill: Import Skill` | Import from local folder or file |
| `AnySkill: Delete Skill` | Remove a skill from the repository |
| `AnySkill: Create Folder` | Create a category folder for organizing skills |
| `AnySkill: Move Skill` | Move a skill to a different category folder |
| `AnySkill: Install Pack` | Install curated skill packs |

## How It Works

```
Your GitHub Private Repository
├── skills/
│   ├── frontend/                ← category folder
│   │   ├── design-system/
│   │   │   └── SKILL.md
│   │   └── react-patterns/
│   │       └── SKILL.md
│   ├── api-integration/         ← root-level skill
│   │   └── SKILL.md
│   └── ...
├── index.json                   ← auto-generated index
└── generate-index.js
```

Each skill is a Markdown file with YAML frontmatter. When loaded into an AI IDE, the assistant reads it and gains that capability instantly.

## Supported IDEs

| IDE | Skill Directory |
|-----|-----------------|
| Antigravity | `.agent/skills/` |
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/rules/` |

## Security

- Tokens are stored locally in `~/.anyskill/config.json`, never transmitted to third parties.
- All communication goes through HTTPS and the official GitHub API.
- Your skill repository is fully under your control.

## Links

- [AnySkill Engine](https://github.com/lanyijianke/AnySkill) — Core engine and documentation
- [AnySkill-Packs](https://github.com/lanyijianke/AnySkill-Packs) — Community skill packs
- [Issues & Feedback](https://github.com/lanyijianke/AnySkill/issues)

---

<a id="中文"></a>

## 什么是 AnySkill？

AnySkill 是一个 VS Code 插件，为你提供完整的 GUI 界面来管理个人 AI 技能库。技能存储在 GitHub 私有仓库，按需加载到任意 AI 编程助手中——项目目录保持干净，技能随时可用。

## 为什么选择 AnySkill？

- **轻量级** — 技能按需加载到内存，用完即弃。除非主动下载，不会向项目写入文件。
- **代码库干净** — 不再有散落在各仓库的提示词文件。一个中心仓库管理一切。
- **跨 IDE** — 自动识别 Antigravity、Claude Code、Cursor，下载到对应目录。
- **云端备份** — 技能存储在 GitHub 私有仓库中。换电脑、重装系统，技能库瞬间恢复。

## 快速开始

1. 安装插件，点击活动栏上的 **AnySkill** 图标。
2. 在命令面板（`Cmd+Shift+P`）中运行 `AnySkill: Initialize`。
3. 输入 GitHub Token 并连接你的技能仓库。
4. 在侧边栏管理你的技能——加载、下载、上传、删除。

## 安全性

- Token 仅存储在本地 `~/.anyskill/config.json`，不会传输给第三方。
- 所有通信通过 HTTPS 和 GitHub 官方 API。
- 技能仓库完全由你掌控。

## License

[MIT](https://github.com/lanyijianke/AnySkill/blob/main/LICENSE)
