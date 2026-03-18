/**
 * Level 3 / utils algorithm baselines. Several scenarios grow Maps/logs unbounded
 * over a long bench run — fair for A vs B in the same describe, but absolute ops/sec
 * can drift as heaps grow; use for relative comparison only.
 */
import { bench, describe } from "vitest";
import { reactiveIndex } from "../data/reactiveIndex";
import { reactiveLog } from "../data/reactiveLog";
import { reactiveMap } from "../data/reactiveMap";
import { state } from "../index";
import { collection } from "../memory/collection";
import { fifo, lru, scored } from "../utils/eviction";
import { reactiveScored } from "../utils/reactiveEviction";

const KEYS = 64;
function key(i: number): string {
	return `k${i % KEYS}`;
}

describe("data: reactiveMap vs Map (set+get)", () => {
	const rm = reactiveMap<number>();
	const m = new Map<string, number>();
	let i = 0;
	bench("native Map", () => {
		const k = key(i++);
		m.set(k, i);
		m.get(k);
	});
	let j = 0;
	bench("reactiveMap", () => {
		const k = key(j++);
		rm.set(k, j);
		rm.get(k);
	});
});

describe("data: reactiveMap.update vs Map RMW", () => {
	const rm = reactiveMap<number>();
	const m = new Map<string, number>();
	for (let k = 0; k < KEYS; k++) {
		const keyStr = `k${k}`;
		rm.set(keyStr, 0);
		m.set(keyStr, 0);
	}
	let i = 0;
	bench("Map get+set", () => {
		const k = key(i++);
		const v = m.get(k) ?? 0;
		m.set(k, v + 1);
	});
	let j = 0;
	bench("reactiveMap.update", () => {
		const k = key(j++);
		rm.update(k, (v) => (v ?? 0) + 1);
	});
});

describe("data: reactiveMap select(k0).get vs Map.get (other keys churn)", () => {
	const rm = reactiveMap<number>();
	const m = new Map<string, number>();
	rm.set("k0", 1);
	m.set("k0", 1);
	const sel = rm.select("k0");
	let i = 0;
	bench("Map.get k0", () => {
		m.set(key(i++ + 1), i);
		m.get("k0");
	});
	let j = 0;
	bench("reactiveMap select k0", () => {
		rm.set(key(j++ + 1), j);
		sel.get();
	});
});

describe("data: reactiveLog.append vs array push", () => {
	const log = reactiveLog<number>();
	const arr: number[] = [];
	let i = 0;
	bench("array.push", () => {
		arr.push(i++);
	});
	let j = 0;
	bench("reactiveLog.append", () => {
		log.append(j++);
	});
});

describe("data: bounded reactiveLog vs ring buffer", () => {
	const cap = 256;
	const log = reactiveLog<number>({ maxSize: cap });
	const ring: number[] = [];
	let head = 0;
	let seq = 0;
	bench("ring buffer", () => {
		if (ring.length < cap) ring.push(seq++);
		else {
			ring[head] = seq++;
			head = (head + 1) % cap;
		}
	});
	let j = 0;
	bench("reactiveLog bounded", () => {
		log.append(j++);
	});
});

describe("data: reactiveIndex vs hand-rolled double map", () => {
	const idx = reactiveIndex();
	const index = new Map<string, Set<string>>();
	const reverse = new Map<string, Set<string>>();

	function handAdd(pk: string, indexKeys: string[]): void {
		for (const ik of indexKeys) {
			let s = index.get(ik);
			if (!s) {
				s = new Set();
				index.set(ik, s);
			}
			s.add(pk);
		}
		let rs = reverse.get(pk);
		if (!rs) {
			rs = new Set();
			reverse.set(pk, rs);
		}
		for (const ik of indexKeys) rs.add(ik);
	}

	function handRemove(pk: string): void {
		const rs = reverse.get(pk);
		if (!rs) return;
		for (const ik of rs) {
			const s = index.get(ik);
			if (s) {
				s.delete(pk);
				if (s.size === 0) index.delete(ik);
			}
		}
		reverse.delete(pk);
	}

	let i = 0;
	bench("hand-rolled index", () => {
		const pk = `p${i % 128}`;
		handRemove(pk);
		handAdd(pk, [`t${i % 8}`, `u${i % 4}`]);
		i++;
	});
	let j = 0;
	bench("reactiveIndex", () => {
		const pk = `p${j % 128}`;
		idx.remove(pk);
		idx.add(pk, [`t${j % 8}`, `u${j % 4}`]);
		j++;
	});
});

