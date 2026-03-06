import * as vscode from 'vscode';
import { SkillEntry, GitHubClient } from '../github';
import { discoverConfig, getToken } from '../config';

/**
 * Open a Webview panel showing the skill detail with beautiful UI.
 */
export function createSkillDetailPanel(
  context: vscode.ExtensionContext,
  skill: SkillEntry
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'anyskillDetail',
    `${skill.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
      ],
    }
  );

  // Get codicon CSS URI for the Webview
  const codiconCssUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
  );

  // Set loading state first
  panel.webview.html = getLoadingHtml(skill.name, codiconCssUri);

  // Load actual content
  loadSkillContent(panel, skill, codiconCssUri);

  // Handle messages from webview
  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'download':
          vscode.commands.executeCommand('anyskill.downloadSkill', skill);
          break;
        case 'load':
          vscode.commands.executeCommand('anyskill.loadSkill', skill);
          break;
        case 'delete':
          vscode.commands.executeCommand('anyskill.deleteSkill', skill);
          break;
        case 'copyContent':
          await vscode.env.clipboard.writeText(message.text);
          vscode.window.showInformationMessage('Copied to clipboard | 已复制到剪贴板');
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

async function loadSkillContent(
  panel: vscode.WebviewPanel,
  skill: SkillEntry,
  codiconCssUri: vscode.Uri
): Promise<void> {
  try {
    const config = discoverConfig();
    if (!config) {
      panel.webview.html = getErrorHtml('AnySkill config not found. Please initialize first | 未找到配置，请先初始化', codiconCssUri);
      return;
    }

    const token = getToken(config);
    const client = new GitHubClient(config.repo, config.branch, token);

    // Fetch the main SKILL.md content
    const content = await client.fetchFileContent(skill.file);

    panel.webview.html = getDetailHtml(skill, content, codiconCssUri);
  } catch (err: any) {
    panel.webview.html = getErrorHtml(`Load failed | 加载失败: ${err.message}`, codiconCssUri);
  }
}

function getLoadingHtml(name: string, codiconCssUri: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${codiconCssUri}">
  <style>${getStyles()}</style>
</head>
<body>
  <div class="container">
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading <strong>${escapeHtml(name)}</strong> ...</p>
    </div>
  </div>
</body>
</html>`;
}

