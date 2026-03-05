import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Clone a repository to a local path
 */
export async function cloneRepo(
    repo: string,
    localPath: string,
    token?: string
): Promise<void> {
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    let cloneUrl: string;
    if (token) {
        cloneUrl = `https://${token}@github.com/${repo}.git`;
    } else {
        cloneUrl = `https://github.com/${repo}.git`;
    }

    const git = simpleGit();
    await git.clone(cloneUrl, localPath);
}

/**
 * Add all changes, commit, and push
 */
export async function addCommitPush(
    localPath: string,
    message: string,
    branch: string = 'main'
): Promise<void> {
    const git: SimpleGit = simpleGit(localPath);
    await git.add('-A');
    await git.commit(message);
    // Pull rebase to avoid rejection when remote has newer commits
    try {
        await git.pull('origin', branch, { '--rebase': null });
    } catch {
        // ignore pull errors (e.g. nothing to pull, no tracking branch)
    }
    await git.push('origin', branch);
}

/**
 * Remove a file/directory from git and commit
 */
export async function removeAndPush(
    localPath: string,
    targetPath: string,
    commitMessage: string,
    branch: string = 'main'
): Promise<void> {
    const git: SimpleGit = simpleGit(localPath);
    const fullPath = path.join(localPath, targetPath);

    if (fs.existsSync(fullPath)) {
        await git.rm(['-rf', targetPath]);
    }

    await git.commit(commitMessage);
    await git.push('origin', branch);
}

/**
 * Pull latest changes
 */
export async function pullLatest(
    localPath: string,
    branch: string = 'main'
): Promise<void> {
    const git: SimpleGit = simpleGit(localPath);
    await git.pull('origin', branch);
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(localPath: string): Promise<boolean> {
    try {
        const git: SimpleGit = simpleGit(localPath);
        return await git.checkIsRepo();
    } catch {
        return false;
    }
}
