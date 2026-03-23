import { describe, expect, it } from "vitest";
import { Inspector } from "../../core/inspector";
import { derived } from "../../index";
import { formField } from "../../patterns/formField/index";

describe("form-builder example", () => {
	it("name field: empty string shows validation error", () => {
		const name = formField("", {
			name: "name",
			validate: (v: string) =>
				v.trim().length < 2 ? "Name must be at least 2 characters" : undefined,
		});

		expect(name.error.get()).toBe("Name must be at least 2 characters");
		expect(name.valid.get()).toBe(false);

		name.dispose();
	});

	it("name field: valid name clears error", () => {
		const name = formField("", {
			name: "name",
			validate: (v: string) =>
				v.trim().length < 2 ? "Name must be at least 2 characters" : undefined,
		});

		name.set("John");
		expect(name.error.get()).toBe("");
		expect(name.valid.get()).toBe(true);

		name.dispose();
	});

	it("email field: missing @ shows validation error", () => {
		const email = formField("", {
			name: "email",
			validate: (v: string) => (!v.includes("@") ? "Must be a valid email" : undefined),
		});

		email.set("invalid-email");
		expect(email.error.get()).toBe("Must be a valid email");
		expect(email.valid.get()).toBe(false);

		email.set("user@example.com");
		expect(email.error.get()).toBe("");
		expect(email.valid.get()).toBe(true);

		email.dispose();
	});

	it("password field: short password shows error", () => {
		const password = formField("", {
			name: "password",
			validate: (v: string) => {
				if (v.length < 8) return "Must be at least 8 characters";
				if (!/[A-Z]/.test(v)) return "Must include an uppercase letter";
				if (!/[0-9]/.test(v)) return "Must include a number";
				return undefined;
			},
		});

		password.set("short");
		expect(password.valid.get()).toBe(false);

		password.set("LongEnough1");
		expect(password.valid.get()).toBe(true);
		expect(password.error.get()).toBe("");

		password.dispose();
	});

	it("allValid is false when any field is invalid", () => {
		const nameField = formField("", {
			name: "name",
			validate: (v: string) => (v.trim().length < 2 ? "Name required" : undefined),
		});
		const emailField = formField("", {
			name: "email",
			validate: (v: string) => (!v.includes("@") ? "Email invalid" : undefined),
		});
		const passwordField = formField("", {
			name: "password",
			validate: (v: string) => (v.length < 8 ? "Too short" : undefined),
		});
		const confirmField = formField("", {
			name: "confirm",
			validate: (v: string) =>
				v !== passwordField.value.get() ? "Passwords must match" : undefined,
		});

		const fields = [nameField, emailField, passwordField, confirmField] as const;

		const allValid = derived(
			[...fields.map((f) => f.valid), passwordField.value, confirmField.value],
			() => {
				if (!fields.every((f) => f.valid.get())) return false;
				const pw = passwordField.value.get();
				const cf = confirmField.value.get();
				if (pw !== cf) return false;
				return true;
			},
			{ name: "allValid" },
		);

		const obs = Inspector.observe(allValid);
		expect(allValid.get()).toBe(false);

		// Fill in all fields correctly
		nameField.set("John");
		emailField.set("john@example.com");
		passwordField.set("StrongPass1");
		confirmField.set("StrongPass1");

		expect(allValid.get()).toBe(true);

		obs.dispose();
		for (const f of fields) f.dispose();
	});

	it("password mismatch makes allValid false", () => {
		const passwordField = formField("", {
			name: "password",
			validate: (v: string) => (v.length < 8 ? "Too short" : undefined),
		});
		const confirmField = formField("", {
			name: "confirm",
			validate: (v: string) =>
				v !== passwordField.value.get() ? "Passwords must match" : undefined,
		});

		const allValid = derived(
			[passwordField.valid, confirmField.valid, passwordField.value, confirmField.value],
			() => {
				if (!passwordField.valid.get() || !confirmField.valid.get()) return false;
				return passwordField.value.get() === confirmField.value.get();
			},
			{ name: "allValid" },
		);

		const obs = Inspector.observe(allValid);

		passwordField.set("StrongPass1");
		confirmField.set("DifferentPass1");
		expect(allValid.get()).toBe(false);

		confirmField.set("StrongPass1");
		expect(allValid.get()).toBe(true);

		obs.dispose();
		passwordField.dispose();
		confirmField.dispose();
	});

	it("dirty tracks whether field was modified", () => {
		const name = formField("", {
			name: "name",
			validate: (v: string) => (v.trim().length < 2 ? "Name required" : undefined),
		});

		expect(name.dirty.get()).toBe(false);

		name.set("something");
		expect(name.dirty.get()).toBe(true);

		name.dispose();
	});

	it("reset clears field to initial value", () => {
		const name = formField("", {
			name: "name",
			validate: (v: string) => (v.trim().length < 2 ? "Name required" : undefined),
		});

		name.set("John");
		expect(name.value.get()).toBe("John");

		name.reset();
		expect(name.value.get()).toBe("");

		name.dispose();
	});
});
