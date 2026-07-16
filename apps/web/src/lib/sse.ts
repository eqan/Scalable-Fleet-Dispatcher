/**
 * SSE (Server-Sent Events) client -- real-time sync with the backend.
 *
 * Design principles:
 *   - Single Responsibility: handles ONLY the EventSource lifecycle + parsing.
 *   - Open/Closed: consumers register callbacks; this module doesn't know
 *     about React, TanStack Query, or Zustand.
 *   - Reconnection: relies on the browser's built-in EventSource retry,
 *     plus we track connection state via callbacks.
 *
 * Backend SSE protocol:
 *   - On connect:  `data: {"type":"connected","clientId":"...","lastEventId":null}`
 *   - On change:   `id: N\nevent: state_changed\ndata: {"kind":"...","rev":N,...}`
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Shape of every `state_changed` SSE event from the backend. */
export interface StateChangeEvent {
  kind: string;
  rev: number;
  vehicleId?: string;
  orderId?: string;
  data?: unknown;
}

/** Callbacks the consumer provides to react to SSE lifecycle. */
export interface SSECallbacks {
  /** Fired when the EventSource connection opens. */
  onOpen: () => void;
  /** Fired on every `state_changed` event. */
  onStateChange: (event: StateChangeEvent) => void;
  /** Fired when the connection drops (browser will auto-retry). */
  onError: () => void;
  /** Fired when replay buffer overflow is detected — client should full-refresh. */
  onMissedEvents?: () => void;
}

/* ------------------------------------------------------------------ */
/*  SSE Client class                                                   */
/* ------------------------------------------------------------------ */

export class SSEClient {
  private source: EventSource | null = null;
  private url: string;
  private callbacks: SSECallbacks;

  constructor(url: string, callbacks: SSECallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  /** Open the EventSource connection. Idempotent -- safe to call twice. */
  connect(): void {
    if (this.source) return;

    this.source = new EventSource(this.url);

    this.source.onopen = () => {
      this.callbacks.onOpen();
    };

    this.source.addEventListener("state_changed", (e: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(e.data) as StateChangeEvent;
        this.callbacks.onStateChange(parsed);
      } catch {
        console.error("[SSE] Failed to parse state_changed event:", e.data);
      }
    });

    this.source.addEventListener("missed_events", () => {
      this.callbacks.onMissedEvents?.();
    });

    this.source.onerror = () => {
      // EventSource auto-reconnects. We just notify the consumer
      // so it can update connection status UI.
      this.callbacks.onError();
    };
  }

  /** Close the EventSource. Safe to call even if not connected. */
  disconnect(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  /** Whether the underlying EventSource is in OPEN state. */
  get isConnected(): boolean {
    return this.source?.readyState === EventSource.OPEN;
  }
}
