import { Check, ChevronDown, SquareDashedMousePointer } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { prettyRangeName } from '@/engine/address';
import { useSelection, primaryRange } from '@/state/selectors';
import { cx } from '@/utils/cx';

export function Field({ label, children, hint, error, className }: { label: string; children: (id: string) => ReactNode; hint?: string; error?: string | null; className?: string }) {
  const id = useId();
  return (
    <div className={cx('min-w-0', className)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>
      )}
    </div>
  );
}

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

export function TextInput({ value, onChange, className, invalid, ...rest }: TextInputProps) {
  return <input type="text" spellCheck={false} autoComplete="off" value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} className={cx('control', className)} {...rest} />;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export function Select({ value, onChange, options, className, ...rest }: SelectProps) {
  return (
    <span className={cx('relative block', className)}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="control cursor-pointer appearance-none pr-7" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-raised text-ink">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={cx('flex items-start gap-2 py-0.5 text-sm', disabled ? 'opacity-45' : 'cursor-pointer')}>
      <span className="relative mt-px flex h-[18px] w-[18px] shrink-0">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 m-0 cursor-[inherit] appearance-none rounded border border-line-strong bg-panel transition-colors checked:border-accent checked:bg-accent hover:border-ink-3 checked:hover:border-accent" />
        <Check size={13} strokeWidth={3} className="pointer-events-none absolute left-[2.5px] top-[2.5px] text-accent-ink opacity-0 peer-checked:opacity-100" />
      </span>
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

export function Radio<T extends string>({ label, value, current, onChange, name }: { label: ReactNode; value: T; current: T; onChange: (v: T) => void; name: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
      <input type="radio" name={name} checked={value === current} onChange={() => onChange(value)} className="h-4 w-4 cursor-pointer appearance-none rounded-full border border-line-strong bg-panel checked:border-[5px] checked:border-accent hover:border-ink-3 checked:hover:border-accent" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; tip?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.tip}
          data-tip={o.tip}
          onClick={() => onChange(o.value)}
          className={cx('flex h-7 flex-1 items-center justify-center gap-1.5 rounded px-2.5 text-sm transition-colors', o.value === value ? 'bg-raised font-medium text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Text field for a range, with a button that takes the current selection. */
export function RangeInput({ id, value, onChange, invalid, withSheet, sheetName, placeholder }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; withSheet?: boolean; sheetName?: string; placeholder?: string }) {
  const selection = useSelection();
  const current = prettyRangeName(primaryRange(selection));
  return (
    <span className="relative block">
      <TextInput id={id} value={value} onChange={onChange} invalid={invalid} placeholder={placeholder} className="pr-9" />
      <button
        type="button"
        onClick={() => onChange(withSheet && sheetName ? `${sheetName}!${current}` : current)}
        aria-label={`Use current selection, ${current}`}
        data-tip={`Use current selection (${current})`}
        className="absolute right-1 top-1 flex h-6 w-7 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
      >
        <SquareDashedMousePointer size={15} />
      </button>
    </span>
  );
}

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
