import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverConfig, getToken } from '../config';
import { GitHubClient, SkillEntry } from '../github';
import { SkillTreeItem, CategoryItem, SkillsTreeProvider } from '../views/skillsTreeProvider';

// ── Cloud Edit Session Tracking ────────────────────
const CLOUD_EDIT_DIR = path.join(os.tmpdir(), 'anyskill-cloud');

interface CloudEditSession {
    remotePath: string;   // e.g. "skills/my-skill/SKILL.md"
    sha: string;          // SHA at the time the file was opened
    skillName: string;
}

// Map: local temp file path → session info
const cloudEditSessions = new Map<string, CloudEditSession>();

// Push lock: prevents concurrent pushes for the same file
const pushingFiles = new Set<string>();
const pendingPush = new Map<string, NodeJS.Timeout>();

/**
 * Validate that a user-supplied name is safe for use in path.join (no traversal).
 */
function validateSafeName(v: string): string | null {
    if (!v) { return 'Please enter a name | 请输入名称'; }
    if (/[/\\]/.test(v) || v.includes('..')) {
        return 'Name cannot contain / \\ or .. | 名称不能包含 / \\ 或 ..';
    }
    return null;
}

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
 * Mode 1 — Cloud Editor: load skill from cloud, edit locally, auto-push on save
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
                // Fetch content and SHA from cloud
                const remotePath = `skills/${skill.file}`;
                const sha = await client.getFileSha(remotePath);
                const content = await client.fetchFileContent(skill.file);

                // Write to temp file
                const skillPath = skill.path || skill.name;
                const tempDir = path.join(CLOUD_EDIT_DIR, skillPath);
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                const fileName = skill.file.split('/').pop() || 'SKILL.md';
                const tempFile = path.join(tempDir, fileName);
                fs.writeFileSync(tempFile, content, 'utf-8');

                // Track session
                cloudEditSessions.set(tempFile, {
                    remotePath,
                    sha: sha || '',
                    skillName: skill.name,
                });

                // Open in editor
                const doc = await vscode.workspace.openTextDocument(tempFile);
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage(
                    `☁ Editing "${skill.name}" — save to push to cloud | 保存即推送到云端`
                );
            }
        );
    } catch (err: any) {
        vscode.window.showErrorMessage(`Load failed | 加载失败: ${err.message}`);
    }
}

/**
 * Setup the save listener for cloud editor auto-push.
 * Call this once during extension activation.
 */
export function setupCloudEditListener(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const filePath = doc.uri.fsPath;
            const session = cloudEditSessions.get(filePath);
            if (!session) { return; }

            // Debounce: wait 500ms after last save before pushing
            const existing = pendingPush.get(filePath);
            if (existing) { clearTimeout(existing); }

            pendingPush.set(filePath, setTimeout(() => {
                pendingPush.delete(filePath);
                doPush(filePath, session, doc.getText());
            }, 500));
        })
    );
}

