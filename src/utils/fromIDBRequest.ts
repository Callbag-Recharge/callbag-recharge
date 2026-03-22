import type { CallbagSource } from "../raw/subscribe";

/** Wrap an IDBRequest into a raw callbag source that emits once, then ENDs. */
export function fromIDBRequest<R>(req: IDBRequest<R>): CallbagSource {
	return (type: number, sink?: any) => {
		if (type !== 0) return;
		let done = false;
		sink(0, (t: number) => {
			if (t === 2) done = true;
		});
		req.onsuccess = () => {
			if (done) return;
			done = true;
			sink(1, req.result);
			sink(2);
		};
		req.onerror = () => {
			if (done) return;
			done = true;
			sink(2, req.error);
		};
	};
}
