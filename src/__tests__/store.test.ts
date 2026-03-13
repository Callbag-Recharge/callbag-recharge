import { describe, it, expect, vi } from 'vitest';
import {
  state,
  derived,
  stream,
  effect,
  pipe,
  map,
  filter,
  scan,
  inspect,
  graph,
  observe,
  trace,
} from '../index';

describe('state', () => {
  it('holds a value readable by calling or .value', () => {
    const count = state(0, { name: 'count' });
    expect(count()).toBe(0);
    expect(count.value).toBe(0);
  });

  it('updates with set()', () => {
    const count = state(0);
    count.set(5);
    expect(count()).toBe(5);
  });

  it('updates with update()', () => {
    const count = state(0);
    count.update((n) => n + 1);
    expect(count()).toBe(1);
  });

  it('skips update when value is the same (Object.is)', () => {
    const count = state(0);
    const cb = vi.fn();
    count.subscribe(cb);
    count.set(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it('notifies subscribers on change', () => {
    const count = state(0);
    const values: number[] = [];
    count.subscribe((v) => values.push(v));
    count.set(1);
    count.set(2);
    expect(values).toEqual([1, 2]);
  });
});

describe('derived', () => {
  it('computes from a state store', () => {
    const count = state(3, { name: 'count' });
    const doubled = derived(() => count() * 2, { name: 'doubled' });
    expect(doubled()).toBe(6);
    expect(doubled.value).toBe(6);
  });

  it('recomputes when dependency changes', () => {
    const count = state(1);
    const doubled = derived(() => count() * 2);
    expect(doubled()).toBe(2);
    count.set(5);
    expect(doubled()).toBe(10);
  });

  it('tracks multiple dependencies', () => {
    const a = state(2, { name: 'a' });
    const b = state(3, { name: 'b' });
    const sum = derived(() => a() + b(), { name: 'sum' });
    expect(sum()).toBe(5);
    a.set(10);
    expect(sum()).toBe(13);
    b.set(7);
    expect(sum()).toBe(17);
  });

  it('chains derivations', () => {
    const count = state(2);
    const doubled = derived(() => count() * 2);
    const quadrupled = derived(() => doubled() * 2);
    expect(quadrupled()).toBe(8);
    count.set(3);
    expect(quadrupled()).toBe(12);
  });

  it('notifies subscribers', () => {
    const count = state(0);
    const doubled = derived(() => count() * 2);
    const values: number[] = [];
    doubled.subscribe((v) => values.push(v));
    count.set(1);
    count.set(2);
    expect(values).toEqual([2, 4]);
  });
});

describe('stream', () => {
  it('emits values from a producer', () => {
    let emitter: (v: number) => void;
    const s = stream<number>((emit) => {
      emitter = emit;
    }, { name: 'myStream' });

    const values: (number | undefined)[] = [];
    s.subscribe((v) => values.push(v));

    emitter!(1);
    emitter!(2);
    emitter!(3);

    expect(values).toEqual([1, 2, 3]);
    expect(s.value).toBe(3);
  });

  it('holds latest value', () => {
    let emitter: (v: string) => void;
    const s = stream<string>((emit) => {
      emitter = emit;
    });

    s.subscribe(() => {}); // start the producer
    emitter!('hello');
    expect(s()).toBe('hello');
    expect(s.value).toBe('hello');
  });

  it('cleans up when all subscribers leave', () => {
    const cleanup = vi.fn();
    const s = stream<number>((emit) => {
      emit(1);
      return cleanup;
    });

    const unsub = s.subscribe(() => {});
    expect(cleanup).not.toHaveBeenCalled();
    unsub();
    expect(cleanup).toHaveBeenCalled();
  });
});

describe('effect', () => {
  it('runs immediately and re-runs on dependency change', () => {
    const count = state(0);
    const log: number[] = [];

    effect(() => {
      log.push(count());
    });

    expect(log).toEqual([0]);
    count.set(1);
    expect(log).toEqual([0, 1]);
    count.set(2);
    expect(log).toEqual([0, 1, 2]);
  });

  it('cleans up previous effect on re-run', () => {
    const count = state(0);
    const cleanups: number[] = [];

    effect(() => {
      const val = count();
      return () => cleanups.push(val);
    });

    count.set(1);
    expect(cleanups).toEqual([0]); // cleaned up effect from val=0
    count.set(2);
    expect(cleanups).toEqual([0, 1]);
  });

  it('stops when disposed', () => {
    const count = state(0);
    const log: number[] = [];

    const dispose = effect(() => {
      log.push(count());
    });

    count.set(1);
    dispose();
    count.set(2);
    expect(log).toEqual([0, 1]); // 2 never logged
  });
});

describe('pipe + operators', () => {
  it('map creates an inspectable store', () => {
    const count = state(5, { name: 'count' });
    const doubled = pipe(count, map((n) => n * 2));

    expect(doubled()).toBe(10);
    expect(doubled.value).toBe(10);
    expect(doubled.kind).toBe('derived');

    count.set(7);
    expect(doubled()).toBe(14);
  });

  it('filter only passes matching values', () => {
    const count = state(0, { name: 'count' });
    const positive = pipe(count, filter((n) => n > 0, { name: 'positive' }));

    expect(positive()).toBe(0); // initial
    count.set(-1);
    expect(positive()).toBe(0); // filtered out
    count.set(5);
    expect(positive()).toBe(5);
  });

  it('scan accumulates values', () => {
    const count = state(0);
    const total = pipe(
      count,
      scan((acc, n) => acc + n, 0, { name: 'total' }),
    );

    expect(total()).toBe(0);
    count.set(5);
    expect(total()).toBe(5);
    count.set(3);
    expect(total()).toBe(8);
  });

  it('chains operators — each step is inspectable', () => {
    const count = state(1, { name: 'count' });

    const step1 = map((n: number) => n * 10, { name: 'times10' });
    const step2 = filter((n: number) => n > 20, { name: 'gt20' });

    const result = pipe(count, step1, step2);

    expect(result()).toBe(10); // 1*10=10, doesn't pass >20, holds initial

    count.set(3); // 30 passes
    expect(result()).toBe(30);

    count.set(1); // 10 doesn't pass, keeps 30
    expect(result()).toBe(30);
  });
});

describe('observability', () => {
  it('inspect() returns store info', () => {
    const count = state(42, { name: 'count' });
    const info = inspect(count);

    expect(info.name).toBe('count');
    expect(info.kind).toBe('state');
    expect(info.value).toBe(42);
  });

  it('inspect() shows deps for derived stores', () => {
    const a = state(1, { name: 'a' });
    const b = state(2, { name: 'b' });
    const sum = derived(() => a() + b(), { name: 'sum' });

    const info = inspect(sum);
    expect(info.deps).toContain('a');
    expect(info.deps).toContain('b');
  });

  it('graph() returns all stores', () => {
    // Note: graph includes stores from other tests too, so just check it works
    const g = graph();
    expect(g).toBeInstanceOf(Map);
    expect(g.size).toBeGreaterThan(0);
  });

  it('observe() receives store events', () => {
    const events: string[] = [];
    const unsub = observe((event) => {
      if (event.type === 'update') {
        events.push(`${event.store.name}: ${event.prev} → ${event.value}`);
      }
    });

    const x = state(0, { name: 'x' });
    x.set(1);
    x.set(2);

    expect(events).toContain('x: 0 → 1');
    expect(events).toContain('x: 1 → 2');
    unsub();
  });

  it('trace() tracks a specific store', () => {
    const count = state(0, { name: 'traced' });
    const changes: Array<{ value: number; prev: number | undefined }> = [];

    const unsub = trace(count, (value, prev) => {
      changes.push({ value, prev });
    });

    count.set(10);
    count.set(20);
    unsub();
    count.set(30); // not traced

    expect(changes).toEqual([
      { value: 10, prev: 0 },
      { value: 20, prev: 10 },
    ]);
  });
});
