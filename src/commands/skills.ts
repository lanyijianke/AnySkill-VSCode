import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { discoverConfig, getToken } from '../config';
import { GitHubClient, SkillEntry } from '../github';
import { addCommitPush, removeAndPush, pullLatest } from '../git';
import { SkillTreeItem, CategoryItem, SkillsTreeProvider } from '../views/skillsTreeProvider';

/**
 * Get a GitHubClient from current config, or throw.
 */
function getClient(): { client: GitHubClient; config: ReturnType<typeof discoverConfig> } {
    const config = discoverConfig();
    if (!config) {
        throw new Error('Please run "AnySkill: Initialize" first | 请先运行初始化配置');
    }
    const token = getToken(config);
    return { client: new GitHubClient(config.repo, config.branch, token), config };
}

/**
 * Resolve a skill from either a SkillTreeItem argument or a QuickPick selection.
 */
async function resolveSkill(arg?: SkillTreeItem | SkillEntry): Promise<SkillEntry | undefined> {
    if (arg instanceof SkillTreeItem) {
        return arg.skill;
    }
    if (arg && 'name' in arg && 'file' in arg) {
        return arg as SkillEntry;
    }

    // No argument: let user pick
    const { client } = getClient();
    const skills = await client.fetchIndex();

    if (skills.length === 0) {
        vscode.window.showInformationMessage('No skills yet | 暂无技能');
        return undefined;
    }

    const items = skills.map((s) => ({
        label: s.name,
        description: s.description,
        skill: s,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        title: 'AnySkill: Select Skill | 选择技能',
        placeHolder: 'Search skills... | 搜索技能...',
    });

    return picked?.skill;
}

/**
 * Mode 1 — Load skill content into editor (memory only)
 */
export async function loadSkillCommand(arg?: SkillTreeItem | SkillEntry): Promise<void> {
    try {
        const skill = await resolveSkill(arg);
        if (!skill) { return; }

        const { client } = getClient();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Loading ${skill.name}... | 正在加载...`,
            },
            async () => {
                const content = await client.fetchFileContent(skill.file);
                const doc = await vscode.workspace.openTextDocument({
                    content,
                    language: 'markdown',
                });
                await vscode.window.showTextDocument(doc, { preview: true });
                vscode.window.showInformationMessage(`Loaded ${skill.name} | 已加载到编辑器`);
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`Load failed | 加载失败: ${err.message}`);
    }
}

/**
 * Mode 2 — Download single skill to local IDE skill directory
 */
export async function downloadSkillCommand(arg?: SkillTreeItem | SkillEntry): Promise<void> {
    try {
        const skill = await resolveSkill(arg);
        if (!skill) { return; }

        const { client } = getClient();

        // Determine the local download path
        const skillDir = await determineSkillDir(skill.name);
        if (!skillDir) { return; }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Downloading ${skill.name}... | 正在下载...`,
                cancellable: false,
            },
            async (progress) => {
                let downloaded = 0;
                for (const file of skill.files) {
                    progress.report({
                        message: `${downloaded + 1}/${skill.files.length}: ${file}`,
                        increment: (1 / skill.files.length) * 100,
                    });

                    const content = await client.fetchFileContent(file);
                    const targetPath = path.join(skillDir, ...file.split('/').slice(1)); // Remove skill folder prefix
                    const targetDir = path.dirname(targetPath);

                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    fs.writeFileSync(targetPath, content, 'utf-8');
                    downloaded++;
                }

                vscode.window.showInformationMessage(
                    `${skill.name} downloaded to ${skillDir} (${downloaded} files) | 已下载 ${downloaded} 个文件`
                );
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`Download failed | 下载失败: ${err.message}`);
    }
}

/**
 * Mode 3 — Sync all skills to local IDE directory
 */
