import { useEffect, useState, type RefObject } from 'react';

export function useVirtual(ref: RefObject<HTMLElement | null>, count: number, rowHeight: number, overscan = 10) {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 60) });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
      const visible = Math.ceil(el.clientHeight / rowHeight) + overscan * 2;
      setRange({ start, end: Math.min(count, start + visible) });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [ref, count, rowHeight, overscan]);
  return { ...range, padTop: range.start * rowHeight, padBottom: Math.max(0, (count - range.end) * rowHeight) };
}
