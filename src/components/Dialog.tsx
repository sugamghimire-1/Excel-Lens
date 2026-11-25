import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { gridApi } from '@/state/gridApi';
import { useUI } from '@/state/uiStore';
import { cx } from '@/utils/cx';
import { IconButton } from './Button';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Modeless dialogs leave the sheet usable. */
  modeless?: boolean;
  onSubmit?: () => void;
  bodyClassName?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Draggable dialog with focus handling. */
export function Dialog({ title, onClose, children, footer, width = 420, modeless, onSubmit, bodyClassName }: DialogProps) {
  const ref = useRef<HTMLFormElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current!;
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('input, select, textarea') ?? el.querySelector<HTMLElement>('footer button[type=submit]') ?? el.querySelector<HTMLElement>('footer button') ?? el;
    target.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement && target.type === 'text') target.select();
    return () => {
      const { dialog, palette, backstage } = useUI.getState();
      if (!dialog && !palette && !backstage) gridApi.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key === 'Tab' && !modeless) {
      const list = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  const startDrag = (e: ReactPointerEvent<HTMLElement>): void => {
    if ((e.target as Element).closest('button')) return;
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    const move = (ev: PointerEvent): void => setOffset({ x: ev.clientX - start.x, y: Math.max(-window.innerHeight / 3, ev.clientY - start.y) });
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    onSubmit?.();
  };

  return createPortal(
    <div className={cx('fixed inset-0 z-[60] flex items-start px-4', modeless ? 'pointer-events-none justify-end pt-[176px] sm:pr-7' : 'animate-fade justify-center pt-[12vh] bg-[rgb(var(--shadow)/0.28)] dark:bg-black/50')}>
      <div style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, width, maxWidth: '100%' }} className="pointer-events-auto">
        <form
          ref={ref}
          role="dialog"
          aria-modal={!modeless}
          aria-label={title}
          tabIndex={-1}
          noValidate
          onSubmit={submit}
          onKeyDown={onKeyDown}
          className="flex max-h-[76vh] animate-rise flex-col overflow-hidden rounded-xl bg-raised shadow-pop outline-none"
        >
          <header onPointerDown={startDrag} className="flex cursor-default touch-none select-none items-center justify-between pb-1 pl-5 pr-2.5 pt-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X size={17} />
            </IconButton>
          </header>
          <div className={cx('min-h-0 flex-1 overflow-auto px-5 pb-4 pt-2', bodyClassName)}>{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line bg-chrome px-5 py-3 dark:bg-panel">{footer}</footer>}
        </form>
      </div>
    </div>,
    document.body,
  );
}
