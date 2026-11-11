/**
 * Worker entry point for the parser pool (see `parse-pool.ts`).
 *
 * Importing the parser registry here registers all built-in adapters inside
 * this worker's copy of the module graph (the parent process has its own).
 * The pool then sends one `ParseWorkerRequest` per conversation; the parsed
 * conversation goes back through `postMessage` and is structured-cloned, so
 * `ParsedConversation` must stay plain data (it is: strings, numbers, booleans
 * and arrays).
 *
 * Errors are caught here and reported as a message string, so one broken
 * conversation never takes the worker (or the pool) down. The parent rejects
 * the corresponding `parse()` promise with that message.
 */

import { parentPort } from "node:worker_threads";
import type {
	ConversationMeta,
	ParsedConversation,
} from "@chatcrystal/shared";
import { getAdapter } from "../parser/index.js";

/** One parse request: which adapter parses which conversation. */
export interface ParseWorkerRequest {
	/** Correlates the reply with the pool's pending promise. */
	id: number;
	adapterName: string;
	meta: ConversationMeta;
}

/** Reply to a `ParseWorkerRequest`; `error` is the thrown error's message. */
export type ParseWorkerResponse =
	| { id: number; ok: true; parsed: ParsedConversation }
	| { id: number; ok: false; error: string };

const UNKNOWN_ADAPTER = "Unknown parser adapter";

function errorMessage(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

async function handleRequest(request: ParseWorkerRequest): Promise<void> {
	if (!parentPort) return;
	const { id, adapterName, meta } = request;

	let response: ParseWorkerResponse;
	try {
		const adapter = getAdapter(adapterName);
		if (!adapter) throw new Error(`${UNKNOWN_ADAPTER}: ${adapterName}`);
		response = { id, ok: true, parsed: await adapter.parse(meta) };
	} catch (error) {
		response = { id, ok: false, error: errorMessage(error) };
	}

	try {
		parentPort.postMessage(response);
	} catch (error) {
		// `parsed` may hold something structured clone cannot transfer (a
		// stray non-plain value from an adapter). Report it as a task error so
		// the pool rejects instead of waiting forever.
		if (response.ok) {
			try {
				parentPort.postMessage({
					id,
					ok: false,
					error: `Parsed result could not be transferred from the worker: ${errorMessage(error)}`,
				} satisfies ParseWorkerResponse);
			} catch {
				// The pool closed and terminated this worker while parsing.
			}
		}
	}
}

parentPort?.on("message", (request: ParseWorkerRequest) => {
	void handleRequest(request);
});
