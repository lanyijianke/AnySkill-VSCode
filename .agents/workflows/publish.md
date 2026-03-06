---
description: 发布 AnySkill VS Code 扩展新版本到 Open VSX 并提交到 GitHub
---

// turbo-all

## 发布流程

1. 确认当前代码已编译通过：
```bash
cd /Users/grank/AnySkill-Projcet/AnySkill-VSCode && npm run compile
```

2. 读取 `package.json` 中当前的 `version` 字段，在其基础上 patch +1（如 0.4.4 → 0.4.5），然后更新 `package.json`

3. 重新编译并打包：
```bash
cd /Users/grank/AnySkill-Projcet/AnySkill-VSCode && npm run compile && npx -y @vscode/vsce package --no-dependencies
```

4. 发布到 Open VSX：
```bash
cd /Users/grank/AnySkill-Projcet/AnySkill-VSCode && npx -y ovsx publish anyskill-{新版本号}.vsix -p $(cat .ovsx_token)
```

5. 提交到 GitHub：
```bash
cd /Users/grank/AnySkill-Projcet/AnySkill-VSCode && git add -A && git commit -m "release: v{新版本号}" && git push origin main
```

6. 告知用户发布结果，包含版本号和 Open VSX 链接：
   https://open-vsx.org/extension/anyskill/anyskill
