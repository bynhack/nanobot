import type { HistoryMessage } from './types';

export interface PendingAskUserPrompt {
  question: string;
  buttons: string[][];
  kind: 'confirm' | 'select' | 'input';
}

function hasButtons(message: HistoryMessage): message is Extract<HistoryMessage, { type: 'assistant' }> & { buttons: string[][] } {
  return (
    message.type === 'assistant'
    && Array.isArray(message.buttons)
    && message.buttons.some((row) => Array.isArray(row) && row.some(Boolean))
  );
}

export function findPendingAskUserPrompt(messages: readonly HistoryMessage[]): PendingAskUserPrompt | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.type === 'user') {
      return null;
    }
    if (hasButtons(message)) {
      const labels = message.buttons.flat().filter(Boolean);
      const normalized = labels.map((label) => label.trim());
      const isConfirm =
        normalized.length === 2
        && normalized.includes('确认')
        && normalized.includes('取消');
      return {
        question: message.content,
        buttons: message.buttons,
        kind: isConfirm ? 'confirm' : 'select',
      };
    }
    if (message.type === 'assistant' || message.type === 'outbound') {
      return null;
    }
  }
  return null;
}
