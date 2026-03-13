// ---------------------------------------------------------------------------
// Inspector tests — observability without per-store overhead
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, derived, stream, subscribe, Inspector } from '../index';

beforeEach(() => {
  Inspector._reset();
});

describe('Inspector', () => {
  it('inspect() returns store info', () => {
    const count = state(42, { name: 'count' });
    const info = Inspector.inspect(count);

    expect(info.name).toBe('count');
    expect(info.kind).toBe('state');
    expect(info.value).toBe(42);
  });

  it('inspect() works on derived stores', () => {
    const a = state(1, { name: 'a' });
    const sum = derived(() => a.get() + 10, { name: 'sum' });
    const info = Inspector.inspect(sum);

    expect(info.name).toBe('sum');
    expect(info.kind).toBe('derived');
    expect(info.value).toBe(11);
  });

  it('inspect() works on stream stores', () => {
    const s = stream<number>((emit) => {
      emit(99);
    }, { name: 'myStream' });

    // Start the producer
    s.source(0, () => {});

    const info = Inspector.inspect(s);
    expect(info.name).toBe('myStream');
    expect(info.kind).toBe('stream');
    expect(info.value).toBe(99);
  });

  it('getName() returns the store name', () => {
    const count = state(0, { name: 'count' });
    expect(Inspector.getName(count)).toBe('count');
  });

  it('getName() returns undefined for unnamed stores', () => {
    const count = state(0);
    expect(Inspector.getName(count)).toBeUndefined();
  });

  it('getKind() returns the store kind', () => {
    const s = state(0);
    const d = derived(() => s.get());
    expect(Inspector.getKind(s)).toBe('state');
    expect(Inspector.getKind(d)).toBe('derived');
  });

  it('graph() returns all living stores', () => {
    const a = state(1, { name: 'a' });
    const b = state(2, { name: 'b' });
    const sum = derived(() => a.get() + b.get(), { name: 'sum' });

    const g = Inspector.graph();
    expect(g.size).toBe(3);
    expect(g.has('a')).toBe(true);
    expect(g.has('b')).toBe(true);
    expect(g.has('sum')).toBe(true);
    expect(g.get('sum')!.value).toBe(3);
  });

  it('trace() tracks value changes', () => {
    const count = state(0, { name: 'traced' });
    const changes: Array<{ value: number; prev: number | undefined }> = [];

    const unsub = Inspector.trace(count, (value, prev) => {
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

  it('stores are plain objects — no extra properties', () => {
    const count = state(0, { name: 'count' });

    // Store only has get, set, update, source — nothing else
    const keys = Object.keys(count);
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('kind');
    expect(keys).not.toContain('deps');
    expect(keys).not.toContain('subs');
  });

  it('_reset() clears all state', () => {
    state(0, { name: 'foo' });
    Inspector._reset();
    const g = Inspector.graph();
    expect(g.size).toBe(0);
  });
});
