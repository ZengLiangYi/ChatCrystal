import { Clock, FolderGit2, MessageSquare } from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConversations } from "@/hooks/use-conversations.ts";
import {
	getSourceColor,
	getSourceLabel,
	SOURCE_CONFIG,
} from "@/lib/source-colors.ts";

/** Text from an unknown API value; empty and legacy "null"/"undefined" count as absent. */
function readableText(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (!trimmed || trimmed === "null" || trimmed === "undefined") return "";
	return trimmed;
}

const SHORT_ID_LENGTH = 8;

function shortIdOf(value: unknown): string {
	const id = readableText(value);
	if (!id) return "";
	return id.length > SHORT_ID_LENGTH ? `${id.slice(0, SHORT_ID_LENGTH)}…` : id;
}

/**
 * The conversation's title in a list row. A "pending" (index-only) row may have
 * no slug yet; fall back to the project, the source name, then the id stub so
 * the cell is never blank.
 */
function conversationTitle(
	conv: Record<string, unknown>,
	t: TFunction,
): string {
	const slug = readableText(conv.slug);
	if (slug) return slug;
	const project = readableText(conv.project_name);
	if (project) return project;
	const source = readableText(conv.source);
	if (source) return getSourceLabel(source);
	const shortId = shortIdOf(conv.id);
	if (shortId) return shortId;
	return t("conversation.untitled");
}

/** The project (subtitle) of a list row, with the same no-blank rules. */
function conversationProject(
	conv: Record<string, unknown>,
	t: TFunction,
): string {
	const project = readableText(conv.project_name);
	if (project) return project;
	const source = readableText(conv.source);
	if (source) return getSourceLabel(source);
	return t("conversation.unknown_project");
}

/**
 * A conversation imported from its index may still be marked "pending" while
 * its transcript is parsed in the background. Old API responses have no
 * `transcript_status`; only an explicit "pending" shows the indexing badge.
 */
function isIndexing(conv: Record<string, unknown>): boolean {
	return conv.transcript_status === "pending";
}

