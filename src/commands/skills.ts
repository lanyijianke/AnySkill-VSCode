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
        throw new Error('请先运行 "AnySkill: 初始化配置"');
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
        vscode.window.showInformationMessage('暂无技能');
        return undefined;
    }

    const items = skills.map((s) => ({
        label: s.name,
        description: s.description,
        skill: s,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        title: 'AnySkill: 选择技能',
        placeHolder: '搜索技能...',
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
                title: `正在加载 ${skill.name}...`,
            },
            async () => {
                const content = await client.fetchFileContent(skill.file);
                const doc = await vscode.workspace.openTextDocument({
                    content,
                    language: 'markdown',
                });
                await vscode.window.showTextDocument(doc, { preview: true });
                vscode.window.showInformationMessage(`已加载 ${skill.name} 到编辑器`);
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`加载失败: ${err.message}`);
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
                title: `正在下载 ${skill.name}...`,
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
                    `技能 ${skill.name} 已下载到 ${skillDir}，共 ${downloaded} 个文件`
                );
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`下载失败: ${err.message}`);
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
            vscode.window.showInformationMessage('云端暂无技能');
            return;
        }

        const confirm = await vscode.window.showInformationMessage(
            `即将下载 ${skills.length} 个技能到本地，继续？`,
            '下载',
            '取消'
        );

        if (confirm !== '下载') {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '正在同步所有技能...',
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
                    `同步完成！成功 ${completed} 个${failed > 0 ? `，失败 ${failed} 个` : ''}`
                );
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`同步失败: ${err.message}`);
    }
}

/**
 * Mode 4 — Upload skill to cloud repo
 */
