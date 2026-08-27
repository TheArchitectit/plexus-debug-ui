import { useState, useMemo } from "react";
import RetryChain from "./RetryChainPanel.jsx";
import { modelDisplay } from "../lib/modelDisplay.js";
import { useDebug } from "../hooks/useDebug.js";
import { useAnnotations } from "../hooks/useAnnotations.js";
import { useExport } from "../hooks/useExport.js";

const TABS = [
	"Summary",
	"Retries",
	"Tool Calls",
	"Raw Request",
	"Raw Response",
	"Errors",
	"Annotations",
];

function safeJsonPrettify(str) {
	if (!str) return "{}";
	if (typeof str !== "string") return JSON.stringify(str, null, 2);
	try {
		return JSON.stringify(JSON.parse(str), null, 2);
	} catch {
		return str;
	}
}

function SearchablePre({ content }) {
	const [search, setSearch] = useState("");
	const lines = content.split("\n");
	const term = search.toLowerCase().trim();

	const filtered = useMemo(() => {
		if (!term) return lines;
		return lines.filter((line) => line.toLowerCase().includes(term));
	}, [lines, term]);

	const matchCount = term ? filtered.length : 0;

	return (
		<div className="flex flex-col h-full">
			<div className="flex gap-2 mb-2 shrink-0">
				<input
					className="border rounded px-2 py-1 text-sm flex-1"
					placeholder="Search in payload..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				{term && (
					<span className="text-xs text-slate-500 self-center">
						{matchCount} lines match
					</span>
				)}
			</div>
			<pre className="text-xs bg-slate-50 p-3 rounded overflow-auto flex-1 min-h-0">
				{filtered.join("\n")}
			</pre>
		</div>
	);
}

function ToolCallCard({ tc }) {
	const isRetry = tc.is_retry;
	const borderClass = isRetry
		? tc.error != null
			? "border-amber-400"
			: "border-blue-300"
		: "border-slate-200";
	const headerBg = isRetry
		? tc.error != null
			? "bg-amber-50"
			: "bg-blue-50"
		: "bg-slate-100";

	return (
		<div className={`border ${borderClass} rounded-lg overflow-hidden`}>
			<div
				className={`${headerBg} px-4 py-2 flex items-center gap-3 flex-wrap`}
			>
				<span className="font-mono font-semibold text-sm">{tc.tool_name}</span>
				{tc.id && (
					<span className="text-xs text-slate-500 font-mono">{tc.id}</span>
				)}
				{tc.retry_count > 1 && (
					<span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">
						Attempt {tc.attempt} of {tc.retry_count}
					</span>
				)}
				{isRetry && (
					<span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-200 text-amber-800">
						↻ Retry
					</span>
				)}
			</div>
			<div className="p-4 space-y-3">
				<div>
					<h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
						Arguments
					</h4>
					<pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-48">
						{typeof tc.arguments === "string"
							? tc.arguments
							: JSON.stringify(tc.arguments, null, 2)}
					</pre>
				</div>
				{tc.result != null && (
					<div>
						<h4 className="text-xs font-semibold text-green-700 uppercase mb-1">
							Result
						</h4>
						<pre className="text-xs bg-green-50 p-3 rounded overflow-auto max-h-48">
							{typeof tc.result === "string"
								? tc.result
								: JSON.stringify(tc.result, null, 2)}
						</pre>
					</div>
				)}
				{tc.error != null && (
					<div>
						<h4 className="text-xs font-semibold text-red-700 uppercase mb-1">
							Error
						</h4>
						<pre className="text-xs bg-red-50 p-3 rounded overflow-auto max-h-48">
							{typeof tc.error === "string"
								? tc.error
								: JSON.stringify(tc.error, null, 2)}
						</pre>
					</div>
				)}
				{tc.result == null && tc.error == null && (
					<p className="text-xs text-slate-400 italic">
						No result or error recorded.
					</p>
				)}
			</div>
		</div>
	);
}

