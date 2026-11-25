import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '@/utils/cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 border border-transparent',
  secondary: 'bg-panel text-ink border border-line-strong hover:bg-hover active:bg-pressed',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed border border-transparent',
  danger: 'bg-bad text-white dark:text-accent-ink hover:brightness-110 active:brightness-95 border border-transparent',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-[background-color,filter,border-color] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  keys?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  ref?: Ref<HTMLButtonElement>;
}

/** Square button with an accessible label and tooltip. */
export function IconButton({ label, keys, active, size = 'md', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      data-tip-keys={keys}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink active:bg-pressed disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