describe("data: reactiveIndex select vs Map.get (read hot path)", () => {
	const idx = reactiveIndex();
	const index = new Map<string, Set<string>>();
	for (let p = 0; p < 64; p++) {
		const tags = [`t${p % 8}`];
		idx.add(`p${p}`, tags);
		for (const t of tags) {
			let s = index.get(t);
			if (!s) {
				s = new Set();
				index.set(t, s);
			}
			s.add(`p${p}`);
		}
	}
	const sel = idx.select("t0");
	bench("Map.get(t0) ref", () => {
		index.get("t0");
	});
	bench("reactiveIndex.select(t0).get", () => {
		sel.get();
	});
});

describe("data: eviction lru vs naive array+Set", () => {
	const policy = lru<string>();
	const keys: string[] = [];
	const alive = new Set<string>();
	function naiveInsert(k: string): void {
		if (!alive.has(k)) {
			alive.add(k);
			keys.push(k);
		} else {
			const ix = keys.indexOf(k);
			if (ix >= 0) {
				keys.splice(ix, 1);
				keys.push(k);
			}
		}
	}
	function naiveEvict(): void {
		const k = keys.shift();
		if (k) alive.delete(k);
	}
	let i = 0;
	bench("lru()", () => {
		const k = key(i++);
		policy.touch(k);
		policy.insert(k);
		if (policy.size() > 48) policy.evict(1);
	});
	let j = 0;
	bench("naive MRU array", () => {
		const k = key(j++);
		naiveInsert(k);
		if (alive.size > 48) naiveEvict();
	});
});

describe("data: scored vs reactiveScored (evict(1)+reinsert, fixed N)", () => {
	const N = 128;
	const stores = new Map<string, ReturnType<typeof state<number>>>();
	for (let n = 0; n < N; n++) stores.set(`n${n}`, state(n));
	const rs = reactiveScored(
		(k: string) => stores.get(k)!,
		(x) => x,
	);
	for (let n = 0; n < N; n++) rs.insert(`n${n}`);
	const sc = scored<string>((k) => Number.parseInt(k.slice(1), 10) || 0);
	for (let n = 0; n < N; n++) sc.insert(`n${n}`);

	bench("scored() evict+reinsert", () => {
		const [k] = sc.evict(1);
		sc.insert(k);
	});
	bench("reactiveScored evict+reinsert", () => {
		const [k] = rs.evict(1);
		rs.insert(k);
	});
});

describe("data: fifo vs native queue pattern", () => {
	const policy = fifo<string>();
	const q: string[] = [];
	const alive = new Set<string>();
	let qh = 0;
	let i = 0;
	bench("fifo()", () => {
		const k = `x${i++}`;
		policy.insert(k);
		if (policy.size() > 40) policy.evict(1);
	});
	let j = 0;
	bench("array queue", () => {
		const k = `x${j++}`;
		if (!alive.has(k)) {
			alive.add(k);
			q.push(k);
		}
		while (alive.size > 40 && qh < q.length) {
			const kk = q[qh++];
			if (alive.delete(kk)) break;
		}
	});
});

describe("data: 50 adds + tag read (collection vs index only)", () => {
	bench("reactiveIndex x50 + get(tag)", () => {
		const idx = reactiveIndex();
		for (let i = 0; i < 50; i++) idx.add(`id${i}`, ["tag"]);
		idx.get("tag");
	});
	bench("collection x50 + byTag(tag)", () => {
		const col = collection<Record<string, never>>({ maxSize: 10_000 });
		for (let i = 0; i < 50; i++) col.add({}, { tags: new Set(["tag"]) });
		col.byTag("tag");
		col.destroy();
	});
});