function getErrorHtml(message: string, codiconCssUri: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="${codiconCssUri}">
  <style>${getStyles()}</style>
</head>
<body>
  <div class="container">
    <div class="error-card">
      <span class="error-icon codicon codicon-warning"></span>
      <p>${escapeHtml(message)}</p>
    </div>
  </div>
</body>
</html>`;
}

function getDetailHtml(skill: SkillEntry, content: string, codiconCssUri: vscode.Uri): string {
  // Extract frontmatter
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  let bodyContent = content;
  let frontmatter: Record<string, string> = {};

  if (fmMatch) {
    bodyContent = content.substring(fmMatch[0].length).trim();
    for (const line of fmMatch[1].split('\n')) {
      const i = line.indexOf(':');
      if (i !== -1) {
        frontmatter[line.substring(0, i).trim()] = line.substring(i + 1).trim();
      }
    }
  }

  // Simple markdown to HTML conversion
  const htmlContent = markdownToHtml(bodyContent);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${codiconCssUri}">
  <style>${getStyles()}</style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <div class="skill-icon codicon codicon-symbol-method"></div>
        <div class="header-text">
          <h1>${escapeHtml(skill.name)}</h1>
          <p class="description">${escapeHtml(skill.description || 'No description | 暂无描述')}</p>
        </div>
      </div>
      <div class="meta-badges">
        <span class="badge">${skill.files.length} files | 个文件</span>
        ${frontmatter.version ? `<span class="badge badge-version">v${escapeHtml(frontmatter.version)}</span>` : ''}
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="actions">
      <button class="btn btn-primary" onclick="sendMessage('download')">
        <span class="codicon codicon-cloud-download"></span> Download | 下载到本地
      </button>
      <button class="btn btn-secondary" onclick="sendMessage('load')">
        <span class="codicon codicon-eye"></span> Load to Editor | 加载到编辑器
      </button>
      <button class="btn btn-ghost" onclick="copyContent()">
        <span class="codicon codicon-copy"></span> Copy | 复制内容
      </button>
      <button class="btn btn-danger" onclick="confirmDelete()">
        <span class="codicon codicon-trash"></span> Delete | 删除
      </button>
    </div>

    <!-- Files List -->
    <div class="section">
      <h2>Files | 文件列表</h2>
      <div class="file-list">
        ${skill.files.map((f) => `
          <div class="file-item">
            <span class="codicon codicon-${f.endsWith('.md') ? 'markdown' : 'file'}"></span>
            <span class="file-name">${escapeHtml(f)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Content -->
    <div class="section">
      <h2>Content | 技能内容</h2>
      <div class="content-card">
        ${htmlContent}
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const rawContent = ${JSON.stringify(content)};

    function sendMessage(command) {
      vscode.postMessage({ command });
    }

    function copyContent() {
      vscode.postMessage({ command: 'copyContent', text: rawContent });
    }

    function confirmDelete() {
      if (confirm('Delete this skill? This cannot be undone. | 确定要删除吗？不可撤销。')) {
        sendMessage('delete');
      }
    }
  </script>
</body>
</html>`;
}

function getStyles(): string {
  return `
    :root {
      --bg: var(--vscode-editor-background, #1e1e2e);
      --fg: var(--vscode-editor-foreground, #cdd6f4);
      --card-bg: var(--vscode-editorWidget-background, #313244);
      --border: var(--vscode-widget-border, #45475a);
      --accent: var(--vscode-textLink-foreground, #89b4fa);
      --accent-hover: var(--vscode-textLink-activeForeground, #74c7ec);
      --danger: #f38ba8;
      --success: #a6e3a1;
      --warning: #f9e2af;
      --subtle: var(--vscode-descriptionForeground, #a6adc8);
      --radius: 12px;
      --radius-sm: 8px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.7;
      padding: 0;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 32px;
    }

    /* Loading */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 300px;
      gap: 16px;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s ease-in-out infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, rgba(137,180,250,0.1), rgba(203,166,247,0.08));
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
      margin-bottom: 20px;
    }

    .header-content {
      display: flex;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 14px;
    }

    .skill-icon {
      font-size: 36px;
      flex-shrink: 0;
      color: var(--accent);
      filter: drop-shadow(0 2px 8px rgba(137,180,250,0.3));
    }

    .header-text h1 {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }

    .description {
      color: var(--subtle);
      font-size: 14px;
      line-height: 1.5;
    }

    .meta-badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(137,180,250,0.15);
      color: var(--accent);
      border: 1px solid rgba(137,180,250,0.2);
    }

    .badge-version {
      background: rgba(166,227,161,0.15);
      color: var(--success);
      border-color: rgba(166,227,161,0.2);
    }

    /* Actions */
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      background: var(--card-bg);
      color: var(--fg);
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--accent), #b4befe);
      color: #1e1e2e;
      border-color: transparent;
      font-weight: 600;
    }

    .btn-primary:hover {
      opacity: 0.9;
    }

    .btn-secondary {
      background: rgba(137,180,250,0.12);
      border-color: rgba(137,180,250,0.3);
      color: var(--accent);
    }

    .btn-ghost {
      background: transparent;
      border-color: var(--border);
    }

    .btn-danger {
      background: rgba(243,139,168,0.1);
      border-color: rgba(243,139,168,0.3);
      color: var(--danger);
    }

    .btn-danger:hover {
      background: rgba(243,139,168,0.2);
    }

    .btn .codicon {
      font-size: 14px;
    }

    /* Sections */
    .section {
      margin-bottom: 24px;
    }

    .section h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    /* File list */
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      background: var(--card-bg);
      border: 1px solid var(--border);
      font-size: 13px;
      transition: background 0.15s ease;
    }

    .file-item:hover {
      background: rgba(137,180,250,0.08);
    }

    .file-icon {
      flex-shrink: 0;
    }

    .file-name {
      font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
      color: var(--subtle);
      font-size: 12px;
    }

    /* Content card */
    .content-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      font-size: 14px;
      line-height: 1.8;
    }

    .content-card h1, .content-card h2, .content-card h3 {
      margin-top: 20px;
      margin-bottom: 10px;
      color: var(--fg);
    }

    .content-card h1 { font-size: 22px; }
    .content-card h2 { font-size: 18px; }
    .content-card h3 { font-size: 15px; }

    .content-card p {
      margin-bottom: 12px;
    }

    .content-card code {
      background: rgba(137,180,250,0.12);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'SF Mono', Consolas, monospace;
    }

    .content-card pre {
      background: rgba(17,17,27,0.7);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 16px;
      overflow-x: auto;
      margin: 12px 0;
    }

    .content-card pre code {
      background: none;
      padding: 0;
      font-size: 13px;
      line-height: 1.6;
    }

    .content-card ul, .content-card ol {
      margin: 8px 0;
      padding-left: 24px;
    }

    .content-card li {
      margin-bottom: 4px;
    }

    .content-card blockquote {
      border-left: 3px solid var(--accent);
      padding: 8px 16px;
      margin: 12px 0;
      background: rgba(137,180,250,0.06);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }

    .content-card table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
    }

    .content-card th, .content-card td {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
      font-size: 13px;
    }

    .content-card th {
      background: rgba(137,180,250,0.08);
      font-weight: 600;
    }

    .content-card hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 20px 0;
    }

    /* Error */
    .error-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px;
      background: rgba(243,139,168,0.1);
      border: 1px solid rgba(243,139,168,0.3);
      border-radius: var(--radius);
      margin: 40px 0;
    }

    .error-icon {
      font-size: 24px;
    }
  `;
}

/**
 * Simple markdown to HTML converter (no external deps).
 * Handles headings, paragraphs, code blocks, inline code, bold, italic, links,
 * lists, blockquotes, tables, and horizontal rules.
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inCodeBlock = false;
  let inList = false;
  let listType = '';
  let inTable = false;
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html += '</code></pre>';
        inCodeBlock = false;
      } else {
        const lang = line.trim().substring(3).trim();
        html += `<pre><code class="language-${escapeHtml(lang)}">`;
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      html += escapeHtml(line) + '\n';
      continue;
    }

    // Close blockquote if line doesn't start with >
    if (inBlockquote && !line.trimStart().startsWith('>')) {
      html += '</blockquote>';
      inBlockquote = false;
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      if (inTable) {
        html += '</table>';
        inTable = false;
      }
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())) {
      html += '<hr>';
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html += `<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('>')) {
      if (!inBlockquote) {
        html += '<blockquote>';
        inBlockquote = true;
      }
      const content = line.replace(/^\s*>\s?/, '');
      html += `<p>${inlineFormat(content)}</p>`;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inList || listType !== 'ul') {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; }
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      const content = line.replace(/^\s*[-*+]\s+/, '');
      html += `<li>${inlineFormat(content)}</li>`;
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inList || listType !== 'ol') {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; }
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      const content = line.replace(/^\s*\d+\.\s+/, '');
      html += `<li>${inlineFormat(content)}</li>`;
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim() !== '');

      // Check if next line is a separator
      if (i + 1 < lines.length && /^\|?\s*[-:]+\s*\|/.test(lines[i + 1])) {
        // This is a header row
        if (!inTable) {
          html += '<table>';
          inTable = true;
        }
        html += '<tr>' + cells.map(c => `<th>${inlineFormat(c.trim())}</th>`).join('') + '</tr>';
        i++; // skip separator
        continue;
      }

      if (!inTable) {
        html += '<table>';
        inTable = true;
      }
      html += '<tr>' + cells.map(c => `<td>${inlineFormat(c.trim())}</td>`).join('') + '</tr>';
      continue;
    }

    // Regular paragraph
    if (inList) {
      html += listType === 'ul' ? '</ul>' : '</ol>';
      inList = false;
    }
    html += `<p>${inlineFormat(line)}</p>`;
  }

  // Close any open blocks
  if (inCodeBlock) { html += '</code></pre>'; }
  if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; }
  if (inTable) { html += '</table>'; }
  if (inBlockquote) { html += '</blockquote>'; }

  return html;
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:var(--accent)">$1</a>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
