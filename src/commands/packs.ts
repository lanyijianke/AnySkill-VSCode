import * as vscode from 'vscode';
import { discoverConfig, getToken } from '../config';
import { GitHubClient, PackEntry, SkillEntry } from '../github';
import { PackCategoryItem, PackSkillItem } from '../views/packsTreeProvider';

/**
 * Mode 9 — Install a pack (a group of skills) from AnySkill-Packs
 */
export async function installPackCommand(arg?: PackCategoryItem | PackSkillItem): Promise<void> {
    try {
        const config = discoverConfig();
        if (!config) {
            vscode.window.showErrorMessage('Please run "AnySkill: Initialize" first | 请先初始化');
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
                    description: `${p.skills.length} skills | ${p.skills.length} 个技能`,
                    pack: p,
                }));

            if (items.length === 0) {
                vscode.window.showInformationMessage('No packs available | 暂无可用组合包');
                return;
            }

            const picked = await vscode.window.showQuickPick(items, {
                title: 'AnySkill: Select Pack | 选择组合包',
                placeHolder: 'Choose a pack to install... | 选择要安装的组合包...',
            });

            if (!picked) { return; }
            pack = picked.pack;
        }

        if (singleSkill) {
            // Install a single skill from packs
            await installPackSkills(client, [singleSkill]);
        } else if (pack) {
            if (pack.skills.length === 0) {
                vscode.window.showInformationMessage(`Pack ${pack.category} has no skills | 暂无技能`);
                return;
            }

            const confirm = await vscode.window.showInformationMessage(
                `Install pack "${getCategoryLabel(pack.category)}" with ${pack.skills.length} skills? | 即将安装 ${pack.skills.length} 个技能`,
                'Install | 安装',
                'Cancel | 取消'
            );

            if (confirm !== 'Install | 安装') { return; }

            await installPackSkills(client, pack.skills, pack.category);
        }

        vscode.commands.executeCommand('anyskill.refreshSkills');
    } catch (err: any) {
        vscode.window.showErrorMessage(`Install failed | 安装失败: ${err.message}`);
    }
}

/**
 * Install an array of pack skills into the user's private repo via GitHub API
 */
async function installPackSkills(
    client: GitHubClient,
    skills: SkillEntry[],
    category?: string
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Installing${category ? ` ${getCategoryLabel(category)}` : ''}... | 正在安装...`,
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
                    for (const file of skill.files) {
                        const content = await client.fetchPackFile(file);
                        // Files are like "core-enhancement/skill-name/SKILL.md"
                        // We need to save as "skills/skill-name/SKILL.md"
                        const relativeParts = file.split('/');
                        // Remove the category prefix, keep skill-name/filename
                        const targetParts = relativeParts.slice(1);
                        const remotePath = `skills/${targetParts.join('/')}`;

                        await client.createOrUpdateFile(
                            remotePath,
                            content,
                            `feat: install pack skill ${skill.name}`
                        );
                    }

                    success++;
                } catch {
                    failed++;
                    failedNames.push(skill.name);
                }
            }

            // Report
            let message = `Install complete! ${success} succeeded | 安装完成！成功 ${success} 个`;
            if (failed > 0) {
                message += `, ${failed} failed (${failedNames.join(', ')}) | ，失败 ${failed} 个`;
            }
            vscode.window.showInformationMessage(message);
        }
    );
}

function getCategoryLabel(category: string): string {
    const map: Record<string, string> = {
        'core-enhancement': 'Core Enhancement | 核心增强',
        'tech-development': 'Tech Development | 技术开发',
        'content-creation': 'Content Creation | 内容创作',
        'data-crawling': 'Data Collection | 数据采集',
        'communication': 'Communication | 通信集成',
        'office-operations': 'Office Operations | 办公运营',
    };
    return map[category] || category;
}
