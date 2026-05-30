/**
 * offline-summary.test.ts
 *
 * Tests for the offline-summary overlay DOM module.
 *
 * We test the public contract (mount, show, dismiss) and the formatting
 * helper (formatDuration).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mountOfflineSummary, formatDuration } from './offline-summary';

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('formats zero ms as "0s"', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats sub-minute durations as seconds only', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(1_000)).toBe('1s');
  });

  it('formats exactly 1 minute', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
  });

  it('formats hours and minutes (omits seconds when >= 1 h)', () => {
    expect(formatDuration(5_400_000)).toBe('1h 30m');
    expect(formatDuration(7_200_000)).toBe('2h 0m');
  });

  it('handles 8 hours (offline cap)', () => {
    expect(formatDuration(28_800_000)).toBe('8h 0m');
  });

  it('truncates fractional seconds (does not round up)', () => {
    // 90_999ms → 1m 30s (not 1m 31s)
    expect(formatDuration(90_999)).toBe('1m 30s');
  });
});

// ---------------------------------------------------------------------------
// mountOfflineSummary
// ---------------------------------------------------------------------------

describe('mountOfflineSummary', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Fresh container each test — avoids cross-test DOM leakage.
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('mounts without showing the overlay', () => {
    const summary = mountOfflineSummary(container);
    expect(summary).toBeDefined();
    // The overlay should be hidden at mount time (not in the visual flow)
    const el = container.querySelector('.offline-summary');
    expect(el).not.toBeNull();
    expect((el as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('show() makes the overlay visible with correct text', () => {
    const summary = mountOfflineSummary(container);
    summary.show({ cappedMs: 90_000, gainedText: '1.50K' });

    const el = container.querySelector('.offline-summary') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('false');
    // Time-away text
    expect(el.textContent).toContain('1m 30s');
    // Gained revenue text
    expect(el.textContent).toContain('1.50K');
  });

  it('dismiss() hides the overlay', () => {
    const summary = mountOfflineSummary(container);
    summary.show({ cappedMs: 60_000, gainedText: '500' });

    const el = container.querySelector('.offline-summary') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('false');

    summary.dismiss();
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('dismiss button click hides the overlay', () => {
    const summary = mountOfflineSummary(container);
    summary.show({ cappedMs: 60_000, gainedText: '500' });

    const btn = container.querySelector(
      '.offline-summary__dismiss',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();

    const el = container.querySelector('.offline-summary') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('show() with cappedMs=0 still renders (caller decides threshold)', () => {
    const summary = mountOfflineSummary(container);
    // show() is pure render — callers gate on meaningful gain before calling
    summary.show({ cappedMs: 0, gainedText: '0' });
    const el = container.querySelector('.offline-summary') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('false');
  });

  it('show() can be called multiple times (idempotent display)', () => {
    const summary = mountOfflineSummary(container);
    summary.show({ cappedMs: 60_000, gainedText: '100' });
    summary.show({ cappedMs: 120_000, gainedText: '200' });

    const el = container.querySelector('.offline-summary') as HTMLElement;
    expect(el.textContent).toContain('2m 0s');
    expect(el.textContent).toContain('200');
    expect(el.getAttribute('aria-hidden')).toBe('false');
  });

  it('appends exactly one overlay element to the container', () => {
    mountOfflineSummary(container);
    const els = container.querySelectorAll('.offline-summary');
    expect(els.length).toBe(1);
  });
});
