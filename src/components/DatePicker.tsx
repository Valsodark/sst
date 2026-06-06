import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, parseISO, isValid,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, subMonths, isSameMonth, isSameDay, isAfter, isBefore,
} from 'date-fns';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPOVER_WIDTH = 260;

export function DatePicker({ value, onChange, min, max }: { value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  const selected = value && isValid(parseISO(value)) ? parseISO(value) : new Date();

  const minDate = min && isValid(parseISO(min)) ? parseISO(min) : undefined;
  const maxDate = max && isValid(parseISO(max)) ? parseISO(max) : undefined;
  const isDisabled = (d: Date) =>
    (minDate ? isBefore(d, minDate) : false) || (maxDate ? isAfter(d, maxDate) : false);

  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(startOfMonth(selected));
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Keep the visible month in sync when the value changes externally
  useEffect(() => { setViewMonth(startOfMonth(selected)); }, [value]);

  // Position the portal popover relative to the trigger (fixed coords)
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const width = Math.max(POPOVER_WIDTH, r.width);
      let left = r.left;
      // Keep it on screen horizontally
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(viewMonth)),
    end: endOfWeek(endOfMonth(viewMonth)),
  });

  const today = new Date();

  const pick = (d: Date) => {
    if (isDisabled(d)) return;
    onChange(format(d, 'yyyy-MM-dd'));
    setOpen(false);
  };

  const prevDisabled = minDate ? !isAfter(viewMonth, startOfMonth(minDate)) : false;
  const nextDisabled = maxDate ? !isBefore(viewMonth, startOfMonth(maxDate)) : false;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between pl-3 pr-3 py-2 font-data text-[16px] focus:outline-none"
        style={{ background: '#0a1628', border: '1px solid rgba(0,212,255,0.18)', color: '#d4eaf7' }}
      >
        <span>{format(selected, 'MM/dd/yyyy')}</span>
        <Calendar className="w-4 h-4 shrink-0" style={{ color: 'rgba(0,212,255,0.5)' }} />
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[60] p-2 font-data"
          style={{
            top: pos.top, left: pos.left, width: POPOVER_WIDTH,
            background: '#060f1c', border: '1px solid rgba(0,212,255,0.25)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          }}
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" disabled={prevDisabled} onClick={() => setViewMonth(m => subMonths(m, 1))}
              className="p-1 transition-colors disabled:opacity-25 disabled:cursor-not-allowed" style={{ color: 'rgba(0,212,255,0.5)' }}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[14px] tracking-[0.18em] uppercase" style={{ color: 'rgba(0,212,255,0.7)' }}>
              {format(viewMonth, 'MMMM yyyy')}
            </span>
            <button type="button" disabled={nextDisabled} onClick={() => setViewMonth(m => addMonths(m, 1))}
              className="p-1 transition-colors disabled:opacity-25 disabled:cursor-not-allowed" style={{ color: 'rgba(0,212,255,0.5)' }}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[11px] tracking-wider uppercase py-1" style={{ color: 'rgba(0,212,255,0.3)' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map(d => {
              const inMonth = isSameMonth(d, viewMonth);
              const isSel = isSameDay(d, selected);
              const isToday = isSameDay(d, today);
              const disabled = isDisabled(d);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(d)}
                  className="aspect-square flex items-center justify-center text-[14px] transition-colors"
                  style={{
                    color: disabled ? 'rgba(0,212,255,0.12)' : isSel ? '#040c14' : inMonth ? '#d4eaf7' : 'rgba(0,212,255,0.2)',
                    background: isSel ? '#00d4ff' : 'transparent',
                    border: isToday && !isSel ? '1px solid rgba(0,212,255,0.4)' : '1px solid transparent',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    textDecoration: disabled ? 'line-through' : 'none',
                  }}
                  onMouseEnter={e => { if (!isSel && !disabled) e.currentTarget.style.background = 'rgba(0,212,255,0.12)'; }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                >
                  {format(d, 'd')}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