export async function syncAllCommand(): Promise<void> {
    try {
        const { client } = getClient();

        const skills = await client.fetchIndex();
        if (skills.length === 0) {
            vscode.window.showInformationMessage('No skills in cloud | 云端暂无技能');
            return;
        }

        const confirm = await vscode.window.showInformationMessage(
            `Download ${skills.length} skills to local? | 即将下载 ${skills.length} 个技能，继续？`,
            'Download | 下载',
            'Cancel | 取消'
        );

        if (confirm !== 'Download | 下载') {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing all skills... | 正在同步...',
                cancellable: true,
            },
            async (progress, cancelToken) => {
                let completed = 0;
                let failed = 0;

                for (const skill of skills) {
                    if (cancelToken.isCancellationRequested) { break; }

                    progress.report({
                        message: `${completed + 1}/${skills.length}: ${skill.name}`,
                        increment: (1 / skills.length) * 100,
                    });

                    try {
                        const skillDir = await determineSkillDir(skill.name, false);
                        if (!skillDir) { continue; }

                        for (const file of skill.files) {
                            const content = await client.fetchFileContent(file);
                            const targetPath = path.join(skillDir, ...file.split('/').slice(1));
                            const targetDir = path.dirname(targetPath);

                            if (!fs.existsSync(targetDir)) {
                                fs.mkdirSync(targetDir, { recursive: true });
                            }
                            fs.writeFileSync(targetPath, content, 'utf-8');
                        }
                        completed++;
                    } catch {
                        failed++;
                    }
                }

                vscode.window.showInformationMessage(
                    `Sync complete! ${completed} succeeded${failed > 0 ? `, ${failed} failed` : ''} | 同步完成！成功 ${completed} 个${failed > 0 ? `，失败 ${failed} 个` : ''}`
                );
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`Sync failed | 同步失败: ${err.message}`);
    }
}

/**
 * Mode 4 — Upload skill to cloud repo
 */
export async function uploadSkillCommand(): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('Please run "AnySkill: Initialize" first | 请先初始化');
            return;
        }

        // Ask for skill name
        const skillName = await vscode.window.showInputBox({
            title: 'AnySkill: New Skill | 新建技能',
            prompt: 'Enter skill name | 输入技能名称',
            placeHolder: 'e.g. frontend-design or web-scraper',
            ignoreFocusOut: true,
            validateInput: (v) => v ? null : 'Please enter a name | 请输入名称',
        });

        if (!skillName) { return; }

        // Ask for description
        const description = await vscode.window.showInputBox({
            title: 'AnySkill: Skill Description | 技能描述',
            prompt: 'Brief description | 简要描述用途',
            placeHolder: 'e.g. Modern frontend design guidelines',
            ignoreFocusOut: true,
        });

        // Check for existing category folders and ask user
        let targetCategory = '';
        const skillsProvider = new SkillsTreeProvider();
        const categories = skillsProvider.getCategories(config.localPath);

        if (categories.length > 0) {
            const categoryItems = [
                { label: '$(symbol-folder) No category | 不分类', description: 'Root skills/ folder', value: '' },
                ...categories.map(c => ({
                    label: `$(folder) ${c}`,
                    description: `放入 skills/${c}/`,
                    value: c,
                })),
            ];

            const picked = await vscode.window.showQuickPick(categoryItems, {
                title: 'AnySkill: Select Category | 选择分类',
                placeHolder: 'Which folder? | 放入哪个分类？',
            });

            if (picked === undefined) { return; } // user cancelled
            targetCategory = picked.value;
        }

        // Create SKILL.md template
        const skillMd = `---
name: ${skillName}
description: ${description || ''}
---

# ${skillName}

<!-- Write your skill content below, save and click "Push to Cloud" to upload | 在下方编写技能内容 -->

`;

        // Create files locally
        const skillDir = targetCategory
            ? path.join(config.localPath, 'skills', targetCategory, skillName)
            : path.join(config.localPath, 'skills', skillName);

        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        const skillFile = path.join(skillDir, 'SKILL.md');
        fs.writeFileSync(skillFile, skillMd, 'utf-8');

        // Open in editor for the user to write content
        const doc = await vscode.workspace.openTextDocument(skillFile);
        await vscode.window.showTextDocument(doc);

        // Refresh sidebar immediately (local scan will pick it up)
        vscode.commands.executeCommand('anyskill.refreshSkills');

        // Prompt to push
        const locationHint = targetCategory ? ` (${targetCategory})` : '';
        const action = await vscode.window.showInformationMessage(
            `Skill "${skillName}"${locationHint} created. Push when ready | 技能已创建`,
            'Push to Cloud | 推送到云端',
            'Later | 稍后推送'
        );

        if (action === 'Push to Cloud | 推送到云端') {
            // Ensure infra files exist
            await ensureInfraFiles(config);

            // Git add, commit, push
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Uploading ${skillName}... | 正在上传...`,
                },
                async () => {
                    await addCommitPush(
                        config.localPath,
                        `feat: add skill ${skillName}`,
                        config.branch
                    );
                }
            );

            vscode.window.showInformationMessage(`Skill "${skillName}" pushed! | 已推送到云端`);

            // Refresh
            vscode.commands.executeCommand('anyskill.refreshSkills');
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Upload failed | 上传失败: ${err.message}`);
    }
}

