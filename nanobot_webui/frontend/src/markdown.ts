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
  breaks: true,
  gfm: true,
});

const INLINE_LATEX_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\$\\rightarrow\$/g, '→'],
  [/\$\\leftarrow\$/g, '←'],
  [/\$\\Rightarrow\$/g, '⇒'],
  [/\$\\Leftarrow\$/g, '⇐'],
  [/\$\\leftrightarrow\$/g, '↔'],
  [/\$\\Leftrightarrow\$/g, '⇔'],
];

const INLINE_BOLD_PATTERN = /\*\*([^*\n]+)\*\*/g;

export function normalizeInlineArtifacts(raw: string): string {
  let normalized = raw;
  for (const [pattern, replacement] of INLINE_LATEX_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized.replace(INLINE_BOLD_PATTERN, '<strong>$1</strong>');
  return normalized;
}

function enhanceCodeBlocks(host: ParentNode): void {
  host.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
    const pre = block.parentElement;
    if (!pre || pre.parentElement?.classList.contains('code-block-shell')) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-shell';
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = '复制';
    button.addEventListener('click', () => {
      navigator.clipboard.writeText((block as HTMLElement).innerText);
      button.textContent = '已复制';
      window.setTimeout(() => {
        button.textContent = '复制';
      }, 1500);
    });
    wrapper.appendChild(button);
  });
}

export function renderMarkdownHtml(raw: string): string {
  const html = marked.parse(normalizeInlineArtifacts(raw)) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });
}

export function enhanceMarkdownHost(host: ParentNode): void {
  enhanceCodeBlocks(host);
}

export function renderMarkdown(raw: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'markdown-body';
  host.innerHTML = renderMarkdownHtml(raw);
  enhanceMarkdownHost(host);
  return host;
}
