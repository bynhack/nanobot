import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { marked } from 'marked';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);

marked.setOptions({
  gfm: true,
});

const sanitizeHtml = (() => {
  const sanitizer = DOMPurify as unknown as {
    sanitize?: (html: string, options?: { USE_PROFILES?: { html?: boolean } }) => string;
  };
  if (typeof sanitizer.sanitize === 'function') {
    return sanitizer.sanitize.bind(DOMPurify);
  }
  return (html: string) => html;
})();

const INLINE_LATEX_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\$\\rightarrow\$/g, '→'],
  [/\$\\leftarrow\$/g, '←'],
  [/\$\\Rightarrow\$/g, '⇒'],
  [/\$\\Leftarrow\$/g, '⇐'],
  [/\$\\leftrightarrow\$/g, '↔'],
  [/\$\\Leftrightarrow\$/g, '⇔'],
];

export function normalizeInlineArtifacts(raw: string): string {
  let normalized = raw;
  for (const [pattern, replacement] of INLINE_LATEX_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function enhanceCodeBlocks(host: ParentNode): void {
  host.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
  });
}

export function renderMarkdownHtml(raw: string): string {
  const html = marked.parse(normalizeInlineArtifacts(raw)) as string;
  return sanitizeHtml(html, {
    USE_PROFILES: { html: true },
  });
}

function wrapTables(host: ParentNode): void {
  host.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

export function enhanceMarkdownHost(host: ParentNode): void {
  enhanceCodeBlocks(host);
  wrapTables(host);
}

export function renderMarkdown(raw: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'markdown-body';
  host.innerHTML = renderMarkdownHtml(raw);
  enhanceMarkdownHost(host);
  return host;
}
