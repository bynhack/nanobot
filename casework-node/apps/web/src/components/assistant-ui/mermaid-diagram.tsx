import { useAuiState } from '@assistant-ui/react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-streamdown';
import mermaid from 'mermaid';
import { useEffect, useRef } from 'react';

export type MermaidDiagramProps = SyntaxHighlighterProps & {
  className?: string;
};

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
});

export function MermaidDiagram({
  code,
  className,
  node: _node,
  components: _components,
  language: _language,
}: MermaidDiagramProps) {
  const ref = useRef<HTMLPreElement>(null);

  const isComplete = useAuiState((state) => {
    if (state.part.type !== 'text') {
      return false;
    }

    const codeIndex = state.part.text.indexOf(code);
    if (codeIndex === -1) {
      return false;
    }

    const afterCode = state.part.text.slice(codeIndex + code.length);
    return /^```|^\n```/.test(afterCode);
  });

  useEffect(() => {
    if (!isComplete) {
      return;
    }

    void (async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const result = await mermaid.render(id, code);
        if (ref.current) {
          ref.current.innerHTML = result.svg;
          result.bindFunctions?.(ref.current);
        }
      } catch (error) {
        console.warn('Failed to render Mermaid diagram:', error);
      }
    })();
  }, [code, isComplete]);

  return (
    <pre ref={ref} className={`aui-mermaid-diagram${className ? ` ${className}` : ''}`}>
      正在绘制图表...
    </pre>
  );
}
