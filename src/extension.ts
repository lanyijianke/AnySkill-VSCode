import * as vscode from 'vscode';
import { SkillsTreeProvider, SkillTreeItem, CategoryItem } from './views/skillsTreeProvider';
import { PacksTreeProvider, PackCategoryItem, PackSkillItem } from './views/packsTreeProvider';
import { createSkillDetailPanel } from './views/skillDetailPanel';
import { initCommand } from './commands/init';
import {
    loadSkillCommand,
    downloadSkillCommand,
    downloadCategoryCommand,
    syncAllCommand,
    uploadSkillCommand,
    deleteSkillCommand,
    importSkillCommand,
    createFolderCommand,
    deleteFolderCommand,
    moveSkillCommand,
    pushSkillFromProjectCommand,
    pullSkillFromCloudCommand,
    setupCloudEditListener,
} from './commands/skills';
import { installPackCommand } from './commands/packs';
import { checkUpdateCommand } from './commands/version';
import { discoverConfig } from './config';

export function activate(context: vscode.ExtensionContext) {
    console.log('AnySkill extension is now active!');

    // Set configured context for welcome view
    const config = discoverConfig();
    vscode.commands.executeCommand('setContext', 'anyskill.configured', !!config);

    // Setup cloud editor save listener
    setupCloudEditListener(context);

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
    statusBarItem.tooltip = 'AnySkill Skill Manager | 技能管理';
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
                // Pack skills should use the packs install flow (fetches from AnySkill-Packs public repo)
                installPackCommand(arg);
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
        vscode.commands.registerCommand('anyskill.viewSkillDetail', (arg?: SkillTreeItem | PackSkillItem) => {
            if (arg instanceof SkillTreeItem) {
                createSkillDetailPanel(context, arg.skill);
            } else if (arg instanceof PackSkillItem) {
                createSkillDetailPanel(context, arg.skill, true);
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

    // Download category folder (Mode 3b)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.downloadCategory', (arg?: CategoryItem) => {
            downloadCategoryCommand(arg);
        })
    );

    // Move skill (Mode 10c)
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.moveSkill', (arg?: SkillTreeItem) => {
            moveSkillCommand(arg);
        })
    );

    // Push skill from project to cloud
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.pushSkill', (uri?: vscode.Uri) => {
            pushSkillFromProjectCommand(uri);
        })
    );

    // Pull skill from cloud to project
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.pullSkill', (uri?: vscode.Uri) => {
            pullSkillFromCloudCommand(uri);
        })
    );

    // Welcome page
    context.subscriptions.push(
        vscode.commands.registerCommand('anyskill.welcome', () => {
            vscode.window.showInformationMessage(
                'AnySkill — Your Personal AI Skill Library',
                'Initialize | 初始化配置',
                'Import Skills | 导入已有技能',
                'Docs | 查看文档'
            ).then((action) => {
                if (action === 'Initialize | 初始化配置') { vscode.commands.executeCommand('anyskill.init'); }
                if (action === 'Import Skills | 导入已有技能') { vscode.commands.executeCommand('anyskill.importSkill'); }
                if (action === 'Docs | 查看文档') { vscode.env.openExternal(vscode.Uri.parse('https://github.com/lanyijianke/AnySkill')); }
            });
        })
    );
}

export function deactivate() {
    console.log('AnySkill extension deactivated');
}
