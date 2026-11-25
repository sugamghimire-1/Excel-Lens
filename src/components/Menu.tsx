import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx, shortcut } from '@/utils/cx';
import { Floating } from './Popover';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** Custom leading visual, e.g. a colour swatch. */
  lead?: ReactNode;
  keys?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  submenu?: MenuEntry[];
  /** Arbitrary submenu content such as a colour grid. */
  panel?: (close: () => void) => ReactNode;
  hint?: string;
}

export type MenuEntry = MenuItem | 'separator' | { heading: string };

const isItem = (e: MenuEntry): e is MenuItem => e !== 'separator' && !('heading' in e);

interface MenuListProps {
  items: MenuEntry[];
  onClose: () => void;
  className?: string;
  /** Focus the first item on mount. */
  autoFocus?: boolean;
  label?: string;
}

export function MenuList({ items, onClose, className, autoFocus = true, label }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ index: number; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer.current);
  }, [autoFocus]);

  const focusables = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>(':scope > [role^=menuitem]:not([aria-disabled=true])') ?? [])];

  const onKeyDown = (e: KeyboardEvent): void => {
    const list = focusables();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i >= 0 && list[i].getAttribute('aria-haspopup')) {
      e.preventDefault();
      list[i].click();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const from = [...list.slice(i + 1), ...list.slice(0, i + 1)];
      from.find((el) => el.textContent?.toLowerCase().startsWith(e.key.toLowerCase()))?.focus();
    }
  };

  return (
    <div ref={ref} role="menu" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown} className={cx('min-w-[208px] p-1 outline-none', className)}>
      {items.map((entry, index) => {
        if (entry === 'separator') return <div key={index} role="separator" className="mx-1 my-1 h-px bg-line" />;
        if (!isItem(entry))
          return (
            <div key={index} className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">
              {entry.heading}
            </div>
          );
        const Icon = entry.icon;
        const hasSub = entry.submenu !== undefined || entry.panel !== undefined;
        const openSub = (el: HTMLElement): void => setOpen({ index, rect: el.getBoundingClientRect() });
        return (
          <button
            key={index}
            type="button"
            role={entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled || undefined}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? open?.index === index : undefined}
            tabIndex={-1}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              clearTimeout(timer.current);
              timer.current = setTimeout(() => (hasSub && !entry.disabled ? openSub(el) : setOpen(null)), 120);
            }}
            onClick={(e) => {
              if (entry.disabled) return;
              if (hasSub) {
                openSub(e.currentTarget);
                return;
              }
              onClose();
              entry.onSelect?.();
            }}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-sm outline-none transition-colors',
              entry.disabled ? 'cursor-default opacity-40' : 'hover:bg-hover focus:bg-hover',
              entry.danger && !entry.disabled && 'text-bad',
              open?.index === index && 'bg-hover',
            )}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-2">
              {entry.checked ? <Check size={15} className="text-accent" /> : (entry.lead ?? (Icon && <Icon size={15} strokeWidth={1.75} className={entry.danger ? 'text-bad' : undefined} />))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              {entry.hint && <span className="block truncate text-xs text-ink-3">{entry.hint}</span>}
            </span>
            {entry.keys && <span className="pl-5 text-xs text-ink-3">{shortcut(entry.keys)}</span>}
            {hasSub && <ChevronRight size={14} className="text-ink-3" />}
          </button>
        );
      })}
      {open &&
        (() => {
          const entry = items[open.index];
          if (entry === 'separator' || !isItem(entry)) return null;
          return (
            <Floating anchor={open.rect} placement="right" gap={2} onClose={() => setOpen(null)}>
              {entry.panel ? entry.panel(onClose) : <MenuList items={entry.submenu ?? []} onClose={onClose} autoFocus={false} />}
            </Floating>
          );
        })()}
    </div>
  );
}
