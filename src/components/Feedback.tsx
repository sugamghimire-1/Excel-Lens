import { CircleAlert, CircleCheck, Info, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUI } from '@/state/uiStore';
import { cx, shortcut } from '@/utils/cx';

/** One tooltip for the whole app, driven by `data-tip` attributes. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; keys?: string; desc?: string; rect: DOMRect } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let current: Element | null = null;
    const hide = (): void => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement): void => {
      const text = el.dataset.tip;
      if (text) setTip({ text, keys: el.dataset.tipKeys, desc: el.dataset.tipDesc, rect: el.getBoundingClientRect() });
    };
    const over = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      clearTimeout(timer);
      current = el;
      setTip(null);
      if (el) timer = setTimeout(() => el.isConnected && show(el), 500);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('wheel', hide, { passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('wheel', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const below = tip.rect.bottom + 7;
    setPos({
      left: Math.max(6, Math.min(window.innerWidth - w - 6, tip.rect.left + tip.rect.width / 2 - w / 2)),
      top: below + h > window.innerHeight - 6 ? tip.rect.top - h - 7 : below,
    });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={ref} role="tooltip" style={pos} className="pointer-events-none fixed z-[90] max-w-[260px] animate-fade rounded-md bg-ink px-2.5 py-1.5 text-xs text-panel shadow-pop">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{tip.text}</span>
        {tip.keys && <span className="opacity-65">{shortcut(tip.keys)}</span>}
      </div>
      {tip.desc && <div className="mt-0.5 opacity-75">{tip.desc}</div>}
    </div>,
    document.body,
  );
}

const TOAST_ICON: Record<string, [LucideIcon, string]> = {
  info: [Info, 'text-accent'],
  success: [CircleCheck, 'text-good'],
  error: [CircleAlert, 'text-bad'],
};

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-14 z-[80] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => {
        const [Icon, color] = TOAST_ICON[t.kind];
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex max-w-[560px] animate-rise items-start gap-2.5 rounded-lg bg-raised py-2.5 pl-3 pr-2 text-sm shadow-pop">
            <Icon size={17} className={cx('mt-px shrink-0', color)} />
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="shrink-0 rounded px-1.5 font-medium text-accent hover:underline"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function BusyOverlay() {
  const busy = useUI((s) => s.busy);
  if (!busy) return null;
  return (
    <div role="status" className="fixed inset-0 z-[85] flex animate-fade items-center justify-center bg-[rgb(var(--shadow)/0.2)] dark:bg-black/40">
      <div className="flex items-center gap-3 rounded-xl bg-raised px-5 py-4 shadow-pop">
        <LoaderCircle size={20} className="animate-spin text-accent" />
        <span className="font-medium">{busy}</span>
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon size={21} strokeWidth={1.75} />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-[34ch] text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
