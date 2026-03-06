import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { discoverConfig, getToken, saveGlobalConfig, AnySkillConfig } from '../config';
import { GitHubClient } from '../github';
import { cloneRepo } from '../git';

/**
 * Initialize AnySkill configuration.
 * Replicates the SKILL.md "第零步" flow.
 */
export async function initCommand(): Promise<void> {
    const existingConfig = discoverConfig();

    if (existingConfig) {
        const action = await vscode.window.showInformationMessage(
            `AnySkill config found, connected to \`${existingConfig.repo}\` | 已检测到配置，连接到 \`${existingConfig.repo}\``,
            'Reconfigure | 重新配置',
            'OK | 确定'
        );
        if (action !== 'Reconfigure | 重新配置') {
            return;
        }
    }

    // Step 1: Ask for token
    const token = await vscode.window.showInputBox({
        title: 'AnySkill: Enter GitHub Token | 输入 GitHub Token',
        prompt: 'Enter your GitHub Personal Access Token (starts with github_pat_ or ghp_) | 请输入 Token',
        password: true,
        placeHolder: 'github_pat_xxxxxxxxxxxx',
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value) {
                return 'Please enter a token | 请输入 Token';
            }
            if (!value.startsWith('github_pat_') && !value.startsWith('ghp_')) {
                return 'Invalid format, should start with github_pat_ or ghp_ | Token 格式不正确';
            }
            return null;
        },
    });

    if (!token) {
        return; // User cancelled
    }

    // Step 2: Ask for repo or auto-discover
    const choice = await vscode.window.showQuickPick(
        [
            {
                label: 'Auto-discover my skill repo | 自动发现技能仓库',
                description: 'Recommended | 推荐',
                value: 'auto',
            },
            {
                label: 'Enter repo manually | 手动输入仓库地址',
                description: 'If you know the repo | 如果你知道地址',
                value: 'manual',
            },
            {
                label: '+ Create new skill repo | 创建新仓库',
                description: 'I don\'t have one yet | 我还没有仓库',
                value: 'create',
            },
        ],
        {
            title: 'AnySkill: Select Repo | 选择仓库',
            placeHolder: 'Choose your skill repo source | 选择技能仓库来源',
        }
    );

    if (!choice) {
        return;
    }

    let repo: string | undefined;
    let branch = 'main';

    if (choice.value === 'auto') {
        // Auto-discover: Path B from SKILL.md
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'AnySkill',
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: 'Fetching user info... | 正在获取用户信息...' });

                const client = new GitHubClient('', 'main', token);

                try {
                    const user = await client.getUserInfo();
                    progress.report({ message: `Hello ${user.login}! Searching... | 你好 ${user.login}！正在搜索...` });

                    const searchResult = await client.searchRepos(user.login);

                    if (searchResult.total_count > 0) {
                        // Verify each candidate
                        for (const candidate of searchResult.items) {
                            progress.report({ message: `Verifying ${candidate.full_name}... | 正在验证...` });
                            const index = await client.verifyRepo(candidate.full_name, candidate.default_branch);
                            if (index !== null) {
                                repo = candidate.full_name;
                                branch = candidate.default_branch;
                                vscode.window.showInformationMessage(`Found skill repo: ${repo} | 找到技能仓库: ${repo}`);
                                break;
                            }
                        }
                    }

                    if (!repo) {
                        vscode.window.showWarningMessage('No repo found. Enter manually or create one | 未找到仓库，请手动输入或创建');
                        // Fall through to manual input
                        repo = await promptForRepo();
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed | 获取失败: ${err.message}`);
                    return;
                }
            }
        );
    } else if (choice.value === 'manual') {
        repo = await promptForRepo();
    } else if (choice.value === 'create') {
        // Open the GitHub template page
        vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/lanyijianke/AnySkill/generate')
        );
        vscode.window.showInformationMessage('Please create the repo in your browser, then come back to enter the repo address | 请在浏览器中创建仓库后回来输入地址');
        repo = await promptForRepo();
    }

    if (!repo) {
        return;
    }

    // Step 3: Clone and save config
    const defaultPath = path.join(os.homedir(), '.anyskill', 'repo');
    const localPath = await vscode.window.showInputBox({
        title: 'AnySkill: Local Path | 本地路径',
        prompt: 'Choose where to clone the repo | 选择仓库克隆路径',
        value: defaultPath,
        ignoreFocusOut: true,
    });

    if (!localPath) {
        return;
    }

    // Clone with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'AnySkill',
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: 'Cloning repo... | 正在克隆仓库...' });

                const fs = await import('fs');
                if (!fs.existsSync(localPath!)) {
                    await cloneRepo(repo!, localPath!, token);
                }

                progress.report({ message: 'Saving config... | 正在保存配置...' });

                const config: AnySkillConfig = {
                    repo: repo!,
                    branch,
                    token,
                    localPath: localPath!,
                };

                saveGlobalConfig(config);

                // Refresh views
                vscode.commands.executeCommand('anyskill.refreshSkills');
                vscode.commands.executeCommand('anyskill.refreshPacks');

                // Set configured context
                vscode.commands.executeCommand('setContext', 'anyskill.configured', true);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Config failed | 配置失败: ${err.message}`);
                return;
            }
        }
    );

    // Step 4: Download engine to current workspace
    await downloadEngine(token);

    vscode.window.showInformationMessage(`AnySkill configured! Repo: ${repo} | 配置完成！仓库: ${repo}`);
}

