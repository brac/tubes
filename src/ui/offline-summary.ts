/**
 * offline-summary.ts
 *
 * "While you were away" dismissible overlay.
 *
 * Shown once at boot when offline earnings are meaningful (cappedMs > 0 and
 * gained > 0). The caller controls whether to show — this module only renders.
 *
 * Visual direction: warm amber (revenue accent) with a subtle scan-line
 * atmosphere. Intentional, consequential — more substantial than a toast.
 *
 * DOM pattern: mount once, show/dismiss imperatively.
 * Mount:   mountOfflineSummary(container) → OfflineSummaryHandles
 * Show:    handles.show({ cappedMs, gainedText })
 * Dismiss: handles.dismiss() — also wired to the dismiss button
 *
 * Accessibility: role="dialog", aria-modal="true", aria-hidden toggle.
 *
 * PURE MODULE — no clock reads, no game-state coupling.
 */

import './offline-summary.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Arguments for the show() call. */
export interface OfflineSummaryPayload {
  /** Clamped offline duration in milliseconds (used for the "away for X" copy). */
  cappedMs: number;
  /** Pre-formatted revenue string (e.g. "1.50K" from formatBig). */
  gainedText: string;
}

/** Opaque handle returned by mountOfflineSummary. */
export interface OfflineSummaryHandles {
  /** Render the overlay with the given payload and make it visible. */
  show: (payload: OfflineSummaryPayload) => void;
  /** Hide the overlay without removing it from the DOM. */
  dismiss: () => void;
}

// ---------------------------------------------------------------------------
// formatDuration (exported for testing)
// ---------------------------------------------------------------------------

/**
 * formatDuration(ms) — human-readable elapsed time.
 *
 * Rules:
 *   < 60 s   → "Xs"
 *   < 1 h    → "Xm Ys"
 *   >= 1 h   → "Xh Ym"  (omits seconds — granularity not useful at hour scale)
 *
 * Truncates (floors) fractional units — never rounds up to the next boundary.
 *
 * @param ms  Duration in milliseconds (non-negative).
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes >= 1) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// mountOfflineSummary
// ---------------------------------------------------------------------------

/**
 * mountOfflineSummary(container)
 *
 * Creates and appends the overlay element inside container. The overlay
 * starts hidden (aria-hidden="true"). Call show() to reveal it.
 *
 * @param container  The element to append the overlay into (e.g. #app).
 */
export function mountOfflineSummary(
  container: HTMLElement,
): OfflineSummaryHandles {
  // ─── Root overlay ─────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'offline-summary';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Offline earnings summary');
  overlay.setAttribute('aria-hidden', 'true');

  // ─── Card ─────────────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'offline-summary__card';

  // Icon / eyebrow
  const eyebrow = document.createElement('div');
  eyebrow.className = 'offline-summary__eyebrow';
  eyebrow.setAttribute('aria-hidden', 'true');
  eyebrow.textContent = '◉ WHILE YOU WERE AWAY';

  // Heading
  const heading = document.createElement('h2');
  heading.className = 'offline-summary__heading';
  heading.textContent = 'You were away for';

  // Time-away value
  const timeEl = document.createElement('div');
  timeEl.className = 'offline-summary__time';
  timeEl.setAttribute('aria-label', 'Time away');

  // Divider
  const divider = document.createElement('div');
  divider.className = 'offline-summary__divider';
  divider.setAttribute('aria-hidden', 'true');

  // Earnings row
  const earningsRow = document.createElement('div');
  earningsRow.className = 'offline-summary__earnings';

  const earningsLabel = document.createElement('span');
  earningsLabel.className = 'offline-summary__earnings-label';
  earningsLabel.textContent = 'Revenue earned';

  const earningsValue = document.createElement('span');
  earningsValue.className = 'offline-summary__earnings-value';
  earningsValue.setAttribute('aria-label', 'Revenue earned while offline');

  earningsRow.appendChild(earningsLabel);
  earningsRow.appendChild(earningsValue);

  // Dismiss button
  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'offline-summary__dismiss';
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Collect';
  dismissBtn.setAttribute('aria-label', 'Collect offline earnings and close');

  dismissBtn.addEventListener('click', () => {
    dismiss();
  });

  // Assemble card
  card.appendChild(eyebrow);
  card.appendChild(heading);
  card.appendChild(timeEl);
  card.appendChild(divider);
  card.appendChild(earningsRow);
  card.appendChild(dismissBtn);

  overlay.appendChild(card);
  container.appendChild(overlay);

  // ─── show / dismiss ───────────────────────────────────────────────────────

  function show(payload: OfflineSummaryPayload): void {
    timeEl.textContent = formatDuration(payload.cappedMs);
    earningsValue.textContent = `+${payload.gainedText}`;
    overlay.setAttribute('aria-hidden', 'false');
  }

  function dismiss(): void {
    overlay.setAttribute('aria-hidden', 'true');
  }

  return { show, dismiss };
}
