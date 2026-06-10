import { Check, ChevronDown } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

function joinClassNames(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(' ');
}

export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  ariaLabel,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(() => options.find((item) => item.value === value), [options, value]);
  const displayLabel = selectedOption?.label || placeholder;
  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(180, Math.min(520, viewportWidth - margin * 2));
    const widthForClamping = Math.min(maxWidth, Math.max(rect.width, 240));
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - margin - widthForClamping));
    const spaceBelow = viewportHeight - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;
    const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(320, Math.max(spaceBelow, spaceAbove)));
    const top = placeAbove
      ? Math.max(margin, rect.top - gap - maxHeight)
      : Math.min(rect.bottom + gap, Math.max(margin, viewportHeight - margin - maxHeight));

    setMenuStyle({
      left,
      top,
      minWidth: rect.width,
      maxWidth,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updateMenuPosition();
    }
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div className="app-select-menu" role="listbox" aria-label={ariaLabel || placeholder} ref={menuRef} style={menuStyle}>
            {options.length ? (
              options.map((item) => {
                const selected = item.value === value;
                return (
                  <button
                    key={item.value}
                    className={joinClassNames('app-select-option', selected && 'is-selected')}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={item.disabled}
                    onClick={() => {
                      if (!item.disabled) {
                        onChange(item.value);
                        setOpen(false);
                      }
                    }}
                  >
                    <span className="app-select-option-copy">
                      <strong>{item.label}</strong>
                      {item.description ? <small>{item.description}</small> : null}
                    </span>
                    {selected ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })
            ) : (
              <div className="app-select-empty">暂无可选项</div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={joinClassNames('app-select', open && 'is-open', disabled && 'is-disabled', className)} ref={rootRef}>
      <button
        className="app-select-trigger"
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={joinClassNames('app-select-value', !selectedOption && 'is-placeholder')}>{displayLabel}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {menu}
    </div>
  );
}