/**
 * Download AnySkill engine (SKILL.md) to the current workspace's skill directory.
 */
async function downloadEngine(token: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return; // No workspace open, skip engine download
    }

    const root = workspaceFolders[0].uri.fsPath;
    const fs = await import('fs');

    // Detect IDE skill directory
    let skillDir: string | undefined;
    let detectedIDE = '';

    if (fs.existsSync(path.join(root, '.agent'))) {
        skillDir = path.join(root, '.agent', 'skills', 'anyskill');
        detectedIDE = 'Antigravity';
    } else if (fs.existsSync(path.join(root, '.claude'))) {
        skillDir = path.join(root, '.claude', 'skills', 'anyskill');
        detectedIDE = 'Claude Code';
    } else if (fs.existsSync(path.join(root, '.cursor'))) {
        skillDir = path.join(root, '.cursor', 'rules', 'anyskill');
        detectedIDE = 'Cursor';
    } else if (fs.existsSync(path.join(root, '.openclaw'))) {
        skillDir = path.join(root, '.openclaw', 'skills', 'anyskill');
        detectedIDE = 'OpenClaw';
    }

    // Ask user
    const installEngine = await vscode.window.showInformationMessage(
        skillDir
            ? `Detected ${detectedIDE}. Install AnySkill engine? | 检测到 ${detectedIDE}，是否安装引擎？`
            : 'Install AnySkill engine to current project? | 是否安装引擎？',
        'Install | 安装引擎',
        'Skip | 跳过'
    );

    if (installEngine !== 'Install | 安装引擎') {
        return;
    }

    // If no IDE detected, let user pick
    if (!skillDir) {
        const picked = await vscode.window.showQuickPick(
            [
                { label: 'Antigravity (.agent/skills/)', value: path.join(root, '.agent', 'skills', 'anyskill') },
                { label: 'Claude Code (.claude/skills/)', value: path.join(root, '.claude', 'skills', 'anyskill') },
                { label: 'Cursor (.cursor/rules/)', value: path.join(root, '.cursor', 'rules', 'anyskill') },
                { label: 'OpenClaw (.openclaw/skills/)', value: path.join(root, '.openclaw', 'skills', 'anyskill') },
            ],
            { title: 'Select install location | 选择安装位置', placeHolder: 'Choose your AI IDE | 选择你使用的 AI IDE' }
        );
        if (!picked) { return; }
        skillDir = picked.value;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Downloading AnySkill engine... | 正在下载引擎...',
        },
        async () => {
            try {
                const engineUrl = 'https://raw.githubusercontent.com/lanyijianke/AnySkill/main/loader/anyskill/SKILL.md';
                const https = await import('https');

                const content = await new Promise<string>((resolve, reject) => {
                    https.get(engineUrl, {
                        headers: {
                            'User-Agent': 'AnySkill-VSCode',
                            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                        },
                    }, (res: any) => {
                        // Handle redirect
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

                if (!fs.existsSync(skillDir!)) {
                    fs.mkdirSync(skillDir!, { recursive: true });
                }

                fs.writeFileSync(path.join(skillDir!, 'SKILL.md'), content, 'utf-8');

                // Also create .anyskill.json in the project root for SKILL.md to discover
                const config = discoverConfig();
                if (config) {
                    const projectConfig = {
                        repo: config.repo,
                        branch: config.branch,
                        localPath: config.localPath,
                    };
                    fs.writeFileSync(
                        path.join(root, '.anyskill.json'),
                        JSON.stringify(projectConfig, null, 2),
                        'utf-8'
                    );
                }

                vscode.window.showInformationMessage(`Engine installed to ${skillDir} | 引擎已安装到 ${skillDir}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Engine download failed | 引擎下载失败: ${err.message}`);
            }
        }
    );
}

async function promptForRepo(): Promise<string | undefined> {
    return vscode.window.showInputBox({
        title: 'AnySkill: Enter Repo | 输入仓库地址',
        prompt: 'Format: username/repo-name | 格式: 用户名/仓库名 (e.g. lanyijianke/my-skills)',
        placeHolder: 'username/my-skills',
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value) {
                return 'Please enter a repo address | 请输入仓库地址';
            }
            if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)) {
                return 'Format: username/repo-name | 格式: 用户名/仓库名';
            }
            return null;
        },
    });
}