async function doPush(filePath: string, session: CloudEditSession, newContent: string): Promise<void> {
    // Skip if already pushing this file
    if (pushingFiles.has(filePath)) { return; }
    pushingFiles.add(filePath);

    try {
        const { client } = getClient();

        // Check for concurrent modification (optimistic lock)
        const currentSha = await client.getFileSha(session.remotePath);

        if (currentSha && session.sha && currentSha !== session.sha) {
            // Conflict! Cloud has been modified since we opened it
            const cloudContent = await client.fetchFileContent(
                session.remotePath.replace(/^skills\//, '')
            );

            const cloudTempFile = filePath + '.cloud';
            fs.writeFileSync(cloudTempFile, cloudContent, 'utf-8');

            const choice = await vscode.window.showWarningMessage(
                `Conflict: "${session.skillName}" was modified in the cloud since you opened it | 云端版本已变更`,
                'Overwrite Cloud | 覆盖云端',
                'View Diff | 查看差异',
                'Cancel | 取消'
            );

            if (choice === 'View Diff | 查看差异') {
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    vscode.Uri.file(cloudTempFile),
                    vscode.Uri.file(filePath),
                    `☁ Cloud ↔ Your Edit: ${session.skillName}`
                );
                setTimeout(() => { try { fs.unlinkSync(cloudTempFile); } catch { } }, 60000);
                return;
            }

            if (choice !== 'Overwrite Cloud | 覆盖云端') {
                try { fs.unlinkSync(cloudTempFile); } catch { }
                return;
            }

            try { fs.unlinkSync(cloudTempFile); } catch { }
        }

        // Push to cloud
        await client.createOrUpdateFile(
            session.remotePath,
            newContent,
            `edit: update ${session.skillName}`,
            currentSha || undefined
        );

        // Update SHA for next save
        const newSha = await client.getFileSha(session.remotePath);
        if (newSha) { session.sha = newSha; }

        vscode.window.showInformationMessage(
            `☁ "${session.skillName}" pushed to cloud | 已推送到云端`
        );
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(
            `Cloud push failed | 推送失败: ${err.message}`
        );
    } finally {
        pushingFiles.delete(filePath);
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

        // ── Conflict detection: check if local SKILL.md differs from cloud ──
        const localMainFile = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(localMainFile)) {
            const localContent = fs.readFileSync(localMainFile, 'utf-8');
            const mainFile = skill.files.find(f => f.endsWith('SKILL.md'));
            if (mainFile) {
                const cloudContent = await client.fetchFileContent(mainFile);
                if (localContent.trim() !== cloudContent.trim()) {
                    // Conflict! Show diff
                    const cloudTempFile = localMainFile + '.cloud-version';
                    fs.writeFileSync(cloudTempFile, cloudContent, 'utf-8');

                    const choice = await vscode.window.showWarningMessage(
                        `"${skill.name}" differs from cloud version | 本地与云端版本不一致`,
                        'Overwrite Local | 覆盖本地',
                        'View Diff | 查看差异',
                        'Cancel | 取消'
                    );

                    if (choice === 'View Diff | 查看差异') {
                        await vscode.commands.executeCommand(
                            'vscode.diff',
                            vscode.Uri.file(localMainFile),
                            vscode.Uri.file(cloudTempFile),
                            `${skill.name}: Local ↔ Cloud`
                        );
                        setTimeout(() => { try { fs.unlinkSync(cloudTempFile); } catch { } }, 60000);
                        return;
                    }

                    try { fs.unlinkSync(cloudTempFile); } catch { }
                    if (choice !== 'Overwrite Local | 覆盖本地') { return; }
                } else {
                    vscode.window.showInformationMessage(`"${skill.name}" is already up to date | 已是最新`);
                    return;
                }
            }
        }

        // ── Download all files ──
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
                    const targetPath = path.join(skillDir, ...file.split('/').slice(1));
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
 * Mode 4 — Upload skill to cloud repo (via GitHub API)
 */
export async function uploadSkillCommand(): Promise<void> {
    try {
        const { client, config } = getClient();
        if (!config) {
            vscode.window.showErrorMessage('Please run "AnySkill: Initialize" first | 请先初始化');
            return;
        }

        // Ask for skill name
        const skillName = await vscode.window.showInputBox({
            title: 'AnySkill: New Skill | 新建技能',
            prompt: 'Enter skill name | 输入技能名称',
            placeHolder: 'e.g. frontend-design or web-scraper',
            ignoreFocusOut: true,
            validateInput: validateSafeName,
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
        const categories = await client.getCategories();

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

        // Write to a temp file in the workspace for editing
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            // No workspace: open in untitled doc and push directly
            const doc = await vscode.workspace.openTextDocument({ content: skillMd, language: 'markdown' });
            await vscode.window.showTextDocument(doc);

            const action = await vscode.window.showInformationMessage(
                `Edit your skill, then click "Push" when ready | 编辑完成后点击推送`,
                'Push to Cloud | 推送到云端',
                'Cancel | 取消'
            );

            if (action === 'Push to Cloud | 推送到云端') {
                const content = doc.getText();
                const remotePath = targetCategory
                    ? `skills/${targetCategory}/${skillName}/SKILL.md`
                    : `skills/${skillName}/SKILL.md`;

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Uploading ${skillName}... | 正在上传...` },
                    async () => { await client.createOrUpdateFile(remotePath, content, `feat: add skill ${skillName}`); }
                );
                vscode.window.showInformationMessage(`Skill "${skillName}" pushed! | 已推送到云端`);
                vscode.commands.executeCommand('anyskill.refreshSkills');
            }
            return;
        }

        // Write to workspace for editing
        const root = workspaceFolders[0].uri.fsPath;
        const tempSkillDir = path.join(root, '.anyskill-drafts', skillName);
        if (!fs.existsSync(tempSkillDir)) {
            fs.mkdirSync(tempSkillDir, { recursive: true });
        }
        const skillFile = path.join(tempSkillDir, 'SKILL.md');
        fs.writeFileSync(skillFile, skillMd, 'utf-8');

        // Open in editor for the user to write content
        const doc = await vscode.workspace.openTextDocument(skillFile);
        await vscode.window.showTextDocument(doc);

        // Prompt to push
        const locationHint = targetCategory ? ` (${targetCategory})` : '';
        const action = await vscode.window.showInformationMessage(
            `Skill "${skillName}"${locationHint} created. Push when ready | 技能已创建`,
            'Push to Cloud | 推送到云端',
            'Later | 稍后推送'
        );

        if (action === 'Push to Cloud | 推送到云端') {
            // Re-read in case user edited the file
            const content = fs.readFileSync(skillFile, 'utf-8');
            const remotePath = targetCategory
                ? `skills/${targetCategory}/${skillName}/SKILL.md`
                : `skills/${skillName}/SKILL.md`;

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Uploading ${skillName}... | 正在上传...` },
                async () => { await client.createOrUpdateFile(remotePath, content, `feat: add skill ${skillName}`); }
            );

            vscode.window.showInformationMessage(`Skill "${skillName}" pushed! | 已推送到云端`);

            // Clean up draft
            try { fs.rmSync(tempSkillDir, { recursive: true, force: true }); } catch { /* ignore */ }
            const draftsDir = path.join(root, '.anyskill-drafts');
            try {
                if (fs.existsSync(draftsDir) && fs.readdirSync(draftsDir).length === 0) {
                    fs.rmdirSync(draftsDir);
                }
            } catch { /* ignore */ }

            vscode.commands.executeCommand('anyskill.refreshSkills');
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Upload failed | 上传失败: ${err.message}`);
    }
}

/**
 * Mode 7 — Delete a skill from cloud repo (via GitHub API)
 */
export async function deleteSkillCommand(arg?: SkillTreeItem | SkillEntry): Promise<void> {
    try {
        const skill = await resolveSkill(arg);
        if (!skill) { return; }

        const { client } = getClient();

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
                const skillPath = skill.path || skill.file.split('/').slice(0, -1).join('/');
                await client.deleteDirectory(`skills/${skillPath}`, `feat: remove skill ${skill.name}`);
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
    if (fs.existsSync(path.join(root, '.codex'))) {
        return path.join(root, '.codex', 'skills', skillName);
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
            { label: 'Codex (.codex/skills/)', value: path.join(root, '.codex', 'skills', skillName) },
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
 * Import existing skill from disk to AnySkill cloud repo (via GitHub API)
 */
export async function importSkillCommand(): Promise<void> {
    try {
        const { client, config } = getClient();
        if (!config) {
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

            const action = await vscode.window.showInformationMessage(
                `Push skill "${folderName}" to cloud? | 推送到云端？`,
                'Push to Cloud | 推送到云端',
                'Cancel | 取消'
            );

            if (action === 'Push to Cloud | 推送到云端') {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Uploading ${folderName}... | 正在上传...` },
                    async (progress) => {
                        const files = collectFilesRecursive(sourceDir);
                        let uploaded = 0;
                        for (const file of files) {
                            const relativePath = path.relative(sourceDir, file);
                            const remotePath = `skills/${folderName}/${relativePath.replace(/\\/g, '/')}`;
                            const content = fs.readFileSync(file, 'utf-8');

                            progress.report({
                                message: `${uploaded + 1}/${files.length}: ${relativePath}`,
                                increment: (1 / files.length) * 100,
                            });

                            await client.createOrUpdateFile(remotePath, content, `feat: import skill ${folderName}`);
                            uploaded++;
                        }
                    }
                );
                vscode.window.showInformationMessage(`Skill "${folderName}" pushed! | 已推送到云端`);
                vscode.commands.executeCommand('anyskill.refreshSkills');
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
                validateInput: validateSafeName,
            });

            if (!finalName) { return; }

            const action = await vscode.window.showInformationMessage(
                `Push skill "${finalName}" to cloud? | 推送到云端？`,
                'Push to Cloud | 推送到云端',
                'Cancel | 取消'
            );

            if (action === 'Push to Cloud | 推送到云端') {
                const remotePath = `skills/${finalName}/SKILL.md`;

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Uploading ${finalName}... | 正在上传...` },
                    async () => { await client.createOrUpdateFile(remotePath, content, `feat: import skill ${finalName}`); }
                );

                vscode.window.showInformationMessage(`Skill "${finalName}" pushed! | 已推送到云端`);
                vscode.commands.executeCommand('anyskill.refreshSkills');
            }
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Import failed | 导入失败: ${err.message}`);
    }
}

