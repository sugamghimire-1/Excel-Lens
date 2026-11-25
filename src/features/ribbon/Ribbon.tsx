import { ChevronLeft, ChevronRight, ChevronUp, Pin } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { prefs } from '@/state/storage';
import { useUI, type RibbonTab } from '@/state/uiStore';
import { cx } from '@/utils/cx';
import { HomeTab } from './HomeTab';
import { DataTab, FormulasTab, HelpTab, InsertTab, ReviewTab, ViewTab } from './OtherTabs';
import { keepFocus } from './parts';

const TABS: { id: RibbonTab; label: string; body: () => React.ReactNode }[] = [
  { id: 'home', label: 'Home', body: HomeTab },
  { id: 'insert', label: 'Insert', body: InsertTab },
  { id: 'data', label: 'Data', body: DataTab },
  { id: 'formulas', label: 'Formulas', body: FormulasTab },
  { id: 'review', label: 'Review', body: ReviewTab },
  { id: 'view', label: 'View', body: ViewTab },
  { id: 'help', label: 'Help', body: HelpTab },
];

/** File button and ribbon tabs. Sits in the application bar's second row. */
export function RibbonTabs() {
  const tab = useUI((s) => s.ribbonTab);
  const open = useUI((s) => s.ribbonOpen);
  const set = useUI((s) => s.set);
  const toggle = (next: boolean): void => {
    prefs.set('ribbon', next ? 'open' : 'closed');
    set({ ribbonOpen: next });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    set({ ribbonTab: next.id });
    e.currentTarget.querySelector<HTMLElement>(`[data-tab=${next.id}]`)?.focus();
  };
  return (
    <div className="flex h-8 items-end gap-1 px-2">
      <button type="button" {...keepFocus} onClick={() => set({ backstage: 'home' })} className="mb-1 h-7 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink transition-[filter] hover:brightness-110">
        File
      </button>
      <div role="tablist" aria-label="Ribbon" className="no-scrollbar flex h-full min-w-0 items-end overflow-x-auto pl-1" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              {...keepFocus}
              onClick={() => {
                set({ ribbonTab: t.id });
                if (!open) toggle(true);
              }}
              onDoubleClick={() => toggle(!open)}
              className={cx('relative mb-1 h-7 rounded-md px-3 text-sm transition-colors', active ? 'font-semibold text-ink' : 'text-ink-2 hover:bg-pressed/60 hover:text-ink')}
            >
              {/* Reserve the bold width so tabs do not shift. */}
              <span className="invisible block h-0 font-semibold" aria-hidden="true">
                {t.label}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">{t.label}</span>
              {active && open && <span className="absolute inset-x-3 -bottom-px h-[2.5px] rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <button type="button" {...keepFocus} aria-label={open ? 'Collapse ribbon' : 'Keep ribbon open'} data-tip={open ? 'Collapse ribbon' : 'Keep ribbon open'} onClick={() => toggle(!open)} className="mb-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-pressed/60 hover:text-ink">
        {open ? <ChevronUp size={15} /> : <Pin size={14} />}
      </button>
    </div>
  );
}

/** The active tab's commands, with scroll buttons when they do not fit. */
export function RibbonBody() {
  const tab = useUI((s) => s.ribbonTab);
  const open = useUI((s) => s.ribbonOpen);
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = (): void => setOverflow({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // Groups change width when fonts load or labels change.
    for (const group of el.children) ro.observe(group);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, [tab, open]);

  if (!open) return null;
  const Body = TABS.find((t) => t.id === tab)!.body;
  const nudge = (dx: number): void => strip.current?.scrollBy({ left: dx, behavior: 'smooth' });
  const arrow = 'absolute inset-y-1 z-10 flex w-6 items-center justify-center rounded-md bg-raised text-ink-2 shadow-card hover:text-ink';
  return (
    <div className="relative mx-2 rounded-[10px] bg-panel shadow-card">
      <div
        ref={strip}
        role="tabpanel"
        aria-label={`${TABS.find((t) => t.id === tab)!.label} commands`}
        className="no-scrollbar flex h-[92px] items-stretch overflow-x-auto overflow-y-hidden px-1 pt-1"
        onWheel={(e) => {
          if (strip.current && e.deltaY) strip.current.scrollLeft += e.deltaY;
        }}
      >
        <Body />
      </div>
      {overflow.left && (
        <button type="button" {...keepFocus} aria-label="Scroll ribbon left" className={cx(arrow, 'left-1')} onClick={() => nudge(-320)}>
          <ChevronLeft size={15} />
        </button>
      )}
      {overflow.right && (
        <button type="button" {...keepFocus} aria-label="Scroll ribbon right" className={cx(arrow, 'right-1')} onClick={() => nudge(320)}>
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