/**
 * Mode 7 — Delete a skill from cloud repo
 */
export async function deleteSkillCommand(arg?: SkillTreeItem | SkillEntry): Promise<void> {
    try {
        const skill = await resolveSkill(arg);
        if (!skill) { return; }

        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('Please initialize AnySkill first | 请先初始化');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete skill "${skill.name}"? This cannot be undone! | 即将删除，不可撤销！`,
            { modal: true },
            'Delete | 删除'
        );

        if (confirm !== 'Delete | 删除') {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Deleting ${skill.name}... | 正在删除...`,
            },
            async () => {
                // Use path field if available, otherwise fall back to file-based extraction
                const skillPath = skill.path || skill.file.split('/').slice(0, -1).join('/');
                const skillRelPath = `skills/${skillPath}`;
                const fullSkillPath = path.join(config.localPath, skillRelPath);

                // Pull latest first
                try {
                    await pullLatest(config.localPath, config.branch);
                } catch {
                    // ignore pull errors (e.g. nothing to pull)
                }

                // Remove via git
                try {
                    await removeAndPush(
                        config.localPath,
                        skillRelPath,
                        `feat: remove skill ${skill.name}`,
                        config.branch
                    );
                } catch {
                    // If git rm fails, try direct filesystem delete + manual push
                }

                // Fallback: ensure directory is really gone from filesystem
                if (fs.existsSync(fullSkillPath)) {
                    fs.rmSync(fullSkillPath, { recursive: true, force: true });
                    // Try to commit the deletion
                    try {
                        await addCommitPush(
                            config.localPath,
                            `feat: remove skill ${skill.name}`,
                            config.branch
                        );
                    } catch {
                        // ignore if nothing to commit
                    }
                }
            }
        );

        vscode.window.showInformationMessage(`Skill "${skill.name}" deleted | 已删除`);

        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Delete failed | 删除失败: ${err.message}`);
    }
}

/**
 * Determine where to place a downloaded skill in the current workspace
 */
async function determineSkillDir(skillName: string, askUser: boolean = true): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (askUser) {
            vscode.window.showWarningMessage('Please open a workspace first | 请先打开工作区');
        }
        return undefined;
    }

    const root = workspaceFolders[0].uri.fsPath;

    // Auto-detect IDE by existing directories
    if (fs.existsSync(path.join(root, '.agent'))) {
        return path.join(root, '.agent', 'skills', skillName);
    }
    if (fs.existsSync(path.join(root, '.claude'))) {
        return path.join(root, '.claude', 'skills', skillName);
    }
    if (fs.existsSync(path.join(root, '.cursor'))) {
        return path.join(root, '.cursor', 'rules', skillName);
    }

    if (!askUser) {
        // Default to .agent for VS Code
        return path.join(root, '.agent', 'skills', skillName);
    }

    // Ask user
    const picked = await vscode.window.showQuickPick(
        [
            { label: 'Antigravity (.agent/skills/)', value: path.join(root, '.agent', 'skills', skillName) },
            { label: 'Claude Code (.claude/skills/)', value: path.join(root, '.claude', 'skills', skillName) },
            { label: 'Cursor (.cursor/rules/)', value: path.join(root, '.cursor', 'rules', skillName) },
            { label: 'Custom path... | 自定义路径...', value: 'custom' },
        ],
        { title: 'Select skill location | 选择存放位置', placeHolder: 'VS Code environment detected' }
    );

    if (!picked) { return undefined; }

    if (picked.value === 'custom') {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select skill directory | 选择技能存放目录',
        });
        return uris ? path.join(uris[0].fsPath, skillName) : undefined;
    }

    return picked.value;
}

/**
 * Ensure infra files (generate-index.js, build-index.yml) exist in the local repo
 */
async function ensureInfraFiles(config: { localPath: string }): Promise<void> {
    const files = [
        {
            local: path.join(config.localPath, 'generate-index.js'),
            remote: 'https://raw.githubusercontent.com/lanyijianke/AnySkill/main/generate-index.js',
        },
        {
            local: path.join(config.localPath, '.github', 'workflows', 'build-index.yml'),
            remote: 'https://raw.githubusercontent.com/lanyijianke/AnySkill/main/.github/workflows/build-index.yml',
        },
    ];

    for (const file of files) {
        if (!fs.existsSync(file.local)) {
            try {
                const https = await import('https');
                const content = await new Promise<string>((resolve, reject) => {
                    https.get(file.remote, { headers: { 'User-Agent': 'AnySkill-VSCode' } }, (res: any) => {
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

                const dir = path.dirname(file.local);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(file.local, content, 'utf-8');
            } catch {
                // silently skip if download fails
            }
        }
    }
}

/**
 * Import existing skill from disk to AnySkill repo
 */
export async function importSkillCommand(): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('Please run "AnySkill: Initialize" first | 请先初始化');
            return;
        }

        // Let user choose: folder or file
        const choice = await vscode.window.showQuickPick(
            [
                {
                    label: 'Select skill folder | 选择技能文件夹',
                    description: 'Import entire folder with SKILL.md | 导入整个文件夹',
                    value: 'folder',
                },
                {
                    label: 'Select SKILL.md file | 选择 SKILL.md',
                    description: 'Import single skill file | 导入单个文件',
                    value: 'file',
                },
            ],
            { title: 'AnySkill: Import Skill | 导入技能', placeHolder: 'Choose import method | 选择导入方式' }
        );

        if (!choice) { return; }

        if (choice.value === 'folder') {
            // Pick a folder
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select skill folder (should contain SKILL.md) | 选择技能文件夹',
            });

            if (!uris || uris.length === 0) { return; }

            const sourceDir = uris[0].fsPath;
            const folderName = path.basename(sourceDir);

            // Check if SKILL.md exists
            const skillMdPath = path.join(sourceDir, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) {
                const createIt = await vscode.window.showWarningMessage(
                    `SKILL.md not found in "${folderName}". Create one? | 未找到 SKILL.md，是否创建？`,
                    'Create | 创建',
                    'Cancel | 取消'
                );
                if (createIt !== 'Create | 创建') { return; }

                const template = `---\nname: ${folderName}\ndescription: \n---\n\n# ${folderName}\n\n`;
                fs.writeFileSync(skillMdPath, template, 'utf-8');
            }

            // Copy entire folder to skills/
            const targetDir = path.join(config.localPath, 'skills', folderName);
            copyDirRecursive(sourceDir, targetDir);

            vscode.commands.executeCommand('anyskill.refreshSkills');

            const targetSkillMd = path.join(targetDir, 'SKILL.md');
            if (fs.existsSync(targetSkillMd)) {
                const doc = await vscode.workspace.openTextDocument(targetSkillMd);
                await vscode.window.showTextDocument(doc);
            }

            const action = await vscode.window.showInformationMessage(
                `Skill "${folderName}" imported (${countFiles(targetDir)} files). Push to cloud? | 已导入`,
                'Push to Cloud | 推送到云端',
                'Later | 稍后推送'
            );

            if (action === 'Push to Cloud | 推送到云端') {
                await pushSkill(config, folderName);
            }
        } else {
            // Pick a file
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Markdown': ['md'] },
                title: 'Select SKILL.md file | 选择 SKILL.md 文件',
            });

            if (!uris || uris.length === 0) { return; }

            const sourceFile = uris[0].fsPath;
            const content = fs.readFileSync(sourceFile, 'utf-8');

            // Extract name from frontmatter
            let skillName = path.basename(path.dirname(sourceFile));
            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (fmMatch) {
                for (const line of fmMatch[1].split('\n')) {
                    const i = line.indexOf(':');
                    if (i !== -1 && line.substring(0, i).trim() === 'name') {
                        skillName = line.substring(i + 1).trim().replace(/^["']|["']$/g, '');
                        break;
                    }
                }
            }

            const finalName = await vscode.window.showInputBox({
                title: 'Confirm skill name | 确认技能名称',
                value: skillName,
                prompt: 'Skill will be saved with this name | 技能将以此名称保存',
                ignoreFocusOut: true,
            });

            if (!finalName) { return; }

            const targetDir = path.join(config.localPath, 'skills', finalName);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            fs.copyFileSync(sourceFile, path.join(targetDir, 'SKILL.md'));

            vscode.commands.executeCommand('anyskill.refreshSkills');

            const doc = await vscode.workspace.openTextDocument(path.join(targetDir, 'SKILL.md'));
            await vscode.window.showTextDocument(doc);

            const action = await vscode.window.showInformationMessage(
                `Skill "${finalName}" imported. Push to cloud? | 已导入`,
                'Push to Cloud | 推送到云端',
                'Later | 稍后推送'
            );

            if (action === 'Push to Cloud | 推送到云端') {
                await pushSkill(config, finalName);
            }
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Import failed | 导入失败: ${err.message}`);
    }
}

async function pushSkill(config: any, skillName: string): Promise<void> {
    await ensureInfraFiles(config);
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Pushing ${skillName}... | 正在推送...` },
        async () => {
            await addCommitPush(config.localPath, `feat: add skill ${skillName}`, config.branch);
        }
    );
    vscode.window.showInformationMessage(`Skill "${skillName}" pushed! | 已推送到云端`);
    vscode.commands.executeCommand('anyskill.refreshSkills');
}

function copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) { fs.mkdirSync(dest, { recursive: true }); }
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (entry.name === '.DS_Store' || entry.name === '.git') { continue; }
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) { copyDirRecursive(s, d); }
        else { fs.copyFileSync(s, d); }
    }
}

function countFiles(dir: string): number {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.DS_Store') { continue; }
        n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
    }
    return n;
}

/**
 * Mode 10a — Create a category folder
 */
export async function createFolderCommand(): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('Please run "AnySkill: Initialize" first | 请先初始化');
            return;
        }

        const folderName = await vscode.window.showInputBox({
            title: 'AnySkill: New Category Folder | 新建分类文件夹',
            prompt: 'Enter folder name | 输入文件夹名称',
            placeHolder: 'e.g. core or dev',
            ignoreFocusOut: true,
            validateInput: (v) => v ? null : 'Please enter a name | 请输入名称',
        });

        if (!folderName) { return; }

        const folderPath = path.join(config.localPath, 'skills', folderName);
        if (fs.existsSync(folderPath)) {
            vscode.window.showWarningMessage(`Folder "${folderName}" already exists | 已存在`);
            return;
        }

        fs.mkdirSync(folderPath, { recursive: true });
        fs.writeFileSync(path.join(folderPath, '.gitkeep'), '', 'utf-8');

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Creating folder ${folderName}... | 正在创建...` },
            async () => {
                await addCommitPush(
                    config.localPath,
                    `feat: create category folder ${folderName}`,
                    config.branch
                );
            }
        );

        vscode.window.showInformationMessage(`Category folder "${folderName}" created | 已创建`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Create failed | 创建失败: ${err.message}`);
    }
}

