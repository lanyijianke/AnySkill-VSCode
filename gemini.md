# AnySkill VS Code Extension

AnySkill 的 VS Code 扩展，提供 GUI 化的技能管理界面。

## 技术栈

- **语言**: TypeScript
- **打包**: esbuild
- **依赖**: simple-git, @vscode/codicons
- **发布**: Open VSX (ovsx)

## 常用命令

```bash
npm run compile     # 编译
npm run watch       # 监听模式
npm run package     # 生产构建（minify）
```

## 发布流程

使用 `.agents/workflows/publish.md` 工作流发布新版本。

// turbo-all

1. 在 `package.json` 中更新 `version` 字段
2. 执行 `npm run compile` 确认编译通过
3. 执行 `npx -y @vscode/vsce package --no-dependencies` 打包 `.vsix`
4. 执行 `npx -y ovsx publish anyskill-{version}.vsix -p $(cat .ovsx_token)` 发布到 Open VSX
5. 执行 `git add -A && git commit -m "release: v{version}" && git push origin main` 提交到 GitHub

## 项目结构

```
src/
  extension.ts          # 入口，注册所有命令
  config.ts             # 配置发现（全局 ~/.anyskill/config.json）
  github.ts             # GitHub API 客户端
  git.ts                # Git 操作封装
  commands/
    init.ts             # 初始化配置
    skills.ts           # 技能 CRUD 命令
    packs.ts            # 组合包安装
    version.ts          # 版本检查
  views/
    skillsTreeProvider.ts   # 我的技能树
    packsTreeProvider.ts    # 组合包树
    skillDetailPanel.ts     # 技能预览 Webview
```

## 注意事项

- `.ovsx_token` 已在 `.gitignore` 中，不要提交到仓库
- GitHub Actions 发布使用 `secrets.OVSX_TOKEN`
- 打包时使用 `--no-dependencies`，运行时通过 esbuild bundle 内联依赖
