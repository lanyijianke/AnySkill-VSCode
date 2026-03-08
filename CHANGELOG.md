# Changelog | 更新日志

## v0.5.0 — 2025-03-08

### 🚀 New Features | 新功能

- **Cloud Editor | 云端编辑器**: Click a skill → edit directly → auto-push on save (`Cmd+S`). No more read-only previews.
  点击技能 → 直接编辑 → 保存即推送到云端。不再是只读预览。

- **Pull from Cloud | 从云端更新**: Right-click a local `SKILL.md` → "Pull from Cloud" to fetch the latest version.
  右键本地 `SKILL.md` → "从云端更新"拉取最新版本。

- **Push to Cloud (right-click) | 右键推送**: Right-click a `SKILL.md` → "Push Skill to Cloud" — no more picker popup.
  右键 `SKILL.md` → "推送技能到云端"——不再弹出选择框。

- **Version Conflict Detection | 版本冲突检测**: All push/pull/cloud-edit operations compare local vs cloud content. If different, shows a diff view to let you choose.
  所有推送/拉取/云端编辑操作都会对比本地与云端内容。不一致时弹出 diff 视图让你选择。

- **Codex IDE Support**: `.codex/skills/` is now a recognized skill directory.
  新增 Codex IDE 支持，识别 `.codex/skills/` 目录。

### ⚡ Improvements | 改进

- **No more local Git clone | 移除本地克隆**: Initialization is instant — no Git required.
  初始化瞬间完成，不再需要 Git 克隆。

- **GitHub API for all writes | 全部写操作改用 GitHub API**: Upload, delete, move, create folder — all via API, no local repo.
  上传、删除、移动、创建分类——全部通过 API，无需本地仓库。

- **Private repo support | 私有仓库支持**: Switched from `raw.githubusercontent.com` to GitHub API for authentication.
  从 `raw.githubusercontent.com` 切换到 GitHub API，正确支持私有仓库认证。

- **Bundle size reduced 63% | 包体积减少 63%**: Removed `simple-git` dependency, down from 249KB to 93KB.
  移除 `simple-git` 依赖，从 249KB 降到 93KB。

- **Save debounce | 保存防抖**: Rapid saves are debounced (500ms) to prevent API conflicts.
  快速连续保存会防抖（500ms），避免 API 冲突。

### 🔧 Bug Fixes | 修复

- Fixed HTTP 404 when loading skills from private repositories.
  修复私有仓库加载技能时 HTTP 404 的问题。

- Fixed HTTP 409 when saving cloud editor files rapidly.
  修复快速保存云端编辑器文件时 HTTP 409 的问题。

---

## v0.4.x

- Initial release with local Git clone architecture.
  初始版本，基于本地 Git 克隆架构。
