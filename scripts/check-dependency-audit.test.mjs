import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAuditReport, parseAuditReport } from "./check-dependency-audit.mjs";

function report(vulnerabilities) {
	return { metadata: { vulnerabilities } };
}

test("passes a clean dependency audit", () => {
	const result = evaluateAuditReport(
		report({ info: 0, low: 0, moderate: 0, high: 0, critical: 0 }),
	);

	assert.equal(result.passes, true);
	assert.equal(result.blockingCount, 0);
});

test("reports low and moderate findings without blocking", () => {
	const result = evaluateAuditReport(
		report({ info: 1, low: 2, moderate: 3, high: 0, critical: 0 }),
	);

	assert.equal(result.passes, true);
	assert.deepEqual(result.counts, {
		info: 1,
		low: 2,
		moderate: 3,
		high: 0,
		critical: 0,
	});
});

test("blocks high and critical findings", () => {
	const result = evaluateAuditReport(
		report({ info: 0, low: 0, moderate: 0, high: 2, critical: 1 }),
	);

	assert.equal(result.passes, false);
	assert.equal(result.blockingCount, 3);
});

test("rejects audit output without vulnerability metadata", () => {
	assert.throws(() => evaluateAuditReport({}), /metadata\.vulnerabilities/);
});

test("parses pnpm audit JSON", () => {
	assert.deepEqual(parseAuditReport('{"metadata":{"vulnerabilities":{}}}'), {
		metadata: { vulnerabilities: {} },
	});
});