export async function uploadSkillCommand(): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('请先运行 "AnySkill: 初始化配置"');
            return;
        }

        // Ask for skill name
        const skillName = await vscode.window.showInputBox({
            title: 'AnySkill: 新建技能',
            prompt: '输入技能名称（中英文都可以）',
            placeHolder: '例如: 前端设计 或 web-scraper',
            ignoreFocusOut: true,
            validateInput: (v) => v ? null : '请输入技能名称',
        });

        if (!skillName) { return; }

        // Ask for description
        const description = await vscode.window.showInputBox({
            title: 'AnySkill: 技能描述',
            prompt: '简要描述用途（一句话）',
            placeHolder: '例如: 创建现代化前端界面的设计规范',
            ignoreFocusOut: true,
        });

        // Check for existing category folders and ask user
        let targetCategory = '';
        const skillsProvider = new SkillsTreeProvider();
        const categories = skillsProvider.getCategories(config.localPath);

        if (categories.length > 0) {
            const categoryItems = [
                { label: '$(symbol-folder) 不分类', description: '放在 skills/ 顶层', value: '' },
                ...categories.map(c => ({
                    label: `$(folder) ${c}`,
                    description: `放入 skills/${c}/`,
                    value: c,
                })),
            ];

            const picked = await vscode.window.showQuickPick(categoryItems, {
                title: 'AnySkill: 选择分类',
                placeHolder: '要放入哪个分类文件夹？',
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

<!-- 在下方编写你的技能内容，保存后点击通知栏的「推送到云端」上传 -->

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
        const locationHint = targetCategory ? ` (分类: ${targetCategory})` : '';
        const action = await vscode.window.showInformationMessage(
            `技能 "${skillName}"${locationHint} 已创建，编辑完成后点击推送`,
            '推送到云端',
            '稍后推送'
        );

        if (action === '推送到云端') {
            // Ensure infra files exist
            await ensureInfraFiles(config);

            // Git add, commit, push
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `正在上传技能 ${skillName}...`,
                },
                async () => {
                    await addCommitPush(
                        config.localPath,
                        `feat: add skill ${skillName}`,
                        config.branch
                    );
                }
            );

            vscode.window.showInformationMessage(
                `技能 "${skillName}" 已推送到云端！`
            );

            // Refresh
            vscode.commands.executeCommand('anyskill.refreshSkills');
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`上传失败: ${err.message}`);
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
            vscode.window.showErrorMessage('请先初始化 AnySkill');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `即将删除技能 "${skill.name}"，此操作不可撤销！`,
            { modal: true },
            '删除'
        );

        if (confirm !== '删除') {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在删除 ${skill.name}...`,
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

        vscode.window.showInformationMessage(
            `技能 "${skill.name}" 已删除`
        );

        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`删除失败: ${err.message}`);
    }
}

/**
 * Determine where to place a downloaded skill in the current workspace
 */
async function determineSkillDir(skillName: string, askUser: boolean = true): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (askUser) {
            vscode.window.showWarningMessage('请先打开一个工作区');
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
            { label: '自定义路径...', value: 'custom' },
        ],
        { title: '选择技能存放位置', placeHolder: '检测到 VS Code 环境' }
    );

    if (!picked) { return undefined; }

    if (picked.value === 'custom') {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: '选择技能存放目录',
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
            vscode.window.showErrorMessage('请先运行 "AnySkill: 初始化配置"');
            return;
        }

        // Let user choose: folder or file
        const choice = await vscode.window.showQuickPick(
            [
                {
                    label: '选择技能文件夹',
                    description: '导入整个文件夹（包含 SKILL.md 和其他文件）',
                    value: 'folder',
                },
                {
                    label: '选择 SKILL.md 文件',
                    description: '导入单个技能文件',
                    value: 'file',
                },
            ],
            { title: 'AnySkill: 导入已有技能', placeHolder: '选择导入方式' }
        );

        if (!choice) { return; }

        if (choice.value === 'folder') {
            // Pick a folder
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: '选择技能文件夹（应包含 SKILL.md）',
            });

            if (!uris || uris.length === 0) { return; }

            const sourceDir = uris[0].fsPath;
            const folderName = path.basename(sourceDir);

            // Check if SKILL.md exists
            const skillMdPath = path.join(sourceDir, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) {
                const createIt = await vscode.window.showWarningMessage(
                    `文件夹 "${folderName}" 中没有找到 SKILL.md，是否自动创建？`,
                    '创建',
                    '取消'
                );
                if (createIt !== '创建') { return; }

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
                `技能 "${folderName}" 已导入（${countFiles(targetDir)} 个文件），推送到云端？`,
                '推送到云端',
                '稍后推送'
            );

            if (action === '推送到云端') {
                await pushSkill(config, folderName);
            }
        } else {
            // Pick a file
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Markdown': ['md'] },
                title: '选择 SKILL.md 文件',
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
                title: '确认技能名称',
                value: skillName,
                prompt: '技能将以此名称保存到仓库中',
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
                `技能 "${finalName}" 已导入，推送到云端？`,
                '推送到云端',
                '稍后推送'
            );

            if (action === '推送到云端') {
                await pushSkill(config, finalName);
            }
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`导入失败: ${err.message}`);
    }
}

async function pushSkill(config: any, skillName: string): Promise<void> {
    await ensureInfraFiles(config);
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `正在推送 ${skillName}...` },
        async () => {
            await addCommitPush(config.localPath, `feat: add skill ${skillName}`, config.branch);
        }
    );
    vscode.window.showInformationMessage(`技能 "${skillName}" 已推送到云端！`);
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
            vscode.window.showErrorMessage('请先运行 "AnySkill: 初始化配置"');
            return;
        }

        const folderName = await vscode.window.showInputBox({
            title: 'AnySkill: 新建分类文件夹',
            prompt: '输入文件夹名称',
            placeHolder: '例如: core 或 dev',
            ignoreFocusOut: true,
            validateInput: (v) => v ? null : '请输入文件夹名称',
        });

        if (!folderName) { return; }

        const folderPath = path.join(config.localPath, 'skills', folderName);
        if (fs.existsSync(folderPath)) {
            vscode.window.showWarningMessage(`文件夹 "${folderName}" 已存在`);
            return;
        }

        fs.mkdirSync(folderPath, { recursive: true });
        fs.writeFileSync(path.join(folderPath, '.gitkeep'), '', 'utf-8');

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `正在创建文件夹 ${folderName}...` },
            async () => {
                await addCommitPush(
                    config.localPath,
                    `feat: create category folder ${folderName}`,
                    config.branch
                );
            }
        );

        vscode.window.showInformationMessage(`分类文件夹 "${folderName}" 已创建`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`创建失败: ${err.message}`);
    }
}

/**
 * Mode 10b — Delete a category folder (must be empty)
 */
export async function deleteFolderCommand(arg?: CategoryItem): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('请先初始化 AnySkill');
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
                vscode.window.showInformationMessage('暂无分类文件夹');
                return;
            }
            const picked = await vscode.window.showQuickPick(
                categories.map(c => ({ label: c })),
                { title: '选择要删除的分类文件夹' }
            );
            folderName = picked?.label;
        }

        if (!folderName) { return; }

        const folderPath = path.join(config.localPath, 'skills', folderName);
        if (!fs.existsSync(folderPath)) {
            vscode.window.showWarningMessage(`文件夹 "${folderName}" 不存在`);
            return;
        }

        // Check if folder has skills
        const hasSkills = fs.readdirSync(folderPath, { withFileTypes: true }).some(e => {
            if (!e.isDirectory()) { return false; }
            return fs.existsSync(path.join(folderPath, e.name, 'SKILL.md'));
        });

        if (hasSkills) {
            vscode.window.showWarningMessage(
                `文件夹 "${folderName}" 下还有技能，请先移走或删除它们`
            );
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `即将删除分类文件夹 "${folderName}"`,
            { modal: true },
            '删除'
        );

        if (confirm !== '删除') { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `正在删除文件夹 ${folderName}...` },
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

        vscode.window.showInformationMessage(`分类文件夹 "${folderName}" 已删除`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`删除失败: ${err.message}`);
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
            vscode.window.showErrorMessage('请先初始化 AnySkill');
            return;
        }

        const sp = new SkillsTreeProvider();
        const categories = sp.getCategories(config.localPath);

        const targetItems = [
            { label: '$(symbol-folder) 顶层（不分类）', description: 'skills/', value: '' },
            ...categories.map(c => ({
                label: `$(folder) ${c}`,
                description: `skills/${c}/`,
                value: c,
            })),
            { label: '$(add) 新建文件夹...', description: '', value: '__NEW__' },
        ];

        const picked = await vscode.window.showQuickPick(targetItems, {
            title: `移动技能 "${skill.name}" 到...`,
            placeHolder: '选择目标分类',
        });

        if (!picked) { return; }

        let targetFolder = picked.value;

        if (targetFolder === '__NEW__') {
            const newName = await vscode.window.showInputBox({
                title: '新建分类文件夹',
                prompt: '输入文件夹名称',
            });
            if (!newName) { return; }
            targetFolder = newName;
        }

        // Resolve current path
        const currentPath = skill.path || skill.file.split('/').slice(0, -1).join('/');
        const skillDirName = currentPath.split('/').pop() || skill.name;
        const newPath = targetFolder ? `${targetFolder}/${skillDirName}` : skillDirName;

        if (currentPath === newPath) {
            vscode.window.showInformationMessage('技能已在该位置');
            return;
        }

        const srcFull = path.join(config.localPath, 'skills', currentPath);
        const destFull = path.join(config.localPath, 'skills', newPath);

        if (!fs.existsSync(srcFull)) {
            vscode.window.showErrorMessage(`源路径不存在: skills/${currentPath}`);
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
            { location: vscode.ProgressLocation.Notification, title: `正在移动 ${skill.name}...` },
            async () => {
                await addCommitPush(
                    config.localPath,
                    `feat: move skill ${skill.name} to ${targetFolder || 'root'}`,
                    config.branch
                );
            }
        );

        const dest = targetFolder ? `${targetFolder}/` : '顶层';
        vscode.window.showInformationMessage(`技能 "${skill.name}" 已移动到 ${dest}`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`移动失败: ${err.message}`);
    }
}
