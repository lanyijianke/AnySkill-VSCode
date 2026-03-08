import * as https from 'https';
import * as http from 'http';

export interface SkillEntry {
    name: string;
    description: string;
    category: string;
    path: string;
    file: string;
    files: string[];
}

export interface PackEntry {
    category: string;
    skills: SkillEntry[];
}

export interface PacksIndex {
    packs: PackEntry[];
}

export interface VersionInfo {
    engine: {
        version: string;
        changelog: { version: string; date: string; changes: string[] }[];
    };
    infra: {
        version: string;
        files: string[];
        changelog: { version: string; date: string; changes: string[] }[];
    };
}

export interface GitHubUser {
    login: string;
    name: string;
    avatar_url: string;
}

export interface SearchResult {
    total_count: number;
    items: { full_name: string; name: string; default_branch: string }[];
}

/**
 * Make an HTTPS GET request and return the response body as string.
 */
function fetchUrl(url: string, token?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options: https.RequestOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'AnySkill-VSCode/0.1.0',
                'Accept': 'application/vnd.github.v3+json',
            },
        };

        if (token) {
            (options.headers as Record<string, string>)['Authorization'] = `token ${token}`;
        }

        const client = parsedUrl.protocol === 'https:' ? https : http;
        const req = client.get(options, (res) => {
            // Follow redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    fetchUrl(redirectUrl, token).then(resolve, reject);
                    return;
                }
            }

            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}: ${url}`));
                return;
            }

            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * GitHub API client for AnySkill operations
 */
export class GitHubClient {
    private baseRawUrl: string;
    private token?: string;

    constructor(
        private repo: string,
        private branch: string,
        token?: string
    ) {
        this.token = token;
        this.baseRawUrl = `https://raw.githubusercontent.com/${repo}/${branch}`;
    }

    /**
     * Fetch index.json from the user's skill repository (via API for private repo support)
     */
    async fetchIndex(): Promise<SkillEntry[]> {
        const url = `https://api.github.com/repos/${this.repo}/contents/index.json?ref=${this.branch}`;
        const body = await fetchUrl(url, this.token);
        const data = JSON.parse(body);
        // GitHub API returns base64-encoded content
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return JSON.parse(content) as SkillEntry[];
    }

    /**
     * Fetch a single file's content from the skill repository (via API for private repo support)
     */
    async fetchFileContent(filePath: string): Promise<string> {
        const url = `https://api.github.com/repos/${this.repo}/contents/skills/${filePath}?ref=${this.branch}`;
        const body = await fetchUrl(url, this.token);
        const data = JSON.parse(body);
        return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    /**
     * Fetch the AnySkill-Packs public index
     */
    async fetchPacksIndex(): Promise<PacksIndex> {
        const url = 'https://raw.githubusercontent.com/lanyijianke/AnySkill-Packs/main/index.json';
        const body = await fetchUrl(url);
        return JSON.parse(body) as PacksIndex;
    }

    /**
     * Fetch a file from AnySkill-Packs public repo
     */
    async fetchPackFile(filePath: string): Promise<string> {
        const url = `https://raw.githubusercontent.com/lanyijianke/AnySkill-Packs/main/packs/${filePath}`;
        return fetchUrl(url);
    }

    /**
     * Fetch version.json from upstream AnySkill template repo
     */
    async fetchVersionInfo(): Promise<VersionInfo> {
        const url = 'https://raw.githubusercontent.com/lanyijianke/AnySkill/main/version.json';
        const body = await fetchUrl(url);
        return JSON.parse(body) as VersionInfo;
    }

    /**
     * Get the authenticated user's info
     */
    async getUserInfo(): Promise<GitHubUser> {
        const url = 'https://api.github.com/user';
        const body = await fetchUrl(url, this.token);
        return JSON.parse(body) as GitHubUser;
    }

    /**
 * Search for AnySkill repositories under a user.
 * Excludes known public repos (AnySkill engine, AnySkill-Packs).
 */
    async searchRepos(login: string): Promise<SearchResult> {
        const url = `https://api.github.com/search/repositories?q=user:${login}+anyskill+OR+skill+OR+skills+in:name,description`;
        const body = await fetchUrl(url, this.token);
        const result = JSON.parse(body) as SearchResult;

        // Filter out known public repos that are NOT the user's private skills
        const excludeNames = ['AnySkill', 'AnySkill-Packs'];
        result.items = result.items.filter(item => {
            const repoName = item.full_name.split('/').pop() || '';
            return !excludeNames.includes(repoName);
        });
        result.total_count = result.items.length;

        // Sort: prefer private repos, then forks, then others
        result.items.sort((a: any, b: any) => {
            if (a.private && !b.private) { return -1; }
            if (!a.private && b.private) { return 1; }
            if (a.fork && !b.fork) { return -1; }
            if (!a.fork && b.fork) { return 1; }
            return 0;
        });

        return result;
    }

    /**
 * Verify a candidate repo is a private AnySkill skills repo.
 * Checks for skills/ directory (not just index.json, since the public engine also has that).
 */
    async verifyRepo(fullName: string, branch: string = 'main'): Promise<SkillEntry[] | null> {
        try {
            // Check for skills/ directory via GitHub API contents
            const contentsUrl = `https://api.github.com/repos/${fullName}/contents/skills?ref=${branch}`;
            const body = await fetchUrl(contentsUrl, this.token);
            const contents = JSON.parse(body);

            // If skills/ exists and is an array (directory listing), this is a skills repo
            if (Array.isArray(contents)) {
                // Also try to fetch index.json for the full entry list
                try {
                    const indexUrl = `https://raw.githubusercontent.com/${fullName}/${branch}/index.json`;
                    const indexBody = await fetchUrl(indexUrl, this.token);
                    return JSON.parse(indexBody);
                } catch {
                    // skills/ exists but no index.json yet — still valid
                    return [];
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    // ── GitHub Contents API (Write Operations) ──────────

    /**
     * Make an HTTPS request with JSON body support (PUT, DELETE, etc.)
     */
    private apiRequest(url: string, method: string, body?: object): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const bodyStr = body ? JSON.stringify(body) : undefined;

            const options: https.RequestOptions = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method,
                headers: {
                    'User-Agent': 'AnySkill-VSCode/0.4.5',
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                },
            };

            if (this.token) {
                (options.headers as Record<string, string>)['Authorization'] = `token ${this.token}`;
            }
            if (bodyStr) {
                (options.headers as Record<string, string>)['Content-Length'] = Buffer.byteLength(bodyStr).toString();
            }

            const req = https.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const responseBody = Buffer.concat(chunks).toString('utf-8');
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
                        return;
                    }
                    resolve(responseBody);
                });
                res.on('error', reject);
            });

            req.on('error', reject);
            if (bodyStr) {
                req.write(bodyStr);
            }
            req.end();
        });
    }

    /**
     * Get the contents (file list) of a directory in the repo.
     */
    async getDirectoryContents(dirPath: string): Promise<{ name: string; path: string; sha: string; type: string }[]> {
        const url = `https://api.github.com/repos/${this.repo}/contents/${dirPath}?ref=${this.branch}`;
        const body = await fetchUrl(url, this.token);
        return JSON.parse(body);
    }

    /**
     * Get the SHA of a file (needed for update/delete operations).
     * Returns null if the file doesn't exist.
     */
    async getFileSha(filePath: string): Promise<string | null> {
        try {
            const url = `https://api.github.com/repos/${this.repo}/contents/${filePath}?ref=${this.branch}`;
            const body = await fetchUrl(url, this.token);
            const data = JSON.parse(body);
            return data.sha || null;
        } catch {
            return null;
        }
    }

    /**
     * Create or update a file in the repo via GitHub Contents API.
     * PUT /repos/{owner}/{repo}/contents/{path}
     * @param knownSha - If provided, skip the SHA lookup and use this value directly.
     */
    async createOrUpdateFile(filePath: string, content: string, message: string, knownSha?: string): Promise<void> {
        const url = `https://api.github.com/repos/${this.repo}/contents/${filePath}`;
        const encoded = Buffer.from(content, 'utf-8').toString('base64');

        const payload: any = {
            message,
            content: encoded,
            branch: this.branch,
        };

        // Use known SHA if provided, otherwise look it up
        const sha = knownSha !== undefined ? knownSha : await this.getFileSha(filePath);
        if (sha) {
            payload.sha = sha;
        }

        await this.apiRequest(url, 'PUT', payload);
    }

    /**
     * Delete a single file from the repo via GitHub Contents API.
     * DELETE /repos/{owner}/{repo}/contents/{path}
     */
    async deleteFile(filePath: string, message: string): Promise<void> {
        const sha = await this.getFileSha(filePath);
        if (!sha) {
            return; // File doesn't exist, nothing to delete
        }

        const url = `https://api.github.com/repos/${this.repo}/contents/${filePath}`;
        await this.apiRequest(url, 'DELETE', {
            message,
            sha,
            branch: this.branch,
        });
    }

    /**
     * Delete an entire directory by deleting all files within it recursively.
     * GitHub API doesn't support directory deletion directly.
     */
    async deleteDirectory(dirPath: string, message: string): Promise<void> {
        try {
            const contents = await this.getDirectoryContents(dirPath);
            for (const item of contents) {
                if (item.type === 'dir') {
                    await this.deleteDirectory(item.path, message);
                } else {
                    await this.apiRequest(
                        `https://api.github.com/repos/${this.repo}/contents/${item.path}`,
                        'DELETE',
                        { message, sha: item.sha, branch: this.branch }
                    );
                }
            }
        } catch {
            // Directory might not exist, ignore
        }
    }

    /**
     * Get category folder names from the skills/ directory in the repo.
     */
    async getCategories(): Promise<string[]> {
        try {
            const contents = await this.getDirectoryContents('skills');
            return contents
                .filter(item => item.type === 'dir')
                .map(item => item.name);
        } catch {
            return [];
        }
    }
}
