import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/utils/cx';

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface FloatingProps {
  anchor: AnchorRect;
  onClose: () => void;
  children: ReactNode;
  placement?: 'below' | 'above' | 'right';
  align?: 'start' | 'end';
  gap?: number;
  className?: string;
  /** Elements that do not count as "outside". */
  ignore?: RefObject<HTMLElement | null>[];
  /** Skip the open animation for things that follow the cursor. */
  still?: boolean;
  role?: string;
  label?: string;
}

const MARGIN = 8;

/** Positions content next to an anchor, keeping it inside the window. */
export function Floating({ anchor, onClose, children, placement = 'below', align = 'start', gap = 4, className, ignore, still, role, label }: FloatingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (): void => {
      const { offsetWidth: w, scrollHeight } = el;
      const h = Math.min(scrollHeight, window.innerHeight - MARGIN * 2);
      let left: number;
      let top: number;
      if (placement === 'right') {
        left = anchor.right + gap;
        if (left + w > window.innerWidth - MARGIN) left = anchor.left - gap - w;
        top = anchor.top;
      } else {
        left = align === 'end' ? anchor.right - w : anchor.left;
        const below = anchor.bottom + gap;
        const above = anchor.top - gap - h;
        const fitsBelow = below + h <= window.innerHeight - MARGIN;
        top = placement === 'above' ? (above >= MARGIN ? above : below) : fitsBelow || above < MARGIN ? below : above;
      }
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top, maxH: window.innerHeight - MARGIN * 2 }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor.left, anchor.top, anchor.right, anchor.bottom, placement, align, gap]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (ignore?.some((r) => r.current?.contains(t))) return;
      // Nested floating layers are separate portals but belong to this one.
      if ((t as Element).closest?.('[data-floating]') && ref.current && isLaterLayer(ref.current, t as Element)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const layers = document.querySelectorAll('[data-floating]');
      if (layers[layers.length - 1] !== ref.current) return;
      e.stopPropagation();
      e.preventDefault();
      close.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    const onBlur = (): void => close.current();
    window.addEventListener('resize', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onBlur);
    };
  }, [ignore]);

  return createPortal(
    <div
      ref={ref}
      data-floating=""
      role={role}
      aria-label={label}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
      className={cx('fixed z-[70] overflow-auto rounded-[10px] bg-raised text-ink shadow-pop', !still && 'animate-pop', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

function isLaterLayer(self: Element, target: Element): boolean {
  const layers = [...document.querySelectorAll('[data-floating]')];
  const layer = target.closest('[data-floating]');
  return layer !== null && layers.indexOf(layer) > layers.indexOf(self);
}

interface PopoverProps {
  /** Renders the trigger. Spread `triggerProps` on a button. */
  trigger: (props: { ref: RefObject<HTMLButtonElement | null>; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' | 'dialog' }, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  align?: 'start' | 'end';
  placement?: 'below' | 'above' | 'right';
  kind?: 'menu' | 'dialog';
  label?: string;
}

export function Popover({ trigger, children, className, align, placement, kind = 'menu', label }: PopoverProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [ignore] = useState<RefObject<HTMLElement | null>[]>(() => [ref]);
  const close = (): void => setAnchor(null);
  return (
    <>
      {trigger(
        {
          ref,
          onClick: () => setAnchor((a) => (a ? null : (ref.current?.getBoundingClientRect() ?? null))),
          'aria-expanded': anchor !== null,
          'aria-haspopup': kind,
        },
        anchor !== null,
      )}
      {anchor && (
        <Floating anchor={anchor} onClose={close} align={align} placement={placement} className={className} ignore={ignore} role={kind === 'dialog' ? 'dialog' : undefined} label={label}>
          {children(close)}
        </Floating>
      )}
    </>
  );
}
