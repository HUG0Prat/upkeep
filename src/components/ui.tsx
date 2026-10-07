import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { t } from '../../shared/i18n';
import { Icon } from './Icon';

interface ModalProps {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  wide?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}

export function Modal({ title, children, confirmLabel, danger, wide, onConfirm, onCancel, cancelLabel }: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => () => opener.current?.focus?.(), []);
  useEffect(() => {
    const focusables = () =>
      [...(box.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter((el) => !el.hasAttribute('disabled'));
    if (!box.current?.contains(document.activeElement)) (focusables().find((el) => el.autofocus) ?? focusables()[0])?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel.current();
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div ref={box} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            {cancelLabel ?? (onConfirm ? t('Annuler') : t('Fermer'))}
          </button>
          {onConfirm && confirmLabel && (
            <button className={`btn ${danger ? 'warn' : 'primary'}`} onClick={onConfirm} autoFocus>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return <>{parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p))}</>;
}

export interface MenuItem {
  label: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
      el.querySelector<HTMLButtonElement>('button')?.focus();
    }
    const close = () => onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
    };
  }, [x, y, onClose]);
  return (
    <div ref={ref} className="menu ctx" role="menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          className={it.danger ? 'danger' : ''}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onClick();
          }}
        >
          {it.icon && <Icon name={it.icon} size={15} />} {it.label}
        </button>
      ))}
    </div>
  );
}

export function Toast({ text, action, onAction, onClose }: { text: string; action?: string; onAction?: () => void; onClose: () => void }) {
  useEffect(() => {
    const tm = setTimeout(onClose, 5000);
    return () => clearTimeout(tm);
  }, [text, onClose]);
  return (
    <div className="toast" role="status">
      <Icon name="check" size={16} />
      <span>{text}</span>
      {action && (
        <button className="link" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const named = Children.map(children, (c) => {
    if (!isValidElement(c) || typeof c.type !== 'string' || !['select', 'input'].includes(c.type)) return c;
    const props = c.props as Record<string, unknown>;
    if (props['aria-label'] || props['aria-labelledby']) return c;
    return cloneElement(c as ReactElement<Record<string, unknown>>, { 'aria-labelledby': `${id}-l`, 'aria-describedby': hint ? `${id}-h` : undefined });
  });
  return (
    <div className="setting" role="group" aria-labelledby={`${id}-l`}>
      <div>
        <div id={`${id}-l`}>{label}</div>
        {hint && (
          <div id={`${id}-h`} className="muted small">
            {hint}
          </div>
        )}
      </div>
      <div className="setting-control">{named}</div>
    </div>
  );
}

export function KindDot({ kind }: { kind: string }) {
  return <span className={`kind-dot ${kind}`} aria-hidden />;
}
