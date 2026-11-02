/* eslint-disable no-control-regex -- Control characters are explicitly rejected in vault paths. */
import { Vault } from "obsidian";

/** Paths are vault-relative; reject traversal before Obsidian normalizes it. */
export function safePath(path: string): string {
	const parts = path.replace(/\\/g, "/").split("/");
	if (!path || path.startsWith("/") || parts.some((p) => !p || p === "." || p === ".." || /[\u0000-\u001f:]/.test(p))) {
		throw new Error(`Unsafe Pocket path: ${path}`);
	}
	return parts.join("/");
}

export function safeSegment(value: string): string {
	return value.normalize("NFC").replace(/[\u0000-\u001f\\/:*?"<>|#[\]^]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 100) || "Untitled";
}

export function pathKey(value: string): string {
	return value.normalize("NFC").toLowerCase();
}

/** Reservations include both the vault and the complete batch, including case aliases. */
export class PathReservations {
	private readonly occupied = new Set<string>();
	private readonly reserved = new Map<string, string>();
	constructor(vault: Vault) {
		for (const file of vault.getAllLoadedFiles()) this.occupied.add(pathKey(file.path));
	}

	reserve(desired: string, owner: string, previous: string | null = null): string {
		safePath(desired);
		const available = (path: string): boolean => {
			const key = pathKey(path);
			return (!this.reserved.has(key) || this.reserved.get(key) === owner) &&
				(!this.occupied.has(key) || (previous !== null && pathKey(previous) === key));
		};
		let candidate = desired;
		const suffix = safeSegment(owner);
		let count = 0;
		while (!available(candidate)) {
			count += 1;
			const extension = desired.endsWith(".md") ? ".md" : "";
			candidate = `${extension ? desired.slice(0, -3) : desired} ${suffix}${count > 1 ? `-${count}` : ""}${extension}`;
		}
		this.reserved.set(pathKey(candidate), owner);
		return candidate;
	}
}
