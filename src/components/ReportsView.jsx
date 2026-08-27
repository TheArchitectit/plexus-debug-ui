import { useState, useEffect, useMemo } from "react";
import { reportsApi, downloadReport } from "../lib/api.js";
import {
	MAX_REPORT_REQUESTS,
	MAX_NOTES_CHARS,
} from "../../services/providerReport.js";

function parseIds(text) {
	return text
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function formatBytes(b) {
	return b ? `${(b / 1024).toFixed(1)} KB` : "-";
}

const IDS_TIP =
	"One request ID per line (or comma-separated). Up to " +
	MAX_REPORT_REQUESTS +
	" requests per report — split larger incidents. Each request adds its full raw SSE stream to the ZIP.";
const NOTES_TIP =
	"Shown as the Summary section at the top of report.md — what went wrong and what you want the provider to check. Plain markdown, up to " +
	MAX_NOTES_CHARS +
	" characters.";

export default function ReportsView() {
	const [idsText, setIdsText] = useState("");
	const [notes, setNotes] = useState("");
	const [rows, setRows] = useState([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		let ignore = false;
		reportsApi
			.history()
			.then((r) => {
				if (!ignore) setRows(r.data || []);
			})
			.catch(() => {});
		return () => {
			ignore = true;
		};
	}, []);

	const ids = useMemo(() => parseIds(idsText), [idsText]);
	const tooMany = ids.length > MAX_REPORT_REQUESTS;
	const canCreate = ids.length > 0 && !tooMany && !busy;

	async function create() {
		if (!canCreate) return;
		setBusy(true);
		setError(null);
		try {
			const res = await reportsApi.create(ids, notes);
			await downloadReport(res.reportId);
			const list = await reportsApi.history();
			setRows(list.data || []);
			setIdsText("");
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
				<h2 className="text-lg font-bold mb-3">Create Provider Report</h2>
				<label className="block text-sm font-medium mb-1" htmlFor="report-ids">
					Request IDs
				</label>
				<textarea
					id="report-ids"
					rows={5}
					title={IDS_TIP}
					className="border rounded px-2 py-1 w-full font-mono text-xs"
					placeholder={"e9e55488-...\n6024fec2-..."}
					value={idsText}
					onChange={(e) => setIdsText(e.target.value)}
				/>
				<div className="text-xs text-slate-500 mb-2">
					{ids.length} request(s)
					{tooMany && (
						<span className="text-red-600">
							{" "}
							· at most {MAX_REPORT_REQUESTS} allowed — remove some or split
							into another report
						</span>
					)}
				</div>

				<label
					className="block text-sm font-medium mb-1"
					htmlFor="report-notes"
				>
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
					<div
						role="alert"
						className="bg-red-100 text-red-800 p-2 rounded text-sm my-2"
					>
						{error}
					</div>
				)}

				<div className="mt-3 flex gap-2">
					<button
						className="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 disabled:opacity-50"
						disabled={!canCreate}
						onClick={create}
						title={
							tooMany
								? `At most ${MAX_REPORT_REQUESTS} requests`
								: "Build evidence ZIP"
						}
					>
						{busy ? "Creating…" : "Create Report"}
					</button>
				</div>
			</div>

			<div className="bg-white rounded-lg shadow p-4">
				<h2 className="text-lg font-bold mb-3">Report History</h2>
				{rows.length === 0 && (
					<div className="text-slate-500">No reports yet.</div>
				)}
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
								<td className="px-3 py-2">
									{new Date(row.created_at).toLocaleString()}
								</td>
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
