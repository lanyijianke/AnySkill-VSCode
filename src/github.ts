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
     * Fetch index.json from the user's skill repository
     */
    async fetchIndex(): Promise<SkillEntry[]> {
        const url = `${this.baseRawUrl}/index.json`;
        const body = await fetchUrl(url, this.token);
        return JSON.parse(body) as SkillEntry[];
    }

    /**
     * Fetch a single file's content from the skill repository
     */
    async fetchFileContent(filePath: string): Promise<string> {
        const url = `${this.baseRawUrl}/skills/${filePath}`;
        return fetchUrl(url, this.token);
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
}
