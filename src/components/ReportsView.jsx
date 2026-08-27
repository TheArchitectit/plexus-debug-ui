import { useState, useEffect, useMemo } from "react";
import { reportsApi, filtersApi, downloadReport } from "../lib/api.js";
import {
	MAX_REPORT_REQUESTS,
	MAX_NOTES_CHARS,
} from "../../services/providerReport.js";

const EMPTY = {
	provider: "",
	model: "",
	apiKey: "",
	status: "",
	finishReason: "",
	hasError: "",
	hasRetry: "",
	dateFrom: "",
	dateTo: "",
};

function formatBytes(b) {
	return b ? `${(b / 1024).toFixed(1)} KB` : "-";
}

const NOTES_TIP =
	"Shown as the Summary section at the top of report.md — what went wrong and what you want the provider to check. Plain markdown, up to " +
	MAX_NOTES_CHARS +
	" characters.";

export default function ReportsView() {
	const [criteria, setCriteria] = useState(EMPTY);
	const [notes, setNotes] = useState("");
	const [rows, setRows] = useState([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [preview, setPreview] = useState(null);
	const [options, setOptions] = useState({
		providers: [],
		models: [],
		apiKeys: [],
		finishReasons: [],
	});

	const active = useMemo(
		() => Object.fromEntries(Object.entries(criteria).filter(([, v]) => v !== "")),
		[criteria],
	);
	const hasCriteria = Object.keys(active).length > 0;

	useEffect(() => {
		let ignore = false;
		reportsApi.history().then((r) => {
			if (!ignore) setRows(r.data || []);
		}).catch(() => {});
		filtersApi.list().then((o) => {
			if (!ignore) setOptions(o);
		}).catch(() => {});
		return () => {
			ignore = true;
		};
	}, []);

	// Debounced live match-count preview as the user tunes criteria.
	useEffect(() => {
		if (!hasCriteria) {
			setPreview(null);
			return;
		}
		let ignore = false;
		const t = setTimeout(() => {
			reportsApi.preview(active).then((p) => {
				if (!ignore) setPreview(p);
			}).catch(() => {
				if (!ignore) setPreview(null);
			});
		}, 350);
		return () => {
			ignore = true;
			clearTimeout(t);
		};
	}, [active, hasCriteria]);

	const overLimit = !!preview?.overLimit;
	const canCreate = hasCriteria && !overLimit && !busy;

	function set(key, value) {
		setCriteria((c) => ({ ...c, [key]: value }));
	}

	async function create() {
		if (!canCreate) return;
		setBusy(true);
		setError(null);
		try {
			const res = await reportsApi.create({ filters: active, notes });
			await downloadReport(res.reportId);
			const list = await reportsApi.history();
			setRows(list.data || []);
			setNotes("");
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-4">
			<div className="bg-white rounded-lg shadow p-4">
				<h2 className="text-lg font-bold mb-1">Create Provider Report</h2>
				<p className="text-sm text-slate-600 mb-3">
					Set filter criteria below — every matching request (max{" "}
					{MAX_REPORT_REQUESTS}) is bundled into an evidence ZIP with
					reassembled outputs and byte-exact raw streams.
				</p>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-provider">Provider</label>
						<select id="rp-provider" className="border rounded px-2 py-1 w-full"
							value={criteria.provider} onChange={(e) => set("provider", e.target.value)}>
							<option value="">Any provider</option>
							{options.providers.map((o) => <option key={o} value={o}>{o}</option>)}
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-model">Model</label>
						<select id="rp-model" className="border rounded px-2 py-1 w-full"
							value={criteria.model} onChange={(e) => set("model", e.target.value)}>
							<option value="">Any model</option>
							{options.models.map((o) => <option key={o} value={o}>{o}</option>)}
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-apikey">API Key</label>
						<select id="rp-apikey" className="border rounded px-2 py-1 w-full"
							value={criteria.apiKey} onChange={(e) => set("apiKey", e.target.value)}>
							<option value="">Any API key</option>
							{options.apiKeys.map((o) => <option key={o} value={o}>{o}</option>)}
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-status">Status</label>
						<select id="rp-status" className="border rounded px-2 py-1 w-full"
							value={criteria.status} onChange={(e) => set("status", e.target.value)}>
							<option value="">All statuses</option>
							<option value="success">Success</option>
							<option value="error">Error</option>
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-finish">Finish Reason</label>
						<select id="rp-finish" className="border rounded px-2 py-1 w-full"
							value={criteria.finishReason} onChange={(e) => set("finishReason", e.target.value)}>
							<option value="">Any finish reason</option>
							{options.finishReasons.map((o) => <option key={o} value={o}>{o}</option>)}
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-error">Errors</label>
						<select id="rp-error" className="border rounded px-2 py-1 w-full"
							value={criteria.hasError} onChange={(e) => set("hasError", e.target.value)}>
							<option value="">All</option>
							<option value="true">Has error</option>
							<option value="false">No error</option>
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-retry">Retries</label>
						<select id="rp-retry" className="border rounded px-2 py-1 w-full"
							value={criteria.hasRetry} onChange={(e) => set("hasRetry", e.target.value)}>
							<option value="">Any retries</option>
							<option value="true">Retried</option>
							<option value="false">No retry</option>
						</select>
					</div>
					<div>
						<label className="block text-xs font-medium mb-1" htmlFor="rp-dates">Date range</label>
						<div className="flex gap-2" id="rp-dates">
							<input type="date" aria-label="Date from" className="border rounded px-2 py-1 flex-1"
								value={criteria.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} />
							<input type="date" aria-label="Date to" className="border rounded px-2 py-1 flex-1"
								value={criteria.dateTo} onChange={(e) => set("dateTo", e.target.value)} />
						</div>
					</div>
				</div>

				<div className="text-sm mb-3 min-h-[1.25rem]" aria-live="polite">
					{!hasCriteria && (
						<span className="text-slate-500">Set at least one criterion to preview matches.</span>
					)}
					{hasCriteria && preview && !overLimit && (
						<span className="text-emerald-700">
							{preview.count} matching request{preview.count === 1 ? "" : "s"} — all will be included.
						</span>
					)}
					{overLimit && (
						<span className="text-red-600">
							{preview.count} matching requests — too many (max {MAX_REPORT_REQUESTS}). Narrow the criteria or split into several reports.
						</span>
					)}
				</div>

				<label className="block text-sm font-medium mb-1" htmlFor="report-notes">
					Summary notes
				</label>
				<textarea
					id="report-notes"
					rows={4}
					title={NOTES_TIP}
					maxLength={MAX_NOTES_CHARS}
					className="border rounded px-2 py-1 w-full"
					placeholder="Describe the problem for the provider…"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
				/>
				<div className="text-xs text-slate-500 mt-1">
					{notes.length} / {MAX_NOTES_CHARS}
				</div>

				{error && (
					<div role="alert" className="bg-red-100 text-red-800 p-2 rounded text-sm my-2">
						{error}
					</div>
				)}

				<div className="mt-3 flex gap-2">
					<button
						className="bg-indigo-700 text-white px-4 py-1.5 rounded text-sm hover:bg-indigo-800 disabled:opacity-50"
						disabled={!canCreate}
						onClick={create}
						title={
							overLimit
								? `At most ${MAX_REPORT_REQUESTS} requests per report — narrow the criteria`
								: "Build evidence ZIP from all matching requests"
						}
					>
						{busy ? "Creating…" : "Create Report"}
					</button>
					<button
						className="border border-slate-300 px-3 py-1 rounded text-sm hover:bg-slate-50"
						onClick={() => setCriteria(EMPTY)}
					>
						Reset criteria
					</button>
				</div>
			</div>

			<div className="bg-white rounded-lg shadow p-4">
				<h2 className="text-lg font-bold mb-3">Report History</h2>
				{rows.length === 0 && <div className="text-slate-500">No reports yet.</div>}
				<table className="w-full text-sm">
					<thead className="bg-slate-100">
						<tr>
							<th className="px-3 py-2 text-left">Provider</th>
							<th className="px-3 py-2 text-left">Requests</th>
							<th className="px-3 py-2 text-left">Size</th>
							<th className="px-3 py-2 text-left">Created</th>
							<th className="px-3 py-2 text-left">Action</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="border-t">
								<td className="px-3 py-2">{row.provider || "mixed"}</td>
								<td className="px-3 py-2">{row.request_ids?.length || 0}</td>
								<td className="px-3 py-2">{formatBytes(row.file_size)}</td>
								<td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
								<td className="px-3 py-2">
									<button
										className="text-blue-600 hover:underline"
										onClick={() => downloadReport(row.id)}
									>
										Download
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
