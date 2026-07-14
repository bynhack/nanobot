import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  size?: ModalSize;
  ariaLabel?: string;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  overlayClassName?: string;
}

function joinClassNames(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(' ');
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  headerActions,
  onClose,
  closeDisabled = false,
  closeOnBackdrop = true,
  size = 'md',
  ariaLabel,
  className,
  bodyClassName,
  headerClassName,
  footerClassName,
  overlayClassName,
}: ModalProps) {
  if (!open) {
    return null;
  }

  const handleBackdropMouseDown = () => {
    if (closeOnBackdrop && !closeDisabled) {
      onClose?.();
    }
  };

  return (
    <div className={joinClassNames('app-modal-overlay', overlayClassName)} role="presentation" onMouseDown={handleBackdropMouseDown}>
      <section
        className={joinClassNames('app-modal-shell', `app-modal-shell--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title || description || onClose ? (
          <header className={joinClassNames('app-modal-header', headerClassName)}>
            <div className="app-modal-title-block">
              {title ? <h2>{title}</h2> : null}
              {description ? <span>{description}</span> : null}
            </div>
            {headerActions || onClose ? (
              <div className="app-modal-header-actions">
                {headerActions}
                {onClose ? (
                  <button className="app-modal-close-button" type="button" disabled={closeDisabled} onClick={onClose} aria-label="关闭">
                    <X size={17} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </header>
        ) : null}
        <div className={joinClassNames('app-modal-body', bodyClassName)}>{children}</div>
        {footer ? <footer className={joinClassNames('app-modal-footer', footerClassName)}>{footer}</footer> : null}
      </section>
    </div>
  );
}
