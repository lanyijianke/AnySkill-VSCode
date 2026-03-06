<p align="center">
  <img src="https://raw.githubusercontent.com/lanyijianke/AnySkill/master/assets/icon.png" width="128" height="128" alt="AnySkill" />
</p>

<h1 align="center">AnySkill</h1>

<p align="center">
  <strong>Your Personal, Free Skill Management Terminal</strong><br/>
  Natural Language + Visual GUI — Two Ways to Manage AI Skills
</p>

<p align="center">
  <a href="https://open-vsx.org/extension/anyskill/anyskill">
    <img src="https://img.shields.io/open-vsx/v/anyskill/anyskill?style=flat-square&label=Open%20VSX" alt="Open VSX" />
  </a>
  <a href="https://github.com/lanyijianke/AnySkill">
    <img src="https://img.shields.io/badge/platform-VS%20Code-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white" alt="VS Code" />
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

AnySkill is a **dual-layer AI skill management system**. It combines a VS Code extension (visual GUI) with a cloud-native engine (natural language) — giving you two complementary ways to manage your personal AI skill library.

| Layer | How It Works | Best For |
|-------|-------------|----------|
| 🖥️ **Visual GUI** (this extension) | Sidebar tree view, command palette, one-click install | Browsing, organizing, discovering new skills from Packs |
| 💬 **Natural Language** (AnySkill Engine) | AI assistant loads skills from cloud on demand | On-the-fly skill loading during coding, zero-friction workflow |

Skills are stored in a **private GitHub repository** — your personal skill vault that syncs across machines and IDEs.

## Why AnySkill?

- **Two ways to work** — Use the GUI when you want to browse and manage; use natural language when you want instant skill loading while coding.
- **Skill Packs** — Curated collections of high-quality skills organized by category. Install an entire pack with one click to supercharge your AI assistant.
- **Lightweight** — Skills load into memory on demand. Nothing is written to your project unless you explicitly download.
- **Cross-IDE** — Auto-detects Antigravity, Claude Code, and Cursor, downloading to the correct directory.
- **Cloud backup** — Skills live in a private GitHub repo. Switch computers, reinstall — your skills follow you.

## Skill Packs

AnySkill comes with curated **Skill Packs** — themed collections of battle-tested skills ready to install:

| Pack | Description |
|------|-------------|
| 🧠 Core Enhancement | Brainstorming, copywriting, test-driven development, writing plans |
| 💻 Tech Development | React best practices, JavaScript/Python SDKs, Vercel patterns |
| ✏️ Content Creation | SEO strategy, free tool strategy, content marketing |
| 🔍 Data Collection | PDF processing, web search, data extraction |
| 💬 Communication | Chat UI, agent UI, widgets, tool lifecycle components |
| 🏢 Office Operations | Office workflow automation skills |

Browse and install packs directly from the **Packs** panel in the sidebar.

## Quick Start

### 1. Create Your Skill Repository

