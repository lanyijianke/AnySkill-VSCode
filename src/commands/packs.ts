import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { discoverConfig, getToken } from '../config';
import { GitHubClient, PackEntry, SkillEntry } from '../github';
import { addCommitPush } from '../git';
import { PackCategoryItem, PackSkillItem } from '../views/packsTreeProvider';

/**
 * Mode 9 — Install a pack (a group of skills) from AnySkill-Packs
 */
export async function installPackCommand(arg?: PackCategoryItem | PackSkillItem): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config || !config.localPath) {
            vscode.window.showErrorMessage('请先运行 "AnySkill: 初始化配置"');
            return;
        }

        const token = getToken(config);
        const client = new GitHubClient(config.repo, config.branch, token);

        let pack: PackEntry | undefined;
        let singleSkill: SkillEntry | undefined;

        if (arg instanceof PackCategoryItem) {
            pack = arg.pack;
        } else if (arg instanceof PackSkillItem) {
            singleSkill = arg.skill;
        } else {
            // No argument: let user pick a pack
            const index = await client.fetchPacksIndex();
            const items = index.packs
                .filter((p) => p.skills.length > 0)
                .map((p) => ({
                    label: getCategoryLabel(p.category),
                    description: `${p.skills.length} 个技能`,
                    pack: p,
                }));

            if (items.length === 0) {
                vscode.window.showInformationMessage('暂无可用组合包');
                return;
            }

            const picked = await vscode.window.showQuickPick(items, {
                title: 'AnySkill: 选择组合包',
                placeHolder: '选择要安装的组合包...',
            });

            if (!picked) { return; }
            pack = picked.pack;
        }

        if (singleSkill) {
            // Install a single skill from packs
            await installPackSkills(client, config, [singleSkill]);
        } else if (pack) {
            if (pack.skills.length === 0) {
                vscode.window.showInformationMessage(`组合包 ${pack.category} 暂无技能`);
                return;
            }

            const confirm = await vscode.window.showInformationMessage(
                `即将安装组合包 "${getCategoryLabel(pack.category)}"，包含 ${pack.skills.length} 个技能`,
                '安装',
                '取消'
            );

            if (confirm !== '安装') { return; }

            await installPackSkills(client, config, pack.skills, pack.category);
        }

        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`安装失败: ${err.message}`);
    }
}

/**
 * Install an array of pack skills into the user's private repo
 */
async function installPackSkills(
    client: GitHubClient,
    config: any,
    skills: SkillEntry[],
    category?: string
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `正在安装${category ? ` ${getCategoryLabel(category)}` : ''}...`,
            cancellable: true,
        },
        async (progress, cancelToken) => {
            let success = 0;
            let failed = 0;
            const failedNames: string[] = [];

            for (const skill of skills) {
                if (cancelToken.isCancellationRequested) { break; }

                progress.report({
                    message: `${success + failed + 1}/${skills.length}: ${skill.name}`,
                    increment: (1 / skills.length) * 100,
                });

                try {
                    const skillDir = path.join(config.localPath, 'skills', skill.name);
                    if (!fs.existsSync(skillDir)) {
                        fs.mkdirSync(skillDir, { recursive: true });
                    }

                    for (const file of skill.files) {
                        const content = await client.fetchPackFile(file);
                        // Files are like "core-enhancement/skill-name/SKILL.md"
                        // We need to save as "skills/skill-name/SKILL.md"
                        const relativeParts = file.split('/');
                        // Remove the category prefix, keep skill-name/filename
                        const targetParts = relativeParts.slice(1);
                        const targetPath = path.join(config.localPath, 'skills', ...targetParts);
                        const targetDir = path.dirname(targetPath);

                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }
                        fs.writeFileSync(targetPath, content, 'utf-8');
                    }

                    success++;
                } catch {
                    failed++;
                    failedNames.push(skill.name);
                }
            }

            // Git push if anything was installed
            if (success > 0) {
                try {
                    progress.report({ message: '正在推送到仓库...' });
                    await addCommitPush(
                        config.localPath,
                        `feat: install pack ${category || 'skills'}`,
                        config.branch
                    );
                } catch (err: any) {
                    vscode.window.showWarningMessage(`推送失败: ${err.message}`);
                }
            }

            // Report
            let message = `安装完成！成功 ${success} 个`;
            if (failed > 0) {
                message += `，失败 ${failed} 个 (${failedNames.join(', ')})`;
            }
            vscode.window.showInformationMessage(message);
        }
    );
}

function getCategoryLabel(category: string): string {
    const map: Record<string, string> = {
        'core-enhancement': '核心增强',
        'tech-development': '技术开发',
        'content-creation': '内容创作',
        'data-crawling': '数据采集',
        'communication': '通信集成',
    };
    return map[category] || category;
}
