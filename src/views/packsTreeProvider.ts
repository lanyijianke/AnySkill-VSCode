import * as vscode from 'vscode';
import { PackEntry, SkillEntry, GitHubClient } from '../github';
import { discoverConfig, getToken } from '../config';

export class PackCategoryItem extends vscode.TreeItem {
    constructor(public readonly pack: PackEntry) {
        super(pack.category, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'pack';

        // Map category names to display names and icons
        const displayMap: Record<string, { label: string; icon: string }> = {
            'core-enhancement': { label: '核心增强', icon: 'lightbulb' },
            'tech-development': { label: '技术开发', icon: 'code' },
            'content-creation': { label: '内容创作', icon: 'edit' },
            'data-crawling': { label: '数据采集', icon: 'search' },
            'communication': { label: '通信集成', icon: 'comment-discussion' },
        };

        const display = displayMap[pack.category] || { label: pack.category, icon: 'package' };
        this.label = display.label;
        this.iconPath = new vscode.ThemeIcon(display.icon);
        this.description = `${pack.skills.length} 个技能`;
    }
}

export class PackSkillItem extends vscode.TreeItem {
    constructor(
        public readonly skill: SkillEntry,
        public readonly category: string
    ) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = skill.description || skill.name;
        this.description = skill.description
            ? (skill.description.length > 40
                ? skill.description.substring(0, 40) + '...'
                : skill.description)
            : '';
        this.contextValue = 'packSkill';
        this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
}

export class PacksTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private packs: PackEntry[] = [];

    constructor() { }

    refresh(): void {
        this.packs = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element) {
            if (element instanceof PackCategoryItem) {
                return element.pack.skills.map(
                    (skill) => new PackSkillItem(skill, element.pack.category)
                );
            }
            return [];
        }

        // Root level: load packs from public repo
        try {
            const config = discoverConfig();
            const token = config ? getToken(config) : undefined;
            const client = new GitHubClient('', 'main', token);
            const index = await client.fetchPacksIndex();
            this.packs = index.packs;

            if (this.packs.length === 0) {
                const item = new vscode.TreeItem('暂无组合包');
                item.iconPath = new vscode.ThemeIcon('info');
                return [item];
            }

            return this.packs.map((pack) => new PackCategoryItem(pack));
        } catch (err: any) {
            const item = new vscode.TreeItem(`加载失败: ${err.message}`);
            item.iconPath = new vscode.ThemeIcon('error');
            item.iconPath = new vscode.ThemeIcon('error');
            return [item];
        }
    }

    getPacks(): PackEntry[] {
        return this.packs;
    }
}
