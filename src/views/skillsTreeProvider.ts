import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SkillEntry, GitHubClient } from '../github';
import { AnySkillConfig, discoverConfig, getToken } from '../config';
import { gitPull, gitClone, getDefaultLocalPath } from '../git';

export class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skill: SkillEntry,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(skill.name, collapsibleState);
        this.id = `skill:${skill.path || skill.name}`;
        this.tooltip = skill.description || skill.name;
        this.description = skill.description
            ? (skill.description.length > 60
                ? skill.description.substring(0, 57) + '...'
                : skill.description)
            : '';
        this.contextValue = 'skill';
        this.iconPath = new vscode.ThemeIcon('symbol-method');

        // Double-click to view detail
        this.command = {
            command: 'anyskill.viewSkillDetail',
            title: 'View Skill Detail | 查看技能详情',
            arguments: [this],
        };
    }
}

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly categoryName: string,
        public readonly skills: SkillEntry[]
    ) {
        super(categoryName, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `category:${categoryName}`;
        this.tooltip = `Category: ${categoryName} (${skills.length} skills) | 分类: ${categoryName} (${skills.length} 个技能)`;
        this.description = `${skills.length} skills`;
        this.contextValue = 'category';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export class SkillFileItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public readonly skillName: string
    ) {
        const fileName = filePath.split('/').pop() || filePath;
        super(fileName, vscode.TreeItemCollapsibleState.None);
        this.id = `file:${skillName}:${filePath}`;
        this.tooltip = filePath;
        this.description = filePath;
        this.contextValue = 'skillFile';
        this.iconPath = new vscode.ThemeIcon(
            filePath.endsWith('.md') ? 'markdown' : 'file'
        );
    }
}