function RetryGroup({ groupName, calls }) {
	const [expanded, setExpanded] = useState(true);
	const hasRetries = calls.length > 1;
	const anySuccess = calls.some((tc) => tc.result != null && tc.error == null);
	const allFailed = calls.every((tc) => tc.error != null);

	// Status indicator for the whole group
	const statusBadge = hasRetries ? (
		anySuccess ? (
			<span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-200 text-green-800">
				✓ Success
			</span>
		) : allFailed ? (
			<span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-200 text-red-800">
				✗ All failed
			</span>
		) : (
			<span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-200 text-amber-800">
				⚠ Partial
			</span>
		)
	) : null;

	if (!hasRetries) {
		return <ToolCallCard tc={calls[0]} index={0} />;
	}

	return (
		<div className="border border-slate-300 rounded-lg overflow-hidden">
			<button
				className="w-full bg-slate-100 px-4 py-2 flex items-center gap-3 text-left hover:bg-slate-200"
				onClick={() => setExpanded(!expanded)}
			>
				<span className="text-xs text-slate-500">{expanded ? "▼" : "▶"}</span>
				<span className="font-mono font-semibold text-sm">{groupName}</span>
				<span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">
					{calls.length} attempts
				</span>
				{statusBadge}
			</button>
			{expanded && (
				<div className="p-4 space-y-3">
					{/* Timeline connector */}
					<div className="space-y-3">
						{calls.map((tc, i) => (
							<div key={tc.id || i} className="relative">
								{/* Timeline dot and line */}
								<div
									className={`absolute w-3 h-3 rounded-full border-2 z-10 ${
										tc.is_retry
											? tc.error != null
												? "border-amber-500 bg-amber-100"
												: "border-blue-400 bg-blue-100"
											: "border-slate-400 bg-slate-100"
									}`}
									style={{ left: "-8px", top: "16px" }}
								/>
								{i < calls.length - 1 && (
									<div
										className="absolute left-0 top-7 bottom-0 w-0.5 bg-slate-300"
										style={{ left: "-3px", height: "calc(100% + 12px)" }}
									/>
								)}
								<div className="ml-4">
									<ToolCallCard tc={tc} index={i} />
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function ToolCallsPanel({ toolCalls }) {
	if (!toolCalls || toolCalls.length === 0) {
		return <p className="text-slate-500">No tool calls found.</p>;
	}

	// Group calls by tool_name, preserving first-occurrence order
	const groups = [];
	const groupMap = new Map();
	for (const tc of toolCalls) {
		const name = tc.tool_name;
		if (!groupMap.has(name)) {
			const group = [];
			groupMap.set(name, group);
			groups.push({ name, calls: group });
		}
		groupMap.get(name).push(tc);
	}

	// If no retries exist, render flat list
	const hasAnyRetry = toolCalls.some((tc) => tc.is_retry);
	if (!hasAnyRetry) {
		return (
			<div className="space-y-4">
				{toolCalls.map((tc, i) => (
					<ToolCallCard key={tc.id || i} tc={tc} index={i} />
				))}
			</div>
		);
	}

	// Render grouped with retry chains
	return (
		<div className="space-y-4">
			{groups.map(({ name, calls }) => (
				<RetryGroup key={name} groupName={name} calls={calls} />
			))}
		</div>
	);
}

export default function DetailDrawer({ requestId, usage, onClose }) {
	const [tab, setTab] = useState("Summary");
	const { data, loading } = useDebug(requestId);
	const { annotations, add, remove } = useAnnotations(requestId);
	const { loading: exporting, create, download } = useExport();
	const [exportError, setExportError] = useState(null);
	const [tagInput, setTagInput] = useState("");
	const [noteInput, setNoteInput] = useState("");

	const onExportThis = async () => {
		setExportError(null);
		try {
			const res = await create([requestId], `Request ${requestId.slice(0, 8)}`);
			download(res.exportId);
		} catch (err) {
			setExportError(err.message);
		}
	};

	// Summary/Retries come from the usage row passed by the table; the detail
	// route may also return a usage object if a future API adds one.
	const u = data?.usage || usage;
	const rawReq = safeJsonPrettify(data?.debug?.raw_request);
	const rawRes = safeJsonPrettify(data?.debug?.raw_response);
	const toolCalls = data?.toolCalls || [];

	return (
		<div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
			<div
				className="bg-white flex flex-col h-full w-full"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
					<h2 className="font-bold font-mono text-sm truncate mr-4">
						{requestId}
					</h2>
					<button
						className="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 disabled:opacity-50 mr-3"
						disabled={exporting}
						onClick={onExportThis}
						title="Download a debug bundle (zip) for this request only"
					>
						{exporting ? "Exporting..." : "Export"}
					</button>
					{exportError && (
						<span className="text-red-600 text-xs mr-3">{exportError}</span>
					)}
					<button
						className="text-slate-500 hover:text-slate-900 text-xl leading-none"
						onClick={onClose}
					>
						✕
					</button>
				</div>

				{/* Tab bar */}
				<div className="flex border-b overflow-x-auto shrink-0">
					{TABS.map((t) => (
						<button
							key={t}
							className={`px-4 py-2 text-sm whitespace-nowrap shrink-0 ${tab === t ? "border-b-2 border-slate-900 font-semibold" : "text-slate-500"}`}
							onClick={() => setTab(t)}
						>
							{t}
						</button>
					))}
				</div>

				{/* Content area */}
				<div className="flex-1 overflow-auto p-6 min-h-0">
					{loading && <div className="text-slate-500">Loading...</div>}
					{!loading && tab === "Summary" && u && (
						<div className="space-y-2 text-sm">
							<p>
								<strong>Provider:</strong> {u.provider}
							</p>
							<p>
								<strong>Requested:</strong> {u.incoming_model_alias || u.canonical_model_name}
							</p>
							<p>
								<strong>Target:</strong> {u.canonical_model_name}
							</p>
							<p>
								<strong>Served by:</strong>{" "}
								{u.final_attempt_provider ? `${u.final_attempt_provider} / ` : ""}
								{modelDisplay(u).served}
							</p>
							<p>
								<strong>Status:</strong> {u.response_status}
							</p>
							<p>
								<strong>Input tokens:</strong> {u.tokens_input}
							</p>
							<p>
								<strong>Output tokens:</strong> {u.tokens_output}
							</p>
							<p>
								<strong>Duration:</strong> {u.duration_ms}ms
							</p>
							<p>
								<strong>Attempt count:</strong> {u.attempt_count}
							</p>
							<p>
								<strong>Finish reason:</strong> {u.finish_reason}
							</p>
							<p>
								<strong>Tools defined:</strong> {u.tools_defined}
							</p>
							<p>
								<strong>Tool calls:</strong> {u.tool_calls_count}
							</p>
							<p>
								<strong>Message count:</strong> {u.message_count}
							</p>
						</div>
					)}
					{!loading && tab === "Retries" && u && (
						<RetryChain
							retryHistory={u.retry_history}
							attemptCount={u.attempt_count}
							finalProvider={u.final_attempt_provider}
							finalModel={u.final_attempt_model}
							allProviders={u.all_attempted_providers}
						/>
					)}
					{!loading && tab === "Tool Calls" && (
						<ToolCallsPanel toolCalls={toolCalls} />
					)}
					{!loading && tab === "Raw Request" && (
						<SearchablePre content={rawReq} />
					)}
					{!loading && tab === "Raw Response" && (
						<SearchablePre content={rawRes} />
					)}
					{!loading && tab === "Errors" && (
						<div className="space-y-3">
							{data?.errors?.length === 0 && (
								<p className="text-slate-500">No errors recorded.</p>
							)}
							{data?.errors?.map((e, i) => (
								<div key={i} className="bg-red-50 p-3 rounded text-sm">
									<p className="font-semibold text-red-800">
										{e.error_message}
									</p>
									<pre className="text-xs mt-2 overflow-auto">
										{e.error_stack}
									</pre>
								</div>
							))}
						</div>
					)}
					{!loading && tab === "Annotations" && (
						<div>
							<div className="flex gap-2 mb-3">
								<input
									className="border rounded px-2 py-1 text-sm flex-1"
									placeholder="Tag"
									value={tagInput}
									onChange={(e) => setTagInput(e.target.value)}
								/>
								<input
									className="border rounded px-2 py-1 text-sm flex-[2]"
									placeholder="Note"
									value={noteInput}
									onChange={(e) => setNoteInput(e.target.value)}
								/>
								<button
									className="bg-slate-900 text-white px-3 py-1 rounded text-sm"
									onClick={() => {
										add(tagInput, noteInput);
										setTagInput("");
										setNoteInput("");
									}}
								>
									Add
								</button>
							</div>
							{annotations.map((a) => (
								<div
									key={a.id}
									className="flex justify-between items-start bg-slate-50 p-2 rounded mb-2 text-sm"
								>
									<div>
										{a.tag && (
											<span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs mr-2">
												{a.tag}
											</span>
										)}
										<span>{a.note}</span>
									</div>
									<button
										className="text-red-500 text-xs"
										onClick={() => remove(a.id)}
									>
										Delete
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
