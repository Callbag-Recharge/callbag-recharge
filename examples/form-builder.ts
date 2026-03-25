/**
 * Form Builder — Multi-field form with sync + async validation
 *
 * Demonstrates: formField pattern, sync validators, async validators
 * with debounce + AbortSignal, derived aggregation for form-level validity.
 */

import { derived } from "callbag-recharge";
import { firstValueFrom, fromTimer } from "callbag-recharge/extra";
import { formField } from "callbag-recharge/patterns/formField";

// #region display

// ── Fields ───────────────────────────────────────────────────

export const nameField = formField("", {
	name: "name",
	validate: (v) => (v.trim().length < 2 ? "Name must be at least 2 characters" : undefined),
});

export const emailField = formField("", {
	name: "email",
	validate: (v) => (!v.includes("@") ? "Must be a valid email" : undefined),
	asyncValidate: async (v, signal) => {
		// Simulate checking if email is taken (300ms debounce built-in)
		await firstValueFrom(fromTimer(200, signal));
		if (signal.aborted) return undefined;
		const taken = ["admin@example.com", "test@example.com"];
		return taken.includes(v) ? "Email already taken" : undefined;
	},
});

export const passwordField = formField("", {
	name: "password",
	validate: (v) => {
		if (v.length < 8) return "Must be at least 8 characters";
		if (!/[A-Z]/.test(v)) return "Must include an uppercase letter";
		if (!/[0-9]/.test(v)) return "Must include a number";
		return undefined;
	},
});

export const confirmField = formField("", {
	name: "confirm",
	validate: (v) => (v !== passwordField.value.get() ? "Passwords must match" : undefined),
});

// ── Form-level aggregation ───────────────────────────────────

export const fields = [nameField, emailField, passwordField, confirmField] as const;

export const allValid = derived(
	[...fields.map((f) => f.valid), passwordField.value, confirmField.value],
	() => {
		if (!fields.every((f) => f.valid.get())) return false;
		// Cross-field: confirm must match password (catches stale confirm validation)
		const pw = passwordField.value.get();
		const cf = confirmField.value.get();
		if (pw !== cf) return false;
		return true;
	},
	{ name: "allValid" },
);

export const anyDirty = derived(
	fields.map((f) => f.dirty),
	() => fields.some((f) => f.dirty.get()),
	{ name: "anyDirty" },
);

export const anyValidating = derived(
	fields.map((f) => f.validating),
	() => fields.some((f) => f.validating.get()),
	{ name: "anyValidating" },
);

// ── Actions ──────────────────────────────────────────────────

export function resetAll() {
	for (const f of fields) f.reset();
}

export function disposeAll() {
	for (const f of fields) f.dispose();
}

// #endregion display
