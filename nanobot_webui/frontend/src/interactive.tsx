import type { DataMessagePartProps } from '@assistant-ui/react';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import type {
  InteractiveHistoryItem,
  InteractiveInputPayload,
  InteractiveResultPayload,
  InteractiveSelectOption,
  InteractiveSelectPayload,
} from './types';

type InteractiveActionHandlers = {
  disabled?: boolean;
  resolve: (id: string, result: InteractiveResultPayload) => void;
  cancel: (id: string) => void;
};

const noopResolve = (_id: string, _result: InteractiveResultPayload) => undefined;
const noopCancel = (_id: string) => undefined;

const InteractiveActionsContext = createContext<InteractiveActionHandlers>({
  disabled: true,
  resolve: noopResolve,
  cancel: noopCancel,
});

function statusText(status: string): string {
  if (status === 'ok') {
    return '已完成';
  }
  if (status === 'cancelled') {
    return '已取消';
  }
  if (status === 'error') {
    return '失败';
  }
  return '等待操作';
}

function kindLabel(kind: string): string {
  if (kind === 'confirm') {
    return '确认';
  }
  if (kind === 'select') {
    return '选择';
  }
  if (kind === 'input') {
    return '输入';
  }
  return '交互';
}

function normalizeOptions(payload: InteractiveSelectPayload): InteractiveSelectOption[] {
  return Array.isArray(payload.options) ? payload.options.filter(Boolean) : [];
}

function selectedValues(result: InteractiveResultPayload | undefined): string[] {
  const value = result?.selected;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string' && value) {
    return [value];
  }
  return [];
}

function inputValue(result: InteractiveResultPayload | undefined): string {
  return typeof result?.value === 'string' ? result.value : '';
}

function confirmValue(result: InteractiveResultPayload | undefined): boolean | null {
  return typeof result?.confirmed === 'boolean' ? result.confirmed : null;
}

function resultSummary(interaction: InteractiveHistoryItem): string {
  if (interaction.status === 'cancelled') {
    return '用户已取消该交互。';
  }
  if (interaction.status === 'error') {
    return '交互执行失败。';
  }
  if (interaction.kind === 'confirm') {
    const value = confirmValue(interaction.result);
    if (value === true) {
      return '用户已确认。';
    }
    if (value === false) {
      return '用户选择了取消。';
    }
  }
  if (interaction.kind === 'select') {
    const payload = interaction.payload as InteractiveSelectPayload;
    const options = new Map(normalizeOptions(payload).map((option) => [option.value, option.label]));
    const values = selectedValues(interaction.result);
    if (values.length > 0) {
      return values.map((value) => options.get(value) ?? value).join('，');
    }
  }
  if (interaction.kind === 'input') {
    const value = inputValue(interaction.result);
    if (value) {
      return value;
    }
  }
  if (interaction.result) {
    try {
      return JSON.stringify(interaction.result, null, 2);
    } catch {
      return String(interaction.result);
    }
  }
  return '无返回结果';
}

function ConfirmBody({
  interaction,
  disabled,
  onResolve,
}: {
  interaction: InteractiveHistoryItem;
  disabled: boolean;
  onResolve: (result: InteractiveResultPayload) => void;
}) {
  const payload = interaction.payload as {
    title?: string;
    message?: string;
    confirm_text?: string;
    cancel_text?: string;
    variant?: string;
  };

  if (interaction.status !== 'pending') {
    return <div className="interactive-result">{resultSummary(interaction)}</div>;
  }

  return (
    <>
      {payload.message ? <p className="interactive-copy">{payload.message}</p> : null}
      <div className="interactive-actions">
        <button
          type="button"
          className="interactive-button secondary"
          disabled={disabled}
          onClick={() => onResolve({ confirmed: false })}
        >
          {payload.cancel_text ?? '取消'}
        </button>
        <button
          type="button"
          className={`interactive-button primary interactive-button-${payload.variant ?? 'info'}`}
          disabled={disabled}
          onClick={() => onResolve({ confirmed: true })}
        >
          {payload.confirm_text ?? '确认'}
        </button>
      </div>
    </>
  );
}

