import * as vscode from 'vscode';
import { SkillsTreeProvider, SkillTreeItem, CategoryItem } from './views/skillsTreeProvider';
import { PacksTreeProvider, PackCategoryItem, PackSkillItem } from './views/packsTreeProvider';
import { createSkillDetailPanel } from './views/skillDetailPanel';
import { initCommand } from './commands/init';
import {
    loadSkillCommand,
    downloadSkillCommand,
    syncAllCommand,
    uploadSkillCommand,
    deleteSkillCommand,
    importSkillCommand,
    createFolderCommand,
    deleteFolderCommand,
    moveSkillCommand,
} from './commands/skills';
import { installPackCommand } from './commands/packs';
import { checkUpdateCommand } from './commands/version';
import { discoverConfig } from './config';
import { addCommitPush } from './git';

export function activate(context: vscode.ExtensionContext) {
    console.log('AnySkill extension is now active!');

    // Set configured context for welcome view
    const config = discoverConfig();
    vscode.commands.executeCommand('setContext', 'anyskill.configured', !!config);

    // Auto-repair: ensure generate-index.js exists if CI workflow is present
    if (config?.localPath) {
        autoRepairRepo(config.localPath, config.branch).catch(() => { });
    }

    // ── TreeView Providers ─────────────────────
    const skillsProvider = new SkillsTreeProvider();
    const packsProvider = new PacksTreeProvider();

    const skillsTreeView = vscode.window.createTreeView('anyskillSkills', {
        treeDataProvider: skillsProvider,
    });
    context.subscriptions.push(skillsTreeView);
    vscode.window.registerTreeDataProvider('anyskillPacks', packsProvider);

    // ── Status Bar ─────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.text = '$(brain) AnySkill';
    statusBarItem.tooltip = 'AnySkill 技能管理';
    statusBarItem.command = 'anyskill.init';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // ── Register Commands ──────────────────────

    // Init
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.init', initCommand)
    );

    // Refresh
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.refreshSkills', () => {
            skillsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.refreshPacks', () => {
            packsProvider.refresh();
        })
    );

    // Load skill (Mode 1)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.loadSkill', (arg?: SkillTreeItem) => {
            loadSkillCommand(arg);
        })
    );

    // Download skill (Mode 2)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.downloadSkill', (arg?: SkillTreeItem | PackSkillItem) => {
            if (arg instanceof PackSkillItem) {
                // For pack skills, treat as downloading from packs
                downloadSkillCommand(arg.skill);
            } else {
                downloadSkillCommand(arg);
            }
        })
    );

    // Sync all (Mode 3)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.syncAll', syncAllCommand)
    );

    // Upload skill (Mode 4)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.uploadSkill', uploadSkillCommand)
    );

    // Delete skill (Mode 7)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.deleteSkill', (arg?: SkillTreeItem) => {
            deleteSkillCommand(arg);
        })
    );

    // View skill detail (Webview)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.viewSkillDetail', (arg?: SkillTreeItem) => {
            if (arg instanceof SkillTreeItem) {
                createSkillDetailPanel(context, arg.skill);
            }
        })
    );

    // Install pack (Mode 9)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.installPack', (arg?: PackCategoryItem | PackSkillItem) => {
            installPackCommand(arg);
        })
    );

    // Check update
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.checkUpdate', checkUpdateCommand)
    );

    // Import existing skill
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.importSkill', importSkillCommand)
    );

    // Create folder (Mode 10a)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.createFolder', createFolderCommand)
    );

    // Delete folder (Mode 10b)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.deleteFolder', (arg?: CategoryItem) => {
            deleteFolderCommand(arg);
        })
    );

    // Move skill (Mode 10c)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.moveSkill', (arg?: SkillTreeItem) => {
            moveSkillCommand(arg);
        })
    );

    // Welcome page
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.welcome', () => {
            vscode.window.showInformationMessage(
                'AnySkill — 你的私人 AI 技能空间',
                '初始化配置',
                '导入已有技能',
                '查看文档'
            ).then((action) => {
                if (action === '初始化配置') { vscode.commands.executeCommand('anyskill.init'); }
                if (action === '导入已有技能') { vscode.commands.executeCommand('anyskill.importSkill'); }
                if (action === '查看文档') { vscode.env.openExternal(vscode.Uri.parse('https://github.com/lanyijianke/AnySkill')); }
            });
        })
    );

    // ── Silent Version Check on Activation ─────
    setTimeout(() => {
        // Run a silent version check 5 seconds after activation
        checkUpdateCommand().catch(() => { });
    }, 5000);
}

export function deactivate() {
    console.log('AnySkill extension deactivated');
}

/**
 * Auto-repair: if user's repo has .github/workflows/build-index.yml
 * but is missing generate-index.js, download it from the AnySkill template repo.
 */
async function autoRepairRepo(localPath: string, branch: string = 'main'): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    const workflowPath = path.join(localPath, '.github', 'workflows', 'build-index.yml');
    const scriptPath = path.join(localPath, 'generate-index.js');

    // Only repair if workflow exists but script is missing
    if (!fs.existsSync(workflowPath) || fs.existsSync(scriptPath)) {
        return;
    }

    console.log('[AnySkill] Auto-repair: generate-index.js is missing, downloading...');

    try {
        const https = await import('https');
        const url = 'https://raw.githubusercontent.com/lanyijianke/AnySkill/main/generate-index.js';

        const content = await new Promise<string>((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'AnySkill-VSCode' } }, (res: any) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    https.get(res.headers.location, (r2: any) => {
                        const chunks: Buffer[] = [];
                        r2.on('data', (c: Buffer) => chunks.push(c));
                        r2.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
                        r2.on('error', reject);
                    });
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
                res.on('error', reject);
            });
        });

        fs.writeFileSync(scriptPath, content, 'utf-8');

        // Commit and push silently
        await addCommitPush(localPath, 'fix: auto-add generate-index.js for CI', branch);
        console.log('[AnySkill] Auto-repair: generate-index.js added successfully');
    } catch (err) {
        console.log('[AnySkill] Auto-repair failed:', err);
    }
}
