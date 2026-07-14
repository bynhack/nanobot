import { useCallback, useEffect, useRef, useState } from 'react';

import type { PendingAskUserPrompt } from './ask-user';
import { renderMarkdownHtml } from './markdown';

export function normalizeAskUserQuestionMarkdown(raw: string): string {
  const text = raw.trim();
  if (!text || text.includes('\n') || !text.startsWith('# ')) {
    return raw;
  }

  const boldIndex = text.indexOf('**');
  const prefix = boldIndex >= 0 ? text.slice(0, boldIndex).trim() : text;
  const suffix = boldIndex >= 0 ? text.slice(boldIndex).trim() : '';
  const segments = prefix.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);

  if (segments.length < 2 || !segments[0].startsWith('# ')) {
    return raw;
  }

  const lines = [segments[0], ...segments.slice(1).map((segment) => `- ${segment}`)];
  if (suffix) {
    lines.push('', suffix);
  }

  return lines.join('\n');
}

export function AskUserPromptCard({
  prompt,
  disabled = false,
  onAnswer,
}: {
  prompt: PendingAskUserPrompt;
  disabled?: boolean;
  onAnswer: (answer: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const options = prompt.buttons.flat().filter(Boolean);
  const isConfirm = prompt.kind === 'confirm';
  const questionHtml = renderMarkdownHtml(normalizeAskUserQuestionMarkdown(prompt.question));

  useEffect(() => {
    if (customOpen) {
      inputRef.current?.focus();
    }
  }, [customOpen]);

  const submitCustom = useCallback(() => {
    const answer = custom.trim();
    if (!answer || disabled) {
      return;
    }
    onAnswer(answer);
    setCustom('');
    setCustomOpen(false);
  }, [custom, disabled, onAnswer]);

  if (!options.length) {
    return null;
  }

  return (
    <div className={`ask-user-card ask-user-${prompt.kind}`} role="group" aria-label="等待用户确认">
      <div className="ask-user-title">{isConfirm ? '等待确认' : '等待选择'}</div>
      <div
        className="ask-user-question markdown-body"
        dangerouslySetInnerHTML={{ __html: questionHtml }}
      />
      <div className="ask-user-options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`ask-user-option${isConfirm ? ' confirm' : ''}`}
            disabled={disabled}
            onClick={() => onAnswer(option)}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          className="ask-user-option ghost"
          disabled={disabled}
          onClick={() => setCustomOpen((open) => !open)}
        >
          其他回复
        </button>
      </div>
      {customOpen ? (
        <div className="ask-user-custom">
          <textarea
            ref={inputRef}
            rows={2}
            className="ask-user-textarea"
            placeholder="输入你的回复…"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitCustom();
              }
            }}
          />
          <button
            type="button"
            className="ask-user-submit"
            disabled={disabled || !custom.trim()}
            onClick={submitCustom}
          >
            发送
          </button>
        </div>
      ) : null}
    </div>
  );
}
