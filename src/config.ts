import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AnySkillConfig {
    repo: string;
    branch: string;
    token?: string;
    localPath: string;
}

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.anyskill', 'config.json');

/**
 * Discover AnySkill config following the SKILL.md priority chain:
 * 1. Global config ~/.anyskill/config.json
 * 2. Project-level .anyskill.json
 * 3. VS Code settings
 */
export function discoverConfig(): AnySkillConfig | null {
    // Priority 1: Global config
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
        try {
            const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8');
            const config = JSON.parse(raw) as AnySkillConfig;
            if (config.repo) {
                return config;
            }
        } catch {
            // ignore parse errors, fall through
        }
    }

    // Priority 2: Project-level .anyskill.json
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            const projectConfig = path.join(folder.uri.fsPath, '.anyskill.json');
            if (fs.existsSync(projectConfig)) {
                try {
                    const raw = fs.readFileSync(projectConfig, 'utf-8');
                    const config = JSON.parse(raw) as AnySkillConfig;
                    if (config.repo) {
                        return config;
                    }
                } catch {
                    // ignore
                }
            }
        }
    }

    // Priority 3: VS Code settings
    const vsConfig = vscode.workspace.getConfiguration('anyskill');
    const repo = vsConfig.get<string>('repo', '');
    if (repo) {
        return {
            repo,
            branch: vsConfig.get<string>('branch', 'main'),
            localPath: vsConfig.get<string>('localPath', ''),
        };
    }

    return null;
}

/**
 * Get token following priority:
 * 1. Environment variable ANYSKILL_GITHUB_TOKEN
 * 2. Config file token field
 * 3. ~/.openclaw/.env file (OpenClaw stores token there)
 */
export function getToken(config: AnySkillConfig | null): string | undefined {
    // Priority 1: Environment variable
    const envToken = process.env.ANYSKILL_GITHUB_TOKEN;
    if (envToken) {
        return envToken;
    }

    // Priority 2: Config file token field
    if (config?.token) {
        return config.token;
    }

    // Priority 3: Read from ~/.openclaw/.env (VS Code doesn't auto-load .env files)
    const openclawEnvPath = path.join(os.homedir(), '.openclaw', '.env');
    if (fs.existsSync(openclawEnvPath)) {
        try {
            const envContent = fs.readFileSync(openclawEnvPath, 'utf-8');
            for (const line of envContent.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.startsWith('ANYSKILL_GITHUB_TOKEN=')) {
                    const token = trimmed.substring('ANYSKILL_GITHUB_TOKEN='.length).trim();
                    // Remove surrounding quotes if present
                    const cleaned = token.replace(/^["']|["']$/g, '');
                    if (cleaned) {
                        return cleaned;
                    }
                }
            }
        } catch {
            // ignore read errors
        }
    }

    return undefined;
}

/**
 * Save config to global file ~/.anyskill/config.json
 */
export function saveGlobalConfig(config: AnySkillConfig): void {
    const dir = path.dirname(GLOBAL_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
    return GLOBAL_CONFIG_PATH;
}
