/** Serializes requests per host and keeps at least `minIntervalMs` between their starts. */
export class HostLimiter {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly lastStart = new Map<string, number>();
  private readonly intervalFor: (host: string) => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: {
    intervalFor: (host: string) => number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }) {
    this.intervalFor = options.intervalFor;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(host) ?? Promise.resolve();
    const result = previous.then(async () => {
      const wait = (this.lastStart.get(host) ?? -Infinity) + this.intervalFor(host) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart.set(host, this.now());
      return task();
    });
    // The queue continues after failures; callers still see their own rejection.
    this.tails.set(
      host,
      result.catch(() => undefined),
    );
    return result;
  }
}