/**
 * Recursively collect all files in a directory (skipping .git, .DS_Store)
 */
function collectFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.DS_Store' || entry.name === '.git') { continue; }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFilesRecursive(full));
        } else {
            results.push(full);
        }
    }
    return results;
}

/**
 * Mode 10a — Create a category folder (via GitHub API)
 */
export async function createFolderCommand(): Promise<void> {
    try {
        const { client } = getClient();

        const folderName = await vscode.window.showInputBox({
            title: 'AnySkill: New Category Folder | 新建分类文件夹',
            prompt: 'Enter folder name | 输入文件夹名称',
            placeHolder: 'e.g. core or dev',
            ignoreFocusOut: true,
            validateInput: validateSafeName,
        });

        if (!folderName) { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Creating folder ${folderName}... | 正在创建...` },
            async () => {
                await client.createOrUpdateFile(
                    `skills/${folderName}/.gitkeep`,
                    '',
                    `feat: create category folder ${folderName}`
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
 * Mode 10b — Delete a category folder (via GitHub API)
 */
export async function deleteFolderCommand(arg?: CategoryItem): Promise<void> {
    try {
        const { client } = getClient();

        let folderName: string | undefined;

        if (arg instanceof CategoryItem) {
            folderName = arg.categoryName;
        } else {
            // Let user pick from existing cloud category folders
            const categories = await client.getCategories();
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

        const confirm = await vscode.window.showWarningMessage(
            `Delete category folder "${folderName}" and all contents? | 删除分类文件夹及全部内容？`,
            { modal: true },
            'Delete | 删除'
        );

        if (confirm !== 'Delete | 删除') { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Deleting folder ${folderName}... | 正在删除...` },
            async () => {
                await client.deleteDirectory(`skills/${folderName}`, `feat: remove category folder ${folderName}`);
            }
        );

        vscode.window.showInformationMessage(`Category folder "${folderName}" deleted | 已删除`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Delete failed | 删除失败: ${err.message}`);
    }
}

/**
 * Mode 10c — Move a skill to a different category folder (via GitHub API)
 */
export async function moveSkillCommand(arg?: SkillTreeItem | SkillEntry): Promise<void> {
    try {
        const skill = await resolveSkill(arg);
        if (!skill) { return; }

        const { client } = getClient();

        const categories = await client.getCategories();

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
                validateInput: validateSafeName,
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

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Moving ${skill.name}... | 正在移动...` },
            async (progress) => {
                // Step 1: Read all files from source
                progress.report({ message: 'Reading files... | 正在读取...' });

                const filesToMove: { remotePath: string; content: string }[] = [];
                for (const file of skill.files) {
                    const content = await client.fetchFileContent(file);
                    // Build new path: replace old prefix with new
                    const fileName = file.split('/').slice(currentPath.split('/').length).join('/');
                    const newRemotePath = `skills/${newPath}/${fileName}`;
                    filesToMove.push({ remotePath: newRemotePath, content });
                }

                // Step 2: Create files at new location
                progress.report({ message: 'Creating at new location... | 正在创建...' });
                for (const f of filesToMove) {
                    await client.createOrUpdateFile(f.remotePath, f.content, `feat: move skill ${skill.name} to ${targetFolder || 'root'}`);
                }

                // Step 3: Delete old files
                progress.report({ message: 'Removing old files... | 正在清理...' });
                await client.deleteDirectory(`skills/${currentPath}`, `feat: move skill ${skill.name} to ${targetFolder || 'root'}`);
            }
        );

        const dest = targetFolder ? `${targetFolder}/` : 'root';
        vscode.window.showInformationMessage(`Skill "${skill.name}" moved to ${dest} | 已移动`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Move failed | 移动失败: ${err.message}`);
    }
}

/**
 * Push a skill from the current project directory to cloud (via GitHub API).
 * This allows users to edit skills in their workspace and push changes back.
 */
export async function pushSkillFromProjectCommand(arg?: vscode.Uri): Promise<void> {
    try {
        const { client } = getClient();

        let skillDir: string | undefined;
        let skillName: string | undefined;

        if (arg) {
            // Called from right-click — resolve skill dir from URI
            const fsPath = arg.fsPath;
            if (fs.statSync(fsPath).isDirectory()) {
                if (fs.existsSync(path.join(fsPath, 'SKILL.md'))) {
                    skillDir = fsPath;
                }
            } else {
                const parentDir = path.dirname(fsPath);
                if (fs.existsSync(path.join(parentDir, 'SKILL.md'))) {
                    skillDir = parentDir;
                }
            }
            if (skillDir) { skillName = path.basename(skillDir); }
        }

        if (!skillDir) {
            // Fall back to picker
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('Please open a workspace first | 请先打开工作区');
                return;
            }

            const root = workspaceFolders[0].uri.fsPath;
            const skillDirs: { dir: string; ide: string }[] = [];
            const idePaths = [
                { prefix: '.agent/skills', ide: 'Antigravity' },
                { prefix: '.claude/skills', ide: 'Claude Code' },
                { prefix: '.cursor/rules', ide: 'Cursor' },
                { prefix: '.codex/skills', ide: 'Codex' },
            ];

            for (const { prefix, ide } of idePaths) {
                const fullPath = path.join(root, prefix);
                if (fs.existsSync(fullPath)) {
                    for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
                        if (entry.isDirectory() && fs.existsSync(path.join(fullPath, entry.name, 'SKILL.md'))) {
                            skillDirs.push({ dir: path.join(fullPath, entry.name), ide });
                        }
                    }
                }
            }

            if (skillDirs.length === 0) {
                vscode.window.showInformationMessage('No local skills found in this workspace | 工作区中未找到技能');
                return;
            }

            const items = skillDirs.map(s => ({
                label: path.basename(s.dir),
                description: `${s.ide} — ${s.dir}`,
                value: s,
            }));

            const picked = await vscode.window.showQuickPick(items, {
                title: 'AnySkill: Push Skill to Cloud | 推送技能到云端',
                placeHolder: 'Select skill to push | 选择要推送的技能',
            });

            if (!picked) { return; }
            skillDir = picked.value.dir;
            skillName = path.basename(skillDir);
        }

        if (!skillDir || !skillName) { return; }

        // ── Conflict detection ──
        const localSkillMd = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(localSkillMd)) {
            const localContent = fs.readFileSync(localSkillMd, 'utf-8');
            try {
                const cloudContent = await client.fetchFileContent(`${skillName}/SKILL.md`);
                if (localContent.trim() === cloudContent.trim()) {
                    vscode.window.showInformationMessage(`"${skillName}" is already up to date | 已是最新，无需推送`);
                    return;
                }

                const cloudTempFile = localSkillMd + '.cloud-version';
                fs.writeFileSync(cloudTempFile, cloudContent, 'utf-8');

                const choice = await vscode.window.showWarningMessage(
                    `"${skillName}" differs from cloud | 本地与云端版本不一致`,
                    'Push to Cloud | 覆盖云端',
                    'View Diff | 查看差异',
                    'Cancel | 取消'
                );

                if (choice === 'View Diff | 查看差异') {
                    await vscode.commands.executeCommand(
                        'vscode.diff',
                        vscode.Uri.file(cloudTempFile),
                        vscode.Uri.file(localSkillMd),
                        `${skillName}: Cloud ↔ Local`
                    );
                    setTimeout(() => { try { fs.unlinkSync(cloudTempFile); } catch { } }, 60000);
                    return;
                }

                try { fs.unlinkSync(cloudTempFile); } catch { }
                if (choice !== 'Push to Cloud | 覆盖云端') { return; }
            } catch {
                // Cloud file doesn't exist — new skill, proceed
            }
        }

        // ── Push all files ──
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Pushing ${skillName} to cloud... | 正在推送...` },
            async (progress) => {
                const files = collectFilesRecursive(skillDir!);
                let uploaded = 0;
                for (const file of files) {
                    const relativePath = path.relative(skillDir!, file);
                    const remotePath = `skills/${skillName}/${relativePath.replace(/\\/g, '/')}`;
                    const content = fs.readFileSync(file, 'utf-8');

                    progress.report({
                        message: `${uploaded + 1}/${files.length}: ${relativePath}`,
                        increment: (1 / files.length) * 100,
                    });

                    await client.createOrUpdateFile(remotePath, content, `feat: update skill ${skillName}`);
                    uploaded++;
                }
            }
        );

        vscode.window.showInformationMessage(`Skill "${skillName}" pushed to cloud! | 已推送到云端`);
        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Push failed | 推送失败: ${err.message}`);
    }
}

/**
 * Pull (update) a local project skill from the cloud.
 * Accepts a URI from right-click context menus.
 */
export async function pullSkillFromCloudCommand(arg?: vscode.Uri): Promise<void> {
    try {
        const { client } = getClient();

        let skillDir: string | undefined;
        let skillName: string | undefined;

        if (arg) {
            const fsPath = arg.fsPath;
            if (fs.statSync(fsPath).isDirectory()) {
                if (fs.existsSync(path.join(fsPath, 'SKILL.md'))) {
                    skillDir = fsPath;
                }
            } else {
                const parentDir = path.dirname(fsPath);
                if (fs.existsSync(path.join(parentDir, 'SKILL.md'))) {
                    skillDir = parentDir;
                }
            }
            if (skillDir) { skillName = path.basename(skillDir); }
        }

        if (!skillDir || !skillName) {
            vscode.window.showWarningMessage('Right-click on a SKILL.md file to pull from cloud | 请右键点击 SKILL.md 文件');
            return;
        }

        // Fetch cloud content
        let cloudContent: string;
        try {
            cloudContent = await client.fetchFileContent(`${skillName}/SKILL.md`);
        } catch {
            vscode.window.showWarningMessage(`"${skillName}" not found in cloud | 云端未找到此技能`);
            return;
        }

        // Conflict detection
        const localSkillMd = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(localSkillMd)) {
            const localContent = fs.readFileSync(localSkillMd, 'utf-8');
            if (localContent.trim() === cloudContent.trim()) {
                vscode.window.showInformationMessage(`"${skillName}" is already up to date | 已是最新`);
                return;
            }

            const cloudTempFile = localSkillMd + '.cloud-version';
            fs.writeFileSync(cloudTempFile, cloudContent, 'utf-8');

            const choice = await vscode.window.showWarningMessage(
                `"${skillName}" differs from cloud | 本地与云端版本不一致`,
                'Overwrite Local | 覆盖本地',
                'View Diff | 查看差异',
                'Cancel | 取消'
            );

            if (choice === 'View Diff | 查看差异') {
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    vscode.Uri.file(localSkillMd),
                    vscode.Uri.file(cloudTempFile),
                    `${skillName}: Local ↔ Cloud`
                );
                setTimeout(() => { try { fs.unlinkSync(cloudTempFile); } catch { } }, 60000);
                return;
            }

            try { fs.unlinkSync(cloudTempFile); } catch { }
            if (choice !== 'Overwrite Local | 覆盖本地') { return; }
        }

        // Write cloud content to local
        fs.writeFileSync(localSkillMd, cloudContent, 'utf-8');
        vscode.window.showInformationMessage(`"${skillName}" updated from cloud | 已从云端更新`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Pull failed | 拉取失败: ${err.message}`);
    }
}

