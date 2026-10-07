// Full-stage status card: camera gate, loading, and every error state (spec §8). Errors always carry
// their raw message in `detail` so nothing fails silently.
import type { ComponentChildren } from 'preact';
import { Icon } from '../icons';

interface Props {
  icon?: string;
  tone?: 'plain' | 'accent' | 'danger';
  title: string;
  body?: ComponentChildren;
  steps?: string[];
  detail?: string | null;
  /** 0..1, or 'indeterminate' */
  progress?: number | 'indeterminate' | null;
  meta?: string | null;
  spinner?: boolean;
  scrim?: boolean;
  children?: ComponentChildren;
}

export function Status({ icon, tone = 'plain', title, body, steps, detail, progress, meta, spinner, scrim, children }: Props) {
  return (
    <div class={`status${scrim ? ' scrim' : ''}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {spinner ? (
        <div class="status-icon">
          <div class="spinner" />
        </div>
      ) : (
        icon && (
          <div class={`status-icon${tone === 'plain' ? '' : ` ${tone}`}`}>
            <Icon name={icon} size={28} />
          </div>
        )
      )}
      <div class="status-title">{title}</div>
      {body && <div class="status-body">{body}</div>}
      {steps && steps.length > 0 && (
        <ol class="status-steps">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {detail && <div class="status-detail">{detail}</div>}
      {progress != null && (
        <div class={`status-progress${progress === 'indeterminate' ? ' indeterminate' : ''}`}>
          <i style={progress === 'indeterminate' ? undefined : { width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {meta && <div class="status-meta num">{meta}</div>}
      {children && <div class="status-actions">{children}</div>}
    </div>
  );
}