Click 👉 [**Create from template**](https://github.com/lanyijianke/AnySkill/generate) to create your private skill repo.

- ⚠️ Set the repository to **Private**
- The template includes GitHub Actions that auto-generate `index.json` — zero maintenance

### 2. Generate a GitHub Token

1. Go to 👉 [**Create token**](https://github.com/settings/personal-access-tokens/new)
2. **Token name**: `AnySkill`
3. **Repository access**: Select **"Only select repositories"** → pick your skill repo
4. **Permissions** → **Contents** → **Read and write**
5. Click **Generate token** and copy it

> **Security**: The token only accesses the single repo you selected. Stored locally in `~/.anyskill/config.json`, transmitted only via HTTPS to GitHub.

### 3. Initialize

1. Install the extension → click the **AnySkill** icon in the Activity Bar
2. Run `AnySkill: Initialize` from the Command Palette (`Cmd/Ctrl+Shift+P`)
3. Choose **"I have a token"** → paste your token
4. The extension will auto-discover your skill repo, clone it, and optionally install the AnySkill engine

That's it! Your skills appear in the sidebar, and the engine is ready for natural language loading.

## Best Practices

### 🎯 Recommended Workflow

1. **Initialize once** — Run `AnySkill: Initialize` in your first project. It sets up global config (`~/.anyskill/config.json`) that works across all projects.

2. **Install Skill Packs** — Browse the **Packs** panel and install curated skill collections. These are high-quality, community-maintained skills covering frontend, backend, DevOps, and more.

3. **Install the engine** — During initialization, choose "Install" when prompted to install the AnySkill engine. This enables your AI coding assistant (Antigravity, Claude Code, Cursor) to load skills from the cloud using natural language.

4. **Use natural language for daily work** — Once the engine is installed, simply tell your AI assistant what you need: _"I need a frontend design skill"_ — it will automatically find and load the right skill from your cloud library.

5. **Use the GUI for management** — Use the sidebar to upload new skills, organize with folders, browse packs, and keep your skill library tidy.

### 📁 Organizing Skills

- Use **category folders** to group related skills (e.g., `frontend/`, `backend/`, `devops/`)
- Create folders via the sidebar context menu or `AnySkill: Create Folder`
- Move skills between folders with `AnySkill: Move Skill`

### 🔄 Multi-Machine Setup

AnySkill config is global — initialize on one machine, and every project on that machine can access your skills. On a new machine:

1. Install the extension
2. Run `AnySkill: Initialize` with the same token
3. All your skills are instantly available

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
| `AnySkill: Install Pack` | Install curated skill packs |
| `AnySkill: Create Folder` | Create a category folder |
| `AnySkill: Move Skill` | Move a skill to a different folder |
| `AnySkill: Check Updates` | Check for engine updates |

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

## Links

- [AnySkill Engine](https://github.com/lanyijianke/AnySkill) — Core engine and documentation
- [AnySkill-Packs](https://github.com/lanyijianke/AnySkill-Packs) — Curated skill packs
- [Issues & Feedback](https://github.com/lanyijianke/AnySkill/issues)

---

<a id="中文"></a>

## 什么是 AnySkill？

AnySkill 是一套**双层 AI 技能管理系统**。它将 VS Code 可视化插件与云端引擎相结合——让你通过**自然语言**和**图形界面**两种方式管理个人 AI 技能库。

| 层面 | 工作方式 | 最佳场景 |
|------|---------|---------|
| 🖥️ **图形界面**（本插件） | 侧边栏树状视图、命令面板、一键安装 | 浏览管理、整理分类、从组合包发现新技能 |
| 💬 **自然语言**（AnySkill 引擎） | AI 助手从云端按需加载技能 | 编码过程中即时加载技能、零摩擦工作流 |

技能存储在 **GitHub 私有仓库**——你的个人技能金库，跨设备、跨 IDE 无缝同步。

## 为什么选择 AnySkill？

- **双通道操作** — GUI 用于浏览管理，自然语言用于编码时即时加载，互为补充。
- **技能组合包** — 按分类精选的高质量技能合集，一键安装即刻增强 AI 助手的能力。
- **轻量级** — 技能按需加载到内存，不会向项目写入多余文件。
- **跨 IDE** — 自动识别 Antigravity、Claude Code、Cursor，下载到对应目录。
- **云端备份** — 技能存储在 GitHub 私有仓库，换电脑、重装系统，技能库瞬间恢复。

## 技能组合包

AnySkill 自带精选**技能组合包**——按主题分类的实战级技能合集，一键安装：

| 组合包 | 内容 |
|-------|------|
| 🧠 核心增强 | 头脑风暴、文案写作、测试驱动开发、方案规划 |
| 💻 技术开发 | React 最佳实践、JavaScript/Python SDK、Vercel 模式 |
| ✏️ 内容创作 | SEO 策略、免费工具策略、内容营销 |
| 🔍 数据采集 | PDF 处理、网络搜索、数据提取 |
| 💬 通信集成 | 聊天 UI、Agent UI、Widgets、工具生命周期组件 |
| 🏢 办公运营 | 办公流程自动化技能 |

在侧边栏的**组合包**面板中浏览和安装。

## 快速开始

### 1. 创建技能仓库

点击 👉 [**一键创建仓库**](https://github.com/lanyijianke/AnySkill/generate)

- ⚠️ 务必设为 **Private**
- 模板自带 GitHub Actions，自动生成 `index.json`，零维护

### 2. 生成 GitHub Token

1. 打开 👉 [**创建 Token**](https://github.com/settings/personal-access-tokens/new)
2. **Token name**：`AnySkill`
3. **Repository access**：选 **"Only select repositories"** → 勾选你的技能仓库
4. **Permissions** → **Contents** → **Read and write**
5. 点击 **Generate token** 并复制

> **安全说明**：Token 仅对你选择的单个仓库有访问权限。存储在本地 `~/.anyskill/config.json`，仅通过 HTTPS 与 GitHub 通信。

### 3. 初始化

1. 安装插件 → 点击活动栏上的 **AnySkill** 图标
2. 在命令面板（`Cmd/Ctrl+Shift+P`）中运行 `AnySkill: Initialize`
3. 选择 **"我有 Token"** → 粘贴 Token
4. 插件会自动发现你的技能仓库、克隆到本地，并可选安装 AnySkill 引擎

完成！技能出现在侧边栏，引擎也准备好了。

## 最佳实践

### 🎯 推荐工作流

1. **一次初始化** — 在第一个项目中执行 `AnySkill: Initialize`，全局配置（`~/.anyskill/config.json`）会在所有项目中生效。

2. **安装技能组合包** — 浏览侧边栏的**组合包**面板，一键安装精选技能合集。涵盖前端、后端、DevOps 等多个领域的高质量技能。

3. **安装引擎** — 初始化时选择"安装"引擎。这让你的 AI 编码助手（Antigravity、Claude Code、Cursor）拥有从云端按需加载技能的能力。

4. **日常使用自然语言** — 引擎装好后，直接告诉 AI 助手你需要什么：_"我需要前端设计技能"_——它会自动从你的云端库中找到并加载合适的技能。

5. **用 GUI 管理技能** — 使用侧边栏上传新技能、整理文件夹、浏览组合包，保持技能库整洁有序。

### 📁 整理技能

- 使用**分类文件夹**组织相关技能（如 `frontend/`、`backend/`、`devops/`）
- 通过右键菜单或 `AnySkill: Create Folder` 创建文件夹
- 通过 `AnySkill: Move Skill` 在文件夹间移动技能

### 🔄 多设备同步

AnySkill 配置是全局的——在一台机器上初始化，这台机器上的所有项目都能访问技能库。换新设备时：

1. 安装插件
2. 用同一个 Token 执行 `AnySkill: Initialize`
3. 所有技能立即可用

## 安全性

- Token 仅存储在本地 `~/.anyskill/config.json`，不会传输给第三方。
- 所有通信通过 HTTPS 和 GitHub 官方 API。
- 技能仓库完全由你掌控。

## License

[MIT](https://github.com/lanyijianke/AnySkill/blob/main/LICENSE)
