export interface SerialPollingOptions<T> {
  load: () => Promise<T>;
  onValue: (value: T) => void;
  shouldContinue: (value: T) => boolean;
  intervalMs: number;
  onError?: (error: unknown) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Runs at most one request at a time and schedules only after the previous one settles. */
export function startSerialPolling<T>(options: SerialPollingOptions<T>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? clearTimeout;

  const poll = async () => {
    if (stopped) return;
    try {
      const value = await options.load();
      if (stopped) return;
      options.onValue(value);
      if (options.shouldContinue(value)) timer = schedule(poll, options.intervalMs);
    } catch (error) {
      if (!stopped) options.onError?.(error);
    }
  };

  void poll();
  return () => {
    stopped = true;
    if (timer !== null) cancel(timer);
  };
}
