// ---------------------------------------------------------------------------
// namespace — scoped naming + isolation
// ---------------------------------------------------------------------------
// Pure naming convention for multi-tenant/scoped access. Prefixes keys with
// a namespace separator. Not a security boundary — just a naming helper.
//
// Usage:
//   const ns = namespace("tenant-a");
//   ns.prefix("orders"); // "tenant-a/orders"
//   const scoped = ns.checkpoint(adapter); // adapter with prefixed keys
//   const child = ns.child("sub"); // namespace("tenant-a/sub")
// ---------------------------------------------------------------------------

import type { CheckpointAdapter } from "./checkpoint";

const SEPARATOR = "/";

export interface Namespace {
	/** The namespace name. */
	readonly name: string;
	/** Prefix a key with this namespace. */
	prefix(key: string): string;
	/** Wrap a CheckpointAdapter to scope all keys under this namespace. */
	checkpoint(adapter: CheckpointAdapter): CheckpointAdapter;
	/** Create a child namespace. */
	child(name: string): Namespace;
}

/**
 * Create a scoped namespace for key prefixing and isolation.
 *
 * @param name - The namespace name (e.g., "tenant-a", "agent-1").
 *
 * @returns `Namespace` — helper with `prefix()`, `checkpoint()`, and `child()` methods.
 *
 * @remarks **Pure naming:** No reactive stores. Just string prefixing with `/` separator.
 * @remarks **Checkpoint scoping:** `ns.checkpoint(adapter)` wraps an adapter so all save/load/clear calls use prefixed keys. The underlying adapter is shared.
 * @remarks **Nesting:** `ns.child("sub")` creates `"parent/sub"` namespace. Unlimited nesting depth.
 * @remarks **Not a security boundary:** Any code with the adapter reference can bypass the namespace. This is a convention helper, not access control.
 *
 * @example
 * ```ts
 * import { namespace } from 'callbag-recharge/utils';
 * import { memoryAdapter, checkpoint } from 'callbag-recharge/utils';
 *
 * const ns = namespace("tenant-a");
 * const adapter = memoryAdapter();
 * const scoped = ns.checkpoint(adapter);
 * // scoped.save("step-1", value) → adapter.save("tenant-a/step-1", value)
 * ```
 *
 * @category utils
 */
export function namespace(name: string): Namespace {
	return {
		get name() {
			return name;
		},

		prefix(key: string): string {
			return `${name}${SEPARATOR}${key}`;
		},

		checkpoint(adapter: CheckpointAdapter): CheckpointAdapter {
			const self = this;
			return {
				save(id, value) {
					return adapter.save(self.prefix(id), value);
				},
				load(id) {
					return adapter.load(self.prefix(id));
				},
				clear(id) {
					return adapter.clear(self.prefix(id));
				},
			};
		},

		child(childName: string): Namespace {
			return namespace(`${name}${SEPARATOR}${childName}`);
		},
	};
}
