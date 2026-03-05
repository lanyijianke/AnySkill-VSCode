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

export function activate(context: vscode.ExtensionContext) {
    console.log('AnySkill extension is now active!');

    // Set configured context for welcome view
    const config = discoverConfig();
    vscode.commands.executeCommand('setContext', 'anyskill.configured', !!config);

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
