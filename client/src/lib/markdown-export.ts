type NoteCodeSnippet = {
	language?: unknown;
	description?: unknown;
	code?: unknown;
};

type NormalizedCodeSnippet = {
	language: string;
	description: string;
	code: string;
};

export type NoteMarkdownExportInput = {
	id?: unknown;
	title?: unknown;
	summary?: unknown;
	key_conclusions?: unknown;
	code_snippets?: unknown;
	source_type?: unknown;
	tags?: unknown;
};

type NoteMarkdownExportOptions = {
	exportedAt?: Date | string;
	labels?: Partial<NoteMarkdownExportLabels>;
};

export type NoteMarkdownExport = {
	filename: string;
	content: string;
};

type NoteMarkdownExportLabels = {
	summary: string;
	keyConclusions: string;
	codeSnippets: string;
};

const DEFAULT_LABELS: NoteMarkdownExportLabels = {
	summary: "Summary",
	keyConclusions: "Key Conclusions",
	codeSnippets: "Code Snippets",
};

function cleanString(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => cleanString(item))
		.filter((item) => item.length > 0);
}

function yamlScalar(value: string) {
	if (/^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/.test(value)) {
		return value;
	}

	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/"/g, '\\"')}"`;
}

function pad2(value: number) {
	return String(value).padStart(2, "0");
}

function toDate(value: Date | string | undefined) {
	if (value instanceof Date) return value;
	if (typeof value === "string") {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date();
}

function formatLocalExportedAt(value: Date | string | undefined) {
	const date = toDate(value);
	const offsetMinutes = -date.getTimezoneOffset();
	const offsetSign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetHours = Math.floor(absoluteOffset / 60);
	const offsetRemainderMinutes = absoluteOffset % 60;

	return [
		`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
		`${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
		`GMT${offsetSign}${pad2(offsetHours)}:${pad2(offsetRemainderMinutes)}`,
	].join(" ");
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

function maxBacktickRun(value: string) {
	return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function codeFenceFor(code: string) {
	return "`".repeat(Math.max(3, maxBacktickRun(code) + 1));
}

function normalizeLanguage(value: unknown) {
	const language = cleanString(value).split(/\s+/)[0];
	return language || "text";
}

function normalizeCodeSnippets(value: unknown): NormalizedCodeSnippet[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is NoteCodeSnippet => Boolean(item && typeof item === "object"))
		.map((item) => ({
			language: normalizeLanguage(item.language),
			description: cleanString(item.description),
			code: typeof item.code === "string" ? item.code : "",
		}))
		.filter((item) => item.code.length > 0);
}

function buildFrontmatter(input: {
	title: string;
	tags: string[];
	sourceType: string;
	exportedAt: string;
}) {
	const lines = ["---", `title: ${yamlScalar(input.title)}`];

	if (input.tags.length > 0) {
		lines.push("tags:");
		for (const tag of input.tags) {
			lines.push(`  - ${yamlScalar(tag)}`);
		}
	}

	if (input.sourceType) {
		lines.push(`source_type: ${yamlScalar(input.sourceType)}`);
	}

	lines.push(`exported_at: ${yamlScalar(input.exportedAt)}`, "---");
	return lines.join("\n");
}

export function createNoteMarkdownExport(
	note: NoteMarkdownExportInput,
	options: NoteMarkdownExportOptions = {},
): NoteMarkdownExport {
	const id = typeof note.id === "number" || typeof note.id === "string" ? String(note.id) : "note";
	const title = cleanString(note.title) || `Note ${id}`;
	const summary = cleanString(note.summary);
	const keyConclusions = cleanStringArray(note.key_conclusions);
	const codeSnippets = normalizeCodeSnippets(note.code_snippets);
	const tags = cleanStringArray(note.tags);
	const sourceType = cleanString(note.source_type);
	const exportedAt = formatLocalExportedAt(options.exportedAt);
	const labels = { ...DEFAULT_LABELS, ...options.labels };
	const slug = slugify(title);
	const filename = slug ? `${id}-${slug}.md` : `note-${id}.md`;

	const sections = [
		buildFrontmatter({ title, tags, sourceType, exportedAt }),
		`# ${title}`,
	];

	if (summary) {
		sections.push(`## ${labels.summary}\n\n${summary}`);
	}

	if (keyConclusions.length > 0) {
		sections.push(`## ${labels.keyConclusions}\n\n${keyConclusions.map((item) => `- ${item}`).join("\n")}`);
	}

	if (codeSnippets.length > 0) {
		const snippets = codeSnippets.map((snippet) => {
			const fence = codeFenceFor(snippet.code);
			const heading = snippet.description ? `### ${snippet.description}\n\n` : "";
			return `${heading}${fence}${snippet.language}\n${snippet.code}\n${fence}`;
		});
		sections.push(`## ${labels.codeSnippets}\n\n${snippets.join("\n\n")}`);
	}

	return {
		filename,
		content: `${sections.join("\n\n")}\n`,
	};
}

export function downloadMarkdownFile(exported: NoteMarkdownExport) {
	const blob = new Blob([exported.content], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = exported.filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
