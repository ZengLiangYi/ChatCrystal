#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

function count(value) {
	return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function evaluateAuditReport(report) {
	const vulnerabilities = report?.metadata?.vulnerabilities;
	if (!vulnerabilities || typeof vulnerabilities !== "object") {
		throw new Error("pnpm audit output is missing metadata.vulnerabilities");
	}

	const counts = Object.fromEntries(
		SEVERITIES.map((severity) => [severity, count(vulnerabilities[severity])]),
	);
	const blockingCount = counts.high + counts.critical;

	return {
		counts,
		blockingCount,
		passes: blockingCount === 0,
	};
}

export function parseAuditReport(output) {
	if (!output.trim()) {
		throw new Error("pnpm audit returned no JSON output");
	}
	return JSON.parse(output);
}

function runAudit() {
	const pnpmEntry = process.env.npm_execpath;
	const command = pnpmEntry ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const args = pnpmEntry ? [pnpmEntry, "audit", "--json"] : ["audit", "--json"];
	const result = spawnSync(command, args, {
		cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
		encoding: "utf8",
	});

	if (result.error) {
		console.error(`Unable to run pnpm audit: ${result.error.message}`);
		return 1;
	}
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	if (result.stdout) {
		process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
	}

	try {
		const evaluation = evaluateAuditReport(parseAuditReport(result.stdout));
		const summary = SEVERITIES.map(
			(severity) => `${severity}=${evaluation.counts[severity]}`,
		).join(", ");
		console.log(`Dependency audit summary: ${summary}`);

		if (!evaluation.passes) {
			console.error(
				`Dependency audit failed: ${evaluation.blockingCount} high/critical vulnerability finding(s).`,
			);
			return 1;
		}

		console.log("Dependency audit passed: no high or critical vulnerabilities.");
		return 0;
	} catch (error) {
		console.error(`Unable to evaluate pnpm audit output: ${error.message}`);
		return 1;
	}
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	process.exitCode = runAudit();
}
