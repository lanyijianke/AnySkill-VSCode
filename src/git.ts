import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_LOCAL_PATH = path.join(os.homedir(), '.anyskill', 'repo');

/**
 * Get the default local clone path.
 */
export function getDefaultLocalPath(): string {
    return DEFAULT_LOCAL_PATH;
}

/**
 * Execute a git command in the given directory.
 */
export function gitExec(cwd: string, ...args: string[]): string {
    const cmd = ['git', ...args].join(' ');
    return execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
    }).trim();
}

/**
 * Clone a repository to the local path.
 */
export function gitClone(repoUrl: string, targetPath: string): void {
    const parent = path.dirname(targetPath);
    const dirName = path.basename(targetPath);
    const fs = require('fs');
    if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
    }
    execSync(`git clone "${repoUrl}" "${dirName}"`, {
        cwd: parent,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
    });
}

/**
 * Pull latest changes from remote.
 */
export function gitPull(localPath: string): void {
    try {
        gitExec(localPath, 'pull', '--rebase', 'origin', 'main');
    } catch {
        try { gitExec(localPath, 'rebase', '--abort'); } catch { }
        try { gitExec(localPath, 'pull', 'origin', 'main'); } catch { }
    }
}

/**
 * Stage all changes, commit, and push to remote.
 * Automatically retries with pull --rebase if push is rejected.
 */
export function gitPush(localPath: string, message: string): void {
    gitExec(localPath, 'add', '-A');

    // Only commit if there are staged changes
    try {
        gitExec(localPath, 'diff', '--staged', '--quiet');
        return; // No changes
    } catch {
        // Has changes — proceed
    }

    gitExec(localPath, 'commit', '-m', `"${message.replace(/"/g, '\\"')}"`);

    // Push with retry: if remote has new commits (e.g. index.json from Actions),
    // pull --rebase and retry
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            gitExec(localPath, 'push', 'origin', 'main');
            return; // Success
        } catch {
            // Push rejected — pull and retry
            try {
                gitExec(localPath, 'pull', '--rebase', 'origin', 'main');
            } catch {
                // Rebase conflict — abort and try merge
                try { gitExec(localPath, 'rebase', '--abort'); } catch { }
                gitExec(localPath, 'pull', '--no-rebase', 'origin', 'main');
            }
        }
    }

    // Final attempt — if this fails, let the error propagate
    gitExec(localPath, 'push', 'origin', 'main');
}

/**
 * Check if a directory is a valid git repository.
 */
export function isGitRepo(dirPath: string): boolean {
    try {
        gitExec(dirPath, 'rev-parse', '--git-dir');
        return true;
    } catch {
        return false;
    }
}
