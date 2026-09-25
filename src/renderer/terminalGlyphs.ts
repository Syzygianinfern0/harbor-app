import type { Terminal } from '@xterm/xterm';

const REPEAT = 32;

/**
 * xterm 6's DOM renderer measures glyph widths as `offsetWidth / 32`. offsetWidth is an
 * integer, so a 7.827px glyph reads as 7.8125px, and the letter-spacing xterm adds to fill
 * each cell overshoots by the difference on every column. At 13px that pushed the last
 * column ~1-2.5px past its row, which clips it. Measure fractionally instead.
 * Relies on private renderer fields (as FitAddon does); does nothing if they change.
 */
export function measureGlyphsExactly(terminal: Terminal) {
  const renderer = (terminal as any)._core?._renderService?._renderer?.value;
  const cache = renderer?._widthCache;
  if (!cache || typeof cache._measure !== 'function' || typeof cache.clear !== 'function' || typeof renderer._setDefaultSpacing !== 'function' || !Array.isArray(cache._measureElements)) return;
  cache._measure = (text: string, variant: number) => {
    const element: HTMLElement = cache._measureElements[variant];
    element.textContent = text.repeat(REPEAT);
    return element.getBoundingClientRect().width / REPEAT;
  };
  cache.clear();
  renderer._setDefaultSpacing();
  terminal.refresh(0, terminal.rows - 1);
}