function SelectBody({
  interaction,
  disabled,
  onResolve,
  onCancel,
}: {
  interaction: InteractiveHistoryItem;
  disabled: boolean;
  onResolve: (result: InteractiveResultPayload) => void;
  onCancel: () => void;
}) {
  const payload = interaction.payload as InteractiveSelectPayload;
  const options = normalizeOptions(payload);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>(() => selectedValues(interaction.result));

  useEffect(() => {
    setSelected(selectedValues(interaction.result));
    setQuery('');
  }, [interaction.id, interaction.result]);

  if (interaction.status !== 'pending') {
    return <div className="interactive-result">{resultSummary(interaction)}</div>;
  }

  const filtered = query
    ? options.filter((option) => {
        const haystack = `${option.label} ${option.description ?? ''} ${option.value}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      })
    : options;

  const multiple = Boolean(payload.multiple);
  const canSubmit = selected.length > 0;

  return (
    <>
      {payload.description ? <p className="interactive-copy">{payload.description}</p> : null}
      {payload.searchable ? (
        <input
          className="interactive-search"
          type="search"
          value={query}
          placeholder={payload.placeholder ?? '搜索选项'}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="interactive-options">
        {filtered.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={`interactive-option${checked ? ' selected' : ''}${option.disabled ? ' disabled' : ''}`}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={interaction.id}
                value={option.value}
                checked={checked}
                disabled={disabled || Boolean(option.disabled)}
                onChange={() => {
                  if (multiple) {
                    setSelected((current) =>
                      checked ? current.filter((value) => value !== option.value) : [...current, option.value],
                    );
                    return;
                  }
                  setSelected([option.value]);
                }}
              />
              <span className="interactive-option-body">
                <span className="interactive-option-label">{option.label}</span>
                {option.description ? (
                  <span className="interactive-option-description">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {filtered.length === 0 ? <div className="interactive-empty">没有匹配的选项</div> : null}
      <div className="interactive-actions">
        <button type="button" className="interactive-button secondary" disabled={disabled} onClick={onCancel}>
          取消交互
        </button>
        <button
          type="button"
          className="interactive-button primary interactive-button-info"
          disabled={disabled || !canSubmit}
          onClick={() =>
            onResolve({
              selected: multiple ? selected : selected[0] ?? '',
            })
          }
        >
          提交选择
        </button>
      </div>
    </>
  );
}

function InputBody({
  interaction,
  disabled,
  onResolve,
  onCancel,
}: {
  interaction: InteractiveHistoryItem;
  disabled: boolean;
  onResolve: (result: InteractiveResultPayload) => void;
  onCancel: () => void;
}) {
  const payload = interaction.payload as InteractiveInputPayload;
  const [value, setValue] = useState(() => inputValue(interaction.result));

  useEffect(() => {
    setValue(inputValue(interaction.result));
  }, [interaction.id, interaction.result]);

  if (interaction.status !== 'pending') {
    return <div className="interactive-result">{resultSummary(interaction)}</div>;
  }

  const required = Boolean(payload.required_input);
  const canSubmit = !required || value.trim().length > 0;
  const controlClass = `interactive-input${payload.multiline ? ' multiline' : ''}`;

  return (
    <>
      {payload.description ? <p className="interactive-copy">{payload.description}</p> : null}
      {payload.multiline ? (
        <textarea
          className={controlClass}
          rows={4}
          value={value}
          placeholder={payload.placeholder ?? '输入内容'}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        <input
          className={controlClass}
          type={payload.password ? 'password' : 'text'}
          value={value}
          placeholder={payload.placeholder ?? '输入内容'}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      <div className="interactive-actions">
        <button type="button" className="interactive-button secondary" disabled={disabled} onClick={onCancel}>
          取消交互
        </button>
        <button
          type="button"
          className="interactive-button primary interactive-button-info"
          disabled={disabled || !canSubmit}
          onClick={() => onResolve({ value })}
        >
          提交输入
        </button>
      </div>
    </>
  );
}

export function InteractiveActionsProvider({
  children,
  value,
}: PropsWithChildren<{ value: InteractiveActionHandlers }>) {
  return <InteractiveActionsContext.Provider value={value}>{children}</InteractiveActionsContext.Provider>;
}

export function InteractiveBlock({
  interaction,
  disabled = false,
  onResolve = (_result: InteractiveResultPayload) => undefined,
  onCancel = () => undefined,
}: {
  interaction: InteractiveHistoryItem;
  disabled?: boolean;
  onResolve?: (result: InteractiveResultPayload) => void;
  onCancel?: () => void;
}) {
  const payloadTitle =
    typeof interaction.payload.title === 'string'
      ? interaction.payload.title
      : `${kindLabel(interaction.kind)}请求`;

  return (
    <section className={`interactive-card interactive-${interaction.kind}`} data-status={interaction.status}>
      <header className="interactive-header">
        <span className="interactive-kind">{kindLabel(interaction.kind)}</span>
        <span className={`interactive-status interactive-status-${interaction.status}`}>
          {statusText(interaction.status)}
        </span>
      </header>
      <div className="interactive-title">{payloadTitle}</div>
      {interaction.kind === 'confirm' ? (
        <ConfirmBody interaction={interaction} disabled={disabled} onResolve={onResolve} />
      ) : null}
      {interaction.kind === 'select' ? (
        <SelectBody interaction={interaction} disabled={disabled} onResolve={onResolve} onCancel={onCancel} />
      ) : null}
      {interaction.kind === 'input' ? (
        <InputBody interaction={interaction} disabled={disabled} onResolve={onResolve} onCancel={onCancel} />
      ) : null}
      {!['confirm', 'select', 'input'].includes(interaction.kind) ? (
        <div className="interactive-result">{resultSummary(interaction)}</div>
      ) : null}
    </section>
  );
}

export function InteractiveDataPart({
  data,
}: DataMessagePartProps<InteractiveHistoryItem>) {
  const actions = useContext(InteractiveActionsContext);

  return (
    <InteractiveBlock
      interaction={data}
      disabled={Boolean(actions.disabled) || data.status !== 'pending'}
      onResolve={(result) => actions.resolve(data.id, result)}
      onCancel={() => actions.cancel(data.id)}
    />
  );
}
