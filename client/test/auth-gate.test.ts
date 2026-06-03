import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("AuthGate auth refresh is not recreated by translation changes", () => {
	const source = readFileSync(
		path.join(root, "src/components/AuthGate.tsx"),
		"utf-8",
	);

	assert.doesNotMatch(
		source,
		/useCallback\([\s\S]*?\},\s*\[\s*t\s*\]\s*\)/,
		"AuthGate refresh should not depend on t because language changes must not rerun auth checks",
	);
});
