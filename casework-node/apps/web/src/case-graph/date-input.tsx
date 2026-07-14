interface CaseGraphDateInputProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  includeTime?: boolean;
}

export function CaseGraphDateInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  disabled = false,
  includeTime = false,
}: CaseGraphDateInputProps) {
  const type = includeTime ? 'datetime-local' : 'date';

  return (
    <span className="case-graph-date-input-wrap">
      <input
        type={type}
        value={normalizeNativeDateValue(value, includeTime)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        step={includeTime ? 60 : undefined}
        className="case-graph-date-input"
      />
    </span>
  );
}

function normalizeNativeDateValue(value: string, includeTime: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return includeTime ? trimmed.slice(0, 16) : trimmed.slice(0, 10);
}
