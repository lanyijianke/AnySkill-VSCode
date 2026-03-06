import * as vscode from 'vscode';
import { discoverConfig, getToken } from '../config';
import { GitHubClient } from '../github';

/**
 * Check for AnySkill engine and infra updates
 */
export async function checkUpdateCommand(): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config) {
            vscode.window.showWarningMessage('Please run "AnySkill: Initialize" first | 请先初始化');
            return;
        }

        const token = getToken(config);
        const client = new GitHubClient(config.repo, config.branch, token);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Checking AnySkill updates... | 正在检查更新...',
            },
            async () => {
                const versionInfo = await client.fetchVersionInfo();
                const currentVersion = '2.0.0'; // Current engine version

                const remoteVersion = versionInfo.engine.version;

                if (compareVersions(remoteVersion, currentVersion) > 0) {
                    // Collect changelog entries newer than current
                    const newEntries = versionInfo.engine.changelog.filter(
                        (e) => compareVersions(e.version, currentVersion) > 0
                    );

                    let changelogText = `AnySkill engine v${remoteVersion} available (current v${currentVersion}) | 引擎有新版本\n\n`;
                    for (const entry of newEntries) {
                        changelogText += `v${entry.version} (${entry.date})\n`;
                        for (const change of entry.changes) {
                            changelogText += `  • ${change}\n`;
                        }
                        changelogText += '\n';
                    }

                    const action = await vscode.window.showInformationMessage(
                        `AnySkill v${remoteVersion} available (current v${currentVersion}) | 有新版本`,
                        'View Changelog | 查看更新日志',
                        'Later | 稍后'
                    );

                    if (action === 'View Changelog | 查看更新日志') {
                        // Show changelog in a new document
                        const doc = await vscode.workspace.openTextDocument({
                            content: changelogText,
                            language: 'markdown',
                        });
                        await vscode.window.showTextDocument(doc, { preview: true });
                    }
                } else {
                    vscode.window.showInformationMessage('AnySkill is up to date | 已是最新版本');
                }
            }
        );
    } catch (err: any) {
        // Silently skip if version check fails
        vscode.window.showWarningMessage(`Version check failed | 版本检查失败: ${err.message}`);
    }
}

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 */
function compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        const va = partsA[i] || 0;
        const vb = partsB[i] || 0;
        if (va > vb) { return 1; }
        if (va < vb) { return -1; }
    }
    return 0;
}
