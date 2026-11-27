import { useEffect } from 'react';
import { X } from 'lucide-react';

export interface WelcomeGuideModalProps {
  open: boolean;
  dontShowNextTime: boolean;
  onDontShowChange: (checked: boolean) => void;
  onClose: () => void;
}

interface ControlRow {
  input: string;
  action: string;
}

const INSPECT_CONTROLS: ControlRow[] = [
  { input: 'Left Drag', action: 'Orbit 360° around character or weapon' },
  { input: 'Right Drag', action: 'Pan camera framing' },
  { input: 'Scroll Wheel', action: 'Zoom in (or cycle guns in Combat)' },
  { input: '1 – 5 / 0', action: 'Switch 5 firearms or holster empty hands' },
  { input: 'Arsenal Tab', action: 'Gun Macro Turntable & UE5 Gun .GLB' },
];

const COMBAT_CONTROLS: ControlRow[] = [
  { input: 'W A S D', action: 'Move, strafe, Shift sprint, C crouch' },
  { input: 'Hold RMB', action: 'Aim Down Sights (mildot scope on AWM)' },
  { input: 'LMB / B', action: 'Fire weapon / toggle Auto & Semi' },
  { input: 'R / I / L', action: 'Reload mag, inspect gun, toggle laser' },
  { input: 'Space / H', action: 'Jump action / hide or restore HUD' },
];

export function WelcomeGuideModal({
  open,
  dontShowNextTime,
  onDontShowChange,
  onClose,
}: WelcomeGuideModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-guide-title"
      data-testid="welcome-guide-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#1a1a1a]/55"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[680px] max-h-[90vh] overflow-y-auto bg-white text-[#1a1a1a] rounded-2xl border border-[#1a1a1a]/[0.12] shadow-[0_24px_64px_rgba(0,0,0,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-[#1a1a1a]/[0.08] flex items-start justify-between gap-4">
          <div>
            <p className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-1.5">
              Quick-Start Controls
            </p>
            <h2
              id="welcome-guide-title"
              className="font-editorial italic font-semibold text-[1.9rem] sm:text-[2.15rem] leading-[1.05] text-[#1a1a1a]"
            >
              Vanguard Character Studio
            </h2>
            <p className="mt-2 text-[0.82rem] leading-[1.55] text-[#1a1a1a]/65 max-w-[48ch]">
              Inspect the character under live Harsh Sunlight lighting, test animations and facial
              morphs, or switch to Combat Controller for interactive third-person movement.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close controls guide"
            className="w-9 h-9 rounded-lg border border-[#1a1a1a]/[0.12] bg-[#f8f7f4] hover:bg-[#1a1a1a] hover:text-white text-[#1a1a1a] flex items-center justify-center transition-colors duration-150 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Two-Column Controls Breakdown */}
        <div className="px-6 sm:px-8 py-6 grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
          <section>
            <h3 className="font-mono-tabular text-[0.68rem] uppercase tracking-[0.1em] text-[#1a1a1a]/55 mb-3.5">
              Inspect &amp; Studio
            </h3>
            <ul className="flex flex-col divide-y divide-[#1a1a1a]/[0.07]">
              {INSPECT_CONTROLS.map((row) => (
                <li
                  key={row.input}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-[0.78rem]"
                >
                  <span className="font-mono-tabular text-[0.7rem] font-medium text-[#1a1a1a] bg-[#f8f7f4] border border-[#1a1a1a]/[0.10] px-2 py-0.5 rounded-[4px] whitespace-nowrap shrink-0">
                    {row.input}
                  </span>
                  <span className="text-right text-[#1a1a1a]/75 leading-[1.35]">{row.action}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="font-mono-tabular text-[0.68rem] uppercase tracking-[0.1em] text-[#1a1a1a]/55 mb-3.5">
              Combat Mode &amp; Shortcuts
            </h3>
            <ul className="flex flex-col divide-y divide-[#1a1a1a]/[0.07]">
              {COMBAT_CONTROLS.map((row) => (
                <li
                  key={row.input}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-[0.78rem]"
                >
                  <span className="font-mono-tabular text-[0.7rem] font-medium text-[#1a1a1a] bg-[#f8f7f4] border border-[#1a1a1a]/[0.10] px-2 py-0.5 rounded-[4px] whitespace-nowrap shrink-0">
                    {row.input}
                  </span>
                  <span className="text-right text-[#1a1a1a]/75 leading-[1.35]">{row.action}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="px-6 sm:px-8 py-4 bg-[#f8f7f4] border-t border-[#1a1a1a]/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-b-2xl">
          <label className="inline-flex items-center gap-2.5 text-[0.78rem] text-[#1a1a1a]/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowNextTime}
              onChange={(e) => onDontShowChange(e.target.checked)}
              data-testid="dont-show-guide-checkbox"
              className="w-4 h-4 rounded border-[#1a1a1a]/30 accent-[#ff4d00] cursor-pointer"
            />
            <span>Do not show next time</span>
          </label>

          <button
            type="button"
            onClick={onClose}
            data-testid="welcome-guide-start-btn"
            className="bg-[#ff4d00] hover:bg-[#e54500] active:scale-[0.99] text-white font-semibold text-[0.82rem] px-6 py-2.5 rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap"
          >
            Start Exploring
          </button>
        </div>
      </div>
    </div>
  );
}