export function Conversations() {
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const [sourceFilter, setSourceFilter] = useState("");
	const [page, setPage] = useState(0);
	const limit = 20;

	const { data, isLoading } = useConversations({
		search: search || undefined,
		source: sourceFilter || undefined,
		offset: page * limit,
		limit,
	});

	const navigate = useNavigate();

	return (
		<div className="p-6">
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-xl font-bold">{t('title.conversations')}</h2>
				<span className="text-sm text-muted">{t('conversations_total', { count: data?.total ?? 0 })}</span>
			</div>

			{/* Search */}
			<div className="mb-4">
				<input
					type="text"
					placeholder={t('placeholder.search_conversations')}
					value={search}
					onChange={(e) => {
						setSearch(e.target.value);
						setPage(0);
					}}
					className="w-full bg-secondary border border-theme px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-[var(--accent)]"
					style={{ borderRadius: "var(--radius)" }}
				/>
			</div>

			{/* Source filter */}
			<div className="flex flex-wrap items-center gap-2 mb-4">
				<span className="text-xs text-muted">{t('label.source')}</span>
				{[
					{ key: "", label: t('filter.all') },
					...Object.keys(SOURCE_CONFIG).map((key) => ({
						key,
						label: getSourceLabel(key),
					})),
				].map(({ key, label }) => (
					<button
						key={key}
						type="button"
						onClick={() => {
							setSourceFilter(key);
							setPage(0);
						}}
						className={`px-2.5 py-1 text-xs border transition-colors ${
							sourceFilter === key
								? "border-[var(--accent)] text-accent"
								: "border-theme text-muted hover:text-primary"
						}`}
						style={{ borderRadius: "var(--radius)" }}
					>
						{label}
					</button>
				))}
			</div>

			{/* Table */}
			{isLoading ? (
				<p className="text-muted text-sm">{t('status.loading')}</p>
			) : (
				<div
					className="border border-theme overflow-hidden"
					style={{ borderRadius: "var(--radius)" }}
				>
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-tertiary text-left text-xs text-muted uppercase tracking-wider">
								<th className="px-4 py-2">{t('table.conversation')}</th>
								<th className="px-4 py-2">{t('table.source')}</th>
								<th className="px-4 py-2">{t('table.conversation_id')}</th>
								<th className="px-4 py-2 text-center">{t('table.message_count')}</th>
								<th className="px-4 py-2">{t('table.last_active')}</th>
							</tr>
						</thead>
						<tbody>
							{data?.items.map((conv) => {
								const title = conversationTitle(conv, t);
								const project = conversationProject(conv, t);
								const indexing = isIndexing(conv);
								const idText = readableText(conv.id);
								return (
									<tr
										key={conv.id as string}
										onClick={() => navigate(`/conversations/${conv.id}`)}
										className="border-t border-theme hover:bg-tertiary cursor-pointer transition-colors"
									>
										<td className="px-4 py-3">
											<div className="flex min-w-0 items-center gap-1.5">
												<span className="max-w-56 truncate text-primary font-medium">
													{title}
												</span>
												{indexing && (
													<span
														className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted"
														title={t('conversation.indexing_hint')}
													>
														<span
															className="h-1.5 w-1.5 animate-pulse rounded-full"
															style={{ background: 'var(--accent)' }}
														/>
														{t('conversation.indexing')}
													</span>
												)}
											</div>
											{project !== title && (
												<div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
													<FolderGit2 size={11} className="shrink-0 text-info" />
													<span className="max-w-56 truncate">{project}</span>
												</div>
											)}
										</td>
										<td className="px-4 py-3">
											<SourceBadge source={readableText(conv.source)} />
										</td>
										<td className="px-4 py-3">
											<span className="text-secondary font-mono text-xs" title={idText}>
												{shortIdOf(conv.id) || '—'}
											</span>
										</td>
										<td className="px-4 py-3 text-center">
											<div className="flex items-center justify-center gap-1 text-muted">
												<MessageSquare size={12} />
												{conv.message_count as number}
											</div>
										</td>
										<td className="px-4 py-3">
											<div className="flex items-center gap-1 text-muted text-xs">
												<Clock size={12} />
												<FormatTime iso={conv.last_message_at as string} />
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{/* Pagination */}
			{data && data.total > limit && (
				<div className="flex items-center justify-center gap-4 mt-4">
					<button
						type="button"
						disabled={page === 0}
						onClick={() => setPage((p) => p - 1)}
						className="text-sm text-secondary hover:text-primary disabled:opacity-30"
					>
						{t('pagination.previous')}
					</button>
					<span className="text-xs text-muted">
						{page + 1} / {Math.ceil(data.total / limit)}
					</span>
					<button
						type="button"
						disabled={(page + 1) * limit >= data.total}
						onClick={() => setPage((p) => p + 1)}
						className="text-sm text-secondary hover:text-primary disabled:opacity-30"
					>
						{t('pagination.next')}
					</button>
				</div>
			)}
		</div>
	);
}

function SourceBadge({ source }: { source: string }) {
	const color = getSourceColor(source);
	return (
		<span
			className="inline-block text-[10px] font-medium px-1.5 py-0.5 border"
			style={{
				borderColor: color,
				color,
				borderRadius: "var(--radius)",
			}}
		>
			{source ? getSourceLabel(source) : "—"}
		</span>
	);
}

function FormatTime({ iso }: { iso: string }) {
	const { t } = useTranslation();
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return <>—</>;
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffMin = Math.floor(diffMs / 60000);

	if (diffMin < 1) return <>{t('time.just_now')}</>;
	if (diffMin < 60) return <>{t('time.minutes_ago', { count: diffMin })}</>;
	const diffH = Math.floor(diffMin / 60);
	if (diffH < 24) return <>{t('time.hours_ago', { count: diffH })}</>;
	const diffD = Math.floor(diffH / 24);
	if (diffD < 7) return <>{t('time.days_ago', { count: diffD })}</>;

	return <>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>;
}
