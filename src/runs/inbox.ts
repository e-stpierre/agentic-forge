/**
 * Operator inbox of one run: `inbox/<YYYYMMDDTHHMMSSmmmZ>-<id>.json`, one
 * contract inbox message per file (see docs/harness-contract.md).
 *
 * Files need no lock: each message is its own file, created once by the
 * sender, and only `delivered_at` is updated afterward, by the deliverer.
 *
 * Delivery is at most once: `delivered_at` is written before the prompt that
 * carries the message is started, so a supervisor restart never delivers a
 * message twice.
 */

import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { validateArtifact } from "../contract/index.js";
import { ContractWriteError } from "./run-store.js";

export const INBOX_DIR = "inbox";

export interface InboxMessage {
	id: string;
	at: string;
	from: "user" | "overseer";
	mode: "next" | "now";
	text: string;
	target: "run" | "step";
	step?: string | null;
	delivered_at?: string | null;
	/** Step the message was injected into (af extension). */
	"x-af-delivered-to"?: string;
}

export interface NewMessage {
	text: string;
	from?: "user" | "overseer";
	mode?: "next" | "now";
	/** Step name; the message targets the run when omitted. */
	step?: string | null;
}

interface StoredMessage {
	file: string;
	message: InboxMessage;
}

/** `2026-11-10T12:00:00.000Z` -> `20261110T120000000Z` */
function fileTimestamp(iso: string): string {
	return iso.replace(/[-:.]/g, "");
}

/** Renders the `## Operator Messages` section injected before a step prompt. */
export function formatOperatorMessages(messages: InboxMessage[]): string {
	if (messages.length === 0) return "";
	const lines = messages.map(
		(m) => `- [${m.from}, ${m.at.replace(/\.\d{3}Z$/, "Z")}, ${m.id}] ${m.text.trim()}`,
	);
	return `## Operator Messages\n\n${lines.join("\n")}\n\n`;
}

export class Inbox {
	readonly dir: string;

	constructor(runDir: string) {
		this.dir = path.join(runDir, INBOX_DIR);
	}

	/** Writes a new pending message and returns it. */
	queue(input: NewMessage): InboxMessage {
		const at = new Date().toISOString();
		const id = `m-${randomBytes(4).toString("hex")}`;
		const message: InboxMessage = {
			id,
			at,
			from: input.from ?? "user",
			mode: input.mode ?? "next",
			text: input.text,
			target: input.step ? "step" : "run",
			...(input.step ? { step: input.step } : {}),
			delivered_at: null,
		};
		const file = path.join(this.dir, `${fileTimestamp(at)}-${id}.json`);
		this.write(file, message);
		return message;
	}

	/** Every message in queue order (file name order). */
	list(): InboxMessage[] {
		return this.stored().map((s) => s.message);
	}

	/** Pending messages that a prompt of `step` should receive, in queue order. */
	pending(step: string): InboxMessage[] {
		return this.stored()
			.filter((s) => !s.message.delivered_at)
			.filter((s) => s.message.target === "run" || s.message.step === step)
			.map((s) => s.message);
	}

	/** Sets `delivered_at` (and the step) on the given messages and returns the updated copies. */
	markDelivered(ids: string[], step?: string, at = new Date().toISOString()): InboxMessage[] {
		const wanted = new Set(ids);
		const updated: InboxMessage[] = [];
		for (const { file, message } of this.stored()) {
			if (!wanted.has(message.id) || message.delivered_at) continue;
			const next: InboxMessage = {
				...message,
				delivered_at: at,
				...(step ? { "x-af-delivered-to": step } : {}),
			};
			this.write(file, next);
			updated.push(next);
		}
		return updated;
	}

	private stored(): StoredMessage[] {
		if (!existsSync(this.dir)) return [];
		const out: StoredMessage[] = [];
		for (const name of readdirSync(this.dir).sort()) {
			if (!name.endsWith(".json")) continue;
			const file = path.join(this.dir, name);
			try {
				out.push({ file, message: JSON.parse(readFileSync(file, "utf-8")) as InboxMessage });
			} catch {
				// A message being written (or a corrupt file) is skipped
			}
		}
		return out;
	}

	private write(file: string, message: InboxMessage): void {
		const result = validateArtifact("inbox-message", message);
		if (!result.valid) {
			throw new ContractWriteError(
				file,
				result.errors.map((e) => `${e.path} ${e.message}`),
			);
		}
		mkdirSync(this.dir, { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(message, null, 2)}\n`, "utf-8");
		renameSync(tmp, file);
	}
}
