/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(localPath: string): Promise<boolean> {
    const fs = await import('fs');
    const path = await import('path');
    return fs.existsSync(path.join(localPath, '.git'));
}
