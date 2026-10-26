import { LocalDatabase } from '../storage/db';
import { SyncOrchestrator } from './orchestrator';

/** Foreground polling plus durable, debounced writes. Never opens an OAuth popup. */
export class AutomaticSync {
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  private stopped = true;
  private running = false;
  private dirty = false;
  private retryMs = 5_000;
  private retryAt = 0;

  constructor(private db: LocalDatabase, private sync: SyncOrchestrator, private options: {
    enabled: () => boolean;
    authorize: () => Promise<boolean>;
    intervalMs?: number;
    debounceMs?: number;
    now?: () => number;
  }) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe = this.db.subscribeToLocalChanges(() => this.request());
    this.poll = setInterval(() => this.request(), this.options.intervalMs ?? 15_000);
    this.request(true);
  }

  /** Foreground/reconnection may retry immediately; normal writes respect backoff. */
  request(immediate = false): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const now = this.options.now?.() ?? Date.now();
    const delay = immediate ? 0 : Math.max(this.options.debounceMs ?? 750, this.retryAt - now);
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, delay);
  }

  private async run(): Promise<void> {
    if (this.stopped || !this.options.enabled() || this.sync.getStatus().isPaused) return;
    if (this.db.isTransactionInProgress() || this.sync.isBusy()) { this.request(); return; }
    this.running = true; this.dirty = false;
    try {
      await this.db.waitForPendingWrites();
      if (!await this.options.authorize()) { this.retryAt = (this.options.now?.() ?? Date.now()) + 120_000; return; }
      if (this.stopped || !this.options.enabled()) return;
      await this.sync.triggerSync(false);
      const status = this.sync.getStatus();
      if (['error_retryable', 'network_unavailable'].includes(status.state)) {
        this.retryAt = (this.options.now?.() ?? Date.now()) + this.retryMs;
        this.retryMs = Math.min(this.retryMs * 2, 120_000); this.dirty = true;
      } else if (['auth_required', 'quota_full'].includes(status.state)) {
        this.retryAt = (this.options.now?.() ?? Date.now()) + 120_000;
      } else { this.retryAt = 0; this.retryMs = 5_000; }
    } catch {
      this.retryAt = (this.options.now?.() ?? Date.now()) + this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, 120_000); this.dirty = true;
    } finally {
      this.running = false;
      if (this.dirty && !this.stopped) this.request();
    }
  }

  stop(): void {
    this.stopped = true; this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
  }
}