export class SkillsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private skills: SkillEntry[] = [];
    private loadError: string | null = null;

    // Singleton for access from command handlers
    private static _instance: SkillsTreeProvider;
    static get instance(): SkillsTreeProvider { return SkillsTreeProvider._instance; }

    constructor() {
        SkillsTreeProvider._instance = this;
    }

    refresh(): void {
        this.skills = [];
        this.loadError = null;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element) {
            // Children of a category = its skills
            if (element instanceof CategoryItem) {
                return element.skills.map(
                    (skill) =>
                        new SkillTreeItem(
                            skill,
                            skill.files.length > 1
                                ? vscode.TreeItemCollapsibleState.Collapsed
                                : vscode.TreeItemCollapsibleState.None
                        )
                );
            }
            // Children of a skill = its files
            if (element instanceof SkillTreeItem) {
                return element.skill.files.map(
                    (f) => new SkillFileItem(f, element.skill.name)
                );
            }
            return [];
        }

        // Root level: load skills
        const config = discoverConfig();
        if (!config) {
            const item = new vscode.TreeItem('Click to initialize AnySkill | 点击初始化 AnySkill');
            item.command = {
                command: 'anyskill.init',
                title: 'Initialize | 初始化',
            };
            item.iconPath = new vscode.ThemeIcon('gear');
            return [item];
        }

        const localPath = config.localPath || getDefaultLocalPath();

        try {
            // If local clone exists, read from it (fast, instant)
            if (fs.existsSync(path.join(localPath, '.git'))) {
                // Pull latest (silent, non-blocking for tree display)
                try { gitPull(localPath); } catch { /* offline is OK */ }

                return this.loadFromLocal(localPath);
            }

            // No local clone — try auto-clone
            if (config.token) {
                try {
                    const repoUrl = `https://${config.token}@github.com/${config.repo}.git`;
                    gitClone(repoUrl, localPath);

                    // Save localPath to config
                    const { saveGlobalConfig } = await import('../config');
                    saveGlobalConfig({ ...config, localPath });

                    return this.loadFromLocal(localPath);
                } catch (cloneErr: any) {
                    // Clone failed, fall back to API
                }
            }

            // Fallback: load from API (for users without git or first-time)
            return await this.loadFromAPI(config);
        } catch (err: any) {
            this.loadError = err.message;
            const item = new vscode.TreeItem(`Load failed | 加载失败: ${err.message}`);
            item.iconPath = new vscode.ThemeIcon('error');
            return [item];
        }
    }

    /**
     * Load skills from local git clone directory.
     */
    private loadFromLocal(localPath: string): vscode.TreeItem[] {
        const skillsDir = path.join(localPath, 'skills');
        if (!fs.existsSync(skillsDir)) {
            const item = new vscode.TreeItem('No skills yet, click to upload | 暂无技能，点击上传');
            item.iconPath = new vscode.ThemeIcon('add');
            item.command = { command: 'anyskill.uploadSkill', title: 'Upload Skill | 上传技能' };
            return [item];
        }

        this.skills = [];
        this.findSkillsRecursive(skillsDir, skillsDir, this.skills);
        const localCategories = this.getCategories(localPath);
        this.loadError = null;

        if (this.skills.length === 0 && localCategories.length === 0) {
            const item = new vscode.TreeItem('No skills yet, click to upload | 暂无技能，点击上传');
            item.iconPath = new vscode.ThemeIcon('add');
            item.command = { command: 'anyskill.uploadSkill', title: 'Upload Skill | 上传技能' };
            return [item];
        }

        return this.buildTree(this.skills, localCategories);
    }

    /**
     * Fallback: load skills from GitHub API (no local clone).
     */
    private async loadFromAPI(config: AnySkillConfig): Promise<vscode.TreeItem[]> {
        const token = getToken(config);
        const client = new GitHubClient(config.repo, config.branch, token);
        this.skills = await client.fetchIndex();
        this.loadError = null;

        if (this.skills.length === 0) {
            const item = new vscode.TreeItem('No skills yet, click to upload | 暂无技能，点击上传');
            item.iconPath = new vscode.ThemeIcon('add');
            item.command = { command: 'anyskill.uploadSkill', title: 'Upload Skill | 上传技能' };
            return [item];
        }

        return this.buildTree(this.skills);
    }

    /**
     * Build the tree: group skills by category.
     * Skills with a category become children of CategoryItem nodes.
     * Skills without a category appear at root level.
     */
    private buildTree(skills: SkillEntry[], remoteCategories: string[] = []): vscode.TreeItem[] {
        const categories = new Map<string, SkillEntry[]>();
        const uncategorized: SkillEntry[] = [];

        for (const skill of skills) {
            if (skill.category) {
                const list = categories.get(skill.category) || [];
                list.push(skill);
                categories.set(skill.category, list);
            } else {
                uncategorized.push(skill);
            }
        }

        // Merge remote categories + optimistic folders so empty folders are visible immediately.
        // Safety net: also exclude any directory matching a known skill folder name,
        // even if the stale index.json shows it under a different category.
        const allSkillFolderNames = new Set(
            skills.map(s => {
                const parts = (s.path || s.name).split('/');
                return parts[parts.length - 1];
            })
        );
        const allRemote = [...remoteCategories];
        for (const cat of allRemote) {
            if (!categories.has(cat) && !allSkillFolderNames.has(cat)) {
                categories.set(cat, []);
            }
        }

        const items: vscode.TreeItem[] = [];

        // Add category nodes (sorted)
        const sortedCategories = [...categories.keys()].sort();
        for (const cat of sortedCategories) {
            items.push(new CategoryItem(cat, categories.get(cat)!));
        }

        // Add uncategorized skills at root
        for (const skill of uncategorized) {
            items.push(
                new SkillTreeItem(
                    skill,
                    skill.files.length > 1
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None
                )
            );
        }

        return items;
    }

    /**
     * Scan local skills/ directory to build skill entries directly.
     * Supports both flat and nested (categorized) layouts.
     */
    private scanLocalSkills(localPath: string): SkillEntry[] {
        const skillsDir = path.join(localPath, 'skills');
        if (!fs.existsSync(skillsDir)) {
            return [];
        }

        const results: SkillEntry[] = [];

        try {
            this.findSkillsRecursive(skillsDir, skillsDir, results);
        } catch {
            return [];
        }

        return results.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Recursively find skills (directories containing SKILL.md).
     * If a directory has SKILL.md, it's a skill. Otherwise, it might be a category folder.
     */
    private findSkillsRecursive(dir: string, baseDir: string, results: SkillEntry[]): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) { continue; }
            if (entry.name === '.git' || entry.name === '.gitkeep') { continue; }

            const fullPath = path.join(dir, entry.name);
            const skillMdPath = path.join(fullPath, 'SKILL.md');

            if (fs.existsSync(skillMdPath)) {
                // This IS a skill
                try {
                    const content = fs.readFileSync(skillMdPath, 'utf-8');
                    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
                    let name = entry.name;
                    let description = '';

                    if (fmMatch) {
                        for (const line of fmMatch[1].split('\n')) {
                            const i = line.indexOf(':');
                            if (i === -1) { continue; }
                            const key = line.substring(0, i).trim();
                            const value = line.substring(i + 1).trim().replace(/^["']|["']$/g, '');
                            if (key === 'name') { name = value; }
                            if (key === 'description') { description = value; }
                        }
                    }

                    const relPath = path.relative(baseDir, fullPath);
                    const segments = relPath.split(path.sep);
                    const skillName = segments.pop() || entry.name;
                    const category = segments.join('/');

                    const files = this.collectFiles(fullPath, baseDir);

                    results.push({
                        name,
                        description,
                        category,
                        path: relPath,
                        file: `${relPath}/SKILL.md`,
                        files,
                    });
                } catch {
                    // skip broken skill
                }
            } else {
                // Not a skill — might be a category folder, recurse
                this.findSkillsRecursive(fullPath, baseDir, results);
            }
        }
    }

    /**
     * Recursively collect all files in a directory, returning paths relative to baseDir.
     */
    private collectFiles(dir: string, baseDir: string): string[] {
        const results: string[] = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === '.gitkeep' || entry.name === '.DS_Store') { continue; }
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...this.collectFiles(fullPath, baseDir));
                } else {
                    results.push(path.relative(baseDir, fullPath));
                }
            }
        } catch { }
        return results;
    }

    getSkills(): SkillEntry[] {
        return this.skills;
    }

    /**
     * Get list of category folder names from the local skills/ directory.
     */
    getCategories(localPath: string): string[] {
        const skillsDir = path.join(localPath, 'skills');
        if (!fs.existsSync(skillsDir)) { return []; }

        const categories: string[] = [];
        try {
            const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) { continue; }
                if (entry.name === '.git') { continue; }
                const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
                if (!fs.existsSync(skillMd)) {
                    // No SKILL.md = this is a category folder
                    categories.push(entry.name);
                }
            }
        } catch { }
        return categories.sort();
    }
}
