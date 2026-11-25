import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Popover } from '@/components/Popover';
import { MenuList, type MenuEntry } from '@/components/Menu';
import { cx } from '@/utils/cx';

/** Ribbon buttons keep focus in the grid so typing continues after a click. */
export const keepFocus = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

export function Group({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 flex-col border-r border-line px-1.5 last:border-r-0">
      <div className={cx('flex flex-1 items-center gap-0.5', className)}>{children}</div>
      <div className="pb-[3px] pt-px text-center text-2xs leading-[13px] text-ink-3">{label}</div>
    </div>
  );
}

export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-col justify-center gap-[3px]', className)}>{children}</div>;
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex items-center gap-px', className)}>{children}</div>;
}

export function Separator() {
  return <span className="mx-1 h-5 w-px bg-line" />;
}

interface ButtonBase {
  label: string;
  icon: LucideIcon;
  keys?: string;
  desc?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Accent colour strip, e.g. the current fill colour. */
  strip?: string | null;
}

const base = 'transition-colors disabled:pointer-events-none disabled:opacity-35';
const activeCls = 'bg-accent-soft text-accent hover:bg-accent-soft';

/** Icon-only 28px button. */
export function Tool({ label, icon: Icon, keys, desc, onClick, active, disabled, strip }: ButtonBase) {
  return (
    <button
      type="button"
      {...keepFocus}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      data-tip-keys={keys}
      data-tip-desc={desc}
      className={cx(base, 'relative flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed', active && activeCls)}
    >
      <Icon size={16} strokeWidth={1.8} />
      {strip !== undefined && <span className="absolute bottom-[3px] left-[6px] right-[6px] h-[3px] rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: strip ?? 'transparent' }} />}
    </button>
  );
}

/** Icon with a label beside it. */
export function SmallButton({ label, icon: Icon, keys, desc, onClick, active, disabled }: ButtonBase) {
  return (
    <button
      type="button"
      {...keepFocus}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      data-tip={keys || desc ? label : undefined}
      data-tip-keys={keys}
      data-tip-desc={desc}
      className={cx(base, 'flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-xs text-ink hover:bg-hover active:bg-pressed', active && activeCls)}
    >
      <Icon size={14} strokeWidth={1.8} className={active ? undefined : 'text-ink-2'} />
      {label}
    </button>
  );
}

const bigCls = 'flex h-[66px] min-w-[52px] flex-col items-center justify-start gap-1 rounded-md px-1.5 pt-1.5 text-xs leading-[14px] text-ink hover:bg-hover active:bg-pressed';

function BigBody({ icon: Icon, label, caret, active }: { icon: LucideIcon; label: string; caret?: boolean; active?: boolean }) {
  return (
    <>
      <Icon size={22} strokeWidth={1.6} className={cx('shrink-0', active ? 'text-accent' : 'text-ink-2')} />
      <span className="flex max-w-[64px] items-end justify-center text-center">
        <span>
          {label}
          {caret && <ChevronDown size={11} className="ml-0.5 inline text-ink-3" />}
        </span>
      </span>
    </>
  );
}

/** Large icon with a label below. */
export function BigButton({ label, icon, keys, desc, onClick, active, disabled }: ButtonBase) {
  return (
    <button type="button" {...keepFocus} onClick={onClick} disabled={disabled} aria-pressed={active} data-tip={keys || desc ? label : undefined} data-tip-keys={keys} data-tip-desc={desc} className={cx(base, bigCls, active && activeCls)}>
      <BigBody icon={icon} label={label} active={active} />
    </button>
  );
}

interface DropProps extends Omit<ButtonBase, 'onClick'> {
  items?: MenuEntry[] | (() => MenuEntry[]);
  panel?: (close: () => void) => ReactNode;
}

function dropContent(items: DropProps['items'], panel: DropProps['panel'], close: () => void): ReactNode {
  if (panel) return panel(close);
  return <MenuList items={typeof items === 'function' ? items() : (items ?? [])} onClose={close} />;
}

/** Large button that opens a menu. */
export function BigDrop({ label, icon, keys, desc, active, disabled, items, panel }: DropProps) {
  return (
    <Popover
      trigger={(p, open) => (
        <button type="button" {...keepFocus} {...p} disabled={disabled} data-tip={desc ? label : undefined} data-tip-keys={keys} data-tip-desc={desc} className={cx(base, bigCls, (open || active) && 'bg-hover')}>
          <BigBody icon={icon} label={label} caret active={active} />
        </button>
      )}
    >
      {(close) => dropContent(items, panel, close)}
    </Popover>
  );
}

/** Small labelled button that opens a menu. */
export function SmallDrop({ label, icon: Icon, desc, active, disabled, items, panel }: DropProps) {
  return (
    <Popover
      trigger={(p, open) => (
        <button type="button" {...keepFocus} {...p} disabled={disabled} data-tip={desc ? label : undefined} data-tip-desc={desc} className={cx(base, 'flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-xs text-ink hover:bg-hover active:bg-pressed', (open || active) && 'bg-hover')}>
          <Icon size={14} strokeWidth={1.8} className="text-ink-2" />
          {label}
          <ChevronDown size={11} className="text-ink-3" />
        </button>
      )}
    >
      {(close) => dropContent(items, panel, close)}
    </Popover>
  );
}

/** Icon button with a separate arrow that opens a menu. */
export function SplitTool({ label, icon: Icon, keys, onClick, active, strip, items, panel, menuLabel }: ButtonBase & { items?: MenuEntry[] | (() => MenuEntry[]); panel?: (close: () => void) => ReactNode; menuLabel: string }) {
  return (
    <Popover
      trigger={(p, open) => (
        <span className={cx('flex h-7 items-center rounded-md transition-colors hover:bg-hover', open && 'bg-hover')}>
          <Tool label={label} icon={Icon} keys={keys} onClick={onClick} active={active} strip={strip} />
          <button type="button" {...keepFocus} {...p} aria-label={menuLabel} data-tip={menuLabel} className="flex h-7 w-[15px] items-center justify-center rounded-r-md text-ink-3 hover:bg-pressed hover:text-ink">
            <ChevronDown size={11} />
          </button>
        </span>
      )}
    >
      {(close) => dropContent(items, panel, close)}
    </Popover>
  );
}

/** Large button whose lower half opens a menu. */
export function SplitBig({ label, icon: Icon, keys, desc, onClick, disabled, items, panel }: ButtonBase & { items?: MenuEntry[] | (() => MenuEntry[]); panel?: (close: () => void) => ReactNode }) {
  return (
    <Popover
      trigger={(p, open) => (
        <span className={cx('flex h-[66px] min-w-[52px] flex-col items-stretch rounded-md transition-colors hover:bg-hover', open && 'bg-hover', disabled && 'pointer-events-none opacity-35')}>
          <button type="button" {...keepFocus} onClick={onClick} aria-label={label} data-tip={label} data-tip-keys={keys} data-tip-desc={desc} className="flex flex-1 items-center justify-center rounded-t-md hover:bg-pressed">
            <Icon size={22} strokeWidth={1.6} className="text-ink-2" />
          </button>
          <button type="button" {...keepFocus} {...p} aria-label={`${label} options`} className="flex items-center justify-center rounded-b-md px-1.5 pb-1.5 pt-0.5 text-xs leading-[14px] text-ink hover:bg-pressed">
            {label}
            <ChevronDown size={11} className="ml-0.5 text-ink-3" />
          </button>
        </span>
      )}
    >
      {(close) => dropContent(items, panel, close)}
    </Popover>
  );
}

/** Editable combo box used for font family and size. */
export function Combo({ label, value, options, onPick, width, render, numeric }: { label: string; value: string; options: string[]; onPick: (v: string) => void; width: number; render?: (o: string) => ReactNode; numeric?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    const t = draft?.trim();
    setDraft(null);
    if (t && t !== value) onPick(t);
  };
  return (
    <span style={{ width }} className="flex h-[26px] items-center rounded-md border border-line bg-panel transition-colors focus-within:border-accent hover:border-line-strong">
      <input
        aria-label={label}
        value={draft ?? value}
        inputMode={numeric ? 'decimal' : undefined}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(value);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') e.currentTarget.blur();
        }}
        className="h-full min-w-0 flex-1 rounded-md bg-transparent pl-2 text-xs outline-none"
      />
      <Popover
        align="end"
        trigger={(p) => (
          <button type="button" {...keepFocus} {...p} aria-label={`${label} list`} className="flex h-full w-[18px] items-center justify-center text-ink-3 hover:text-ink">
            <ChevronDown size={12} />
          </button>
        )}
      >
        {(close) => (
          <div role="listbox" aria-label={label} className="max-h-[320px] min-w-[84px] overflow-auto p-1">
            {options.map((o) => (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={o === value}
                onClick={() => {
                  close();
                  onPick(o);
                }}
                className={cx('block w-full rounded-md px-2.5 py-1 text-left text-sm hover:bg-hover', o === value && 'bg-accent-soft font-medium text-accent')}
              >
                {render ? render(o) : o}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </span>
  );
}
