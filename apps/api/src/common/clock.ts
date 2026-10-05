// Источник времени. В тестах подменяется управляемыми часами.
export abstract class Clock {
  abstract now(): number;
}

export class SystemClock extends Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock extends Clock {
  constructor(private current: number) {
    super();
  }

  now(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
