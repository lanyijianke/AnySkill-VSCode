<p align="center">
  <img src="https://raw.githubusercontent.com/lanyijianke/AnySkill/master/assets/icon.png" width="128" height="128" alt="AnySkill" />
</p>

<h1 align="center">AnySkill</h1>

<p align="center">
  <strong>Your Private AI Skill Space</strong><br/>
  在 VS Code 中管理、加载、分享 AI 技能
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

---

AnySkill 让你用一个 GitHub 私有仓库集中管理所有 AI 技能，并在任何 AI 编程助手中按需加载。每个技能就是一个 `SKILL.md`——写一次，到处用。

## Features

**Cloud-Synced Skills** — 技能存储在你的 GitHub 私有仓库，跨设备、跨 IDE 随时可用。

**One-Click Loading** — 从侧边栏直接把技能加载到编辑器，或下载到当前项目的 AI skill 目录。

**Multi-IDE Support** — 自动识别 Antigravity、Claude Code、Cursor、OpenClaw，技能文件下载到对应目录。

**Import & Publish** — 本地已有技能？选择文件夹或 SKILL.md 一键导入并推送到云端。

**Skill Packs** — 浏览社区精选技能包，批量安装整套能力。

## How to Use

1. Install the extension, click the **AnySkill** icon on the Activity Bar.
2. Run `AnySkill: 初始化配置` from the Command Palette (`Cmd+Shift+P`).
3. Enter your GitHub Token and connect to your skill repository.
4. Manage your skills from the sidebar — load, download, upload, delete.

## Commands

| Command | Description |
|---------|-------------|
| `AnySkill: 初始化配置` | Connect to your skill repo and install the engine |
| `AnySkill: 加载技能` | Open skill content in editor (read-only) |
| `AnySkill: 下载技能` | Download to current project's skill directory |
| `AnySkill: 同步所有` | Batch download all skills |
| `AnySkill: 上传技能` | Create a new skill and push to cloud |
| `AnySkill: 导入已有技能` | Import from local folder or file |
| `AnySkill: 删除技能` | Remove a skill from the repository |
| `AnySkill: 安装组合包` | Install curated skill packs |
| `AnySkill: 检查更新` | Check for engine updates |

## How It Works

```
Your GitHub Private Repository
├── skills/
│   ├── frontend-design/
│   │   └── SKILL.md
│   ├── api-integration/
│   │   └── SKILL.md
│   └── ...
├── index.json               ← auto-generated index
└── generate-index.js
```

Each skill is a Markdown file with YAML frontmatter. When loaded into an AI IDE, the assistant reads it and gains that capability instantly.

## Supported IDEs

| IDE | Skill Directory |
|-----|-----------------|
| Antigravity | `.agent/skills/` |
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/rules/` |
| OpenClaw | `.openclaw/skills/` |

## Security

- Tokens are stored locally in `~/.anyskill/config.json`, never transmitted to third parties.
- All communication goes through HTTPS and the official GitHub API.
- Your skill repository is fully under your control.

## Links

- [AnySkill Engine](https://github.com/lanyijianke/AnySkill) — Core engine and documentation
- [AnySkill-Packs](https://github.com/lanyijianke/AnySkill-Packs) — Community skill packs
- [Issues & Feedback](https://github.com/lanyijianke/AnySkill/issues)

## License

[MIT](https://github.com/lanyijianke/AnySkill/blob/main/LICENSE)