/**
 * Mode 10b — Delete a category folder (must be empty)
 */
export async function deleteFolderCommand(arg?: CategoryItem): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('Please initialize AnySkill first | 请先初始化');
            return;
        }

        let folderName: string | undefined;

        if (arg instanceof CategoryItem) {
            folderName = arg.categoryName;
        } else {
            // Let user pick from existing category folders
            const sp = new SkillsTreeProvider();
            const categories = sp.getCategories(config.localPath);
            if (categories.length === 0) {
                vscode.window.showInformationMessage('No category folders | 暂无分类文件夹');
                return;
            }
            const picked = await vscode.window.showQuickPick(
                categories.map(c => ({ label: c })),
                { title: 'Select folder to delete | 选择要删除的分类文件夹' }
            );
            folderName = picked?.label;
        }

        if (!folderName) { return; }

        const folderPath = path.join(config.localPath, 'skills', folderName);
        if (!fs.existsSync(folderPath)) {
            vscode.window.showWarningMessage(`Folder "${folderName}" not found | 不存在`);
            return;
        }

        // Check if folder has skills
        const hasSkills = fs.readdirSync(folderPath, { withFileTypes: true }).some(e => {
            if (!e.isDirectory()) { return false; }
            return fs.existsSync(path.join(folderPath, e.name, 'SKILL.md'));
        });

        if (hasSkills) {
            vscode.window.showWarningMessage(`Folder "${folderName}" still has skills. Move or delete them first | 请先移走或删除其中的技能`);
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete category folder "${folderName}"? | 删除分类文件夹？`,
            { modal: true },
            'Delete | 删除'
        );

        if (confirm !== 'Delete | 删除') { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Deleting folder ${folderName}... | 正在删除...` },
            async () => {
                try {
                    await removeAndPush(
                        config.localPath,
                        `skills/${folderName}`,
                        `feat: remove category folder ${folderName}`,
                        config.branch
                    );
                } catch {
                    // Fallback: direct delete
                    fs.rmSync(folderPath, { recursive: true, force: true });
                    await addCommitPush(
                        config.localPath,
                        `feat: remove category folder ${folderName}`,
                        config.branch
                    );
                }
            }
        );

        vscode.window.showInformationMessage(`Category folder "${folderName}" deleted | 已删除`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Delete failed | 删除失败: ${err.message}`);
    }
}

/**
 * Mode 10c — Move a skill to a different category folder
 */
export async function moveSkillCommand(arg?: SkillTreeItem | SkillEntry): Promise<void> {
    try {
        const skill = await resolveSkill(arg);
        if (!skill) { return; }

        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('Please initialize AnySkill first | 请先初始化');
            return;
        }

        const sp = new SkillsTreeProvider();
        const categories = sp.getCategories(config.localPath);

        const targetItems = [
            { label: '$(symbol-folder) Root (no category) | 顶层（不分类）', description: 'skills/', value: '' },
            ...categories.map(c => ({
                label: `$(folder) ${c}`,
                description: `skills/${c}/`,
                value: c,
            })),
            { label: '$(add) New folder... | 新建文件夹...', description: '', value: '__NEW__' },
        ];

        const picked = await vscode.window.showQuickPick(targetItems, {
            title: `Move skill "${skill.name}" to... | 移动技能`,
            placeHolder: 'Select target category | 选择目标分类',
        });

        if (!picked) { return; }

        let targetFolder = picked.value;

        if (targetFolder === '__NEW__') {
            const newName = await vscode.window.showInputBox({
                title: 'New category folder | 新建分类',
                prompt: 'Enter folder name | 输入名称',
            });
            if (!newName) { return; }
            targetFolder = newName;
        }

        // Resolve current path
        const currentPath = skill.path || skill.file.split('/').slice(0, -1).join('/');
        const skillDirName = currentPath.split('/').pop() || skill.name;
        const newPath = targetFolder ? `${targetFolder}/${skillDirName}` : skillDirName;

        if (currentPath === newPath) {
            vscode.window.showInformationMessage('Skill is already here | 技能已在该位置');
            return;
        }

        const srcFull = path.join(config.localPath, 'skills', currentPath);
        const destFull = path.join(config.localPath, 'skills', newPath);

        if (!fs.existsSync(srcFull)) {
            vscode.window.showErrorMessage(`Source not found: skills/${currentPath} | 源路径不存在`);
            return;
        }

        // Ensure target parent exists
        const destParent = path.dirname(destFull);
        if (!fs.existsSync(destParent)) {
            fs.mkdirSync(destParent, { recursive: true });
        }

        // Move using fs (git mv can be tricky)
        fs.renameSync(srcFull, destFull);

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Moving ${skill.name}... | 正在移动...` },
            async () => {
                await addCommitPush(
                    config.localPath,
                    `feat: move skill ${skill.name} to ${targetFolder || 'root'}`,
                    config.branch
                );
            }
        );

        const dest = targetFolder ? `${targetFolder}/` : 'root';
        vscode.window.showInformationMessage(`Skill "${skill.name}" moved to ${dest} | 已移动`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Move failed | 移动失败: ${err.message}`);
    }
}
