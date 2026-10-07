// Small shared controls: toggle row, segmented control, icon button.
import type { ComponentChildren } from 'preact';
import { Icon } from '../icons';

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  size = 24,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <button type="button" class="icon-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function ToggleRow({
  title,
  sub,
  on,
  onChange,
}: {
  title: string;
  sub?: ComponentChildren;
  on: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <button type="button" class="row toggle-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span class="row-text">
        <span class="row-title">{title}</span>
        {sub && <div class="row-sub">{sub}</div>}
      </span>
      <span class={`toggle${on ? ' on' : ''}`} aria-hidden="true" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? 'on' : ''}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
