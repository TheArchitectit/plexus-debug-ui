import React, { useState, useCallback, useMemo } from "react";
import FilterPanel from "./FilterPanel.jsx";
import RequestTable from "./RequestTable.jsx";
import DetailDrawer from "./DetailDrawer.jsx";
import ExportModal from "./ExportModal.jsx";
import { useRequests } from "../hooks/useRequests.js";
import { reportsApi, downloadReport } from "../lib/api.js";
import {
	MAX_REPORT_REQUESTS,
	MAX_NOTES_CHARS,
} from "../../services/providerReport.js";

export default function Dashboard() {
	const [filters, setFilters] = useState({});
	const [selected, setSelected] = useState(new Set());
	const [detailRow, setDetailRow] = useState(null);
	const [showExport, setShowExport] = useState(false);
	const [showReport, setShowReport] = useState(false);
	const [reportNotes, setReportNotes] = useState("");
	const [reportBusy, setReportBusy] = useState(false);
	const [reportError, setReportError] = useState(null);

	const { rows, loading, error, loadMore, hasMore } = useRequests(filters);

	const filteredRows = useMemo(() => {
		const term = (filters.search || "").toLowerCase().trim();
		if (!term) return rows;
		return rows.filter(
			(r) =>
				(r.request_id || "").toLowerCase().includes(term) ||
				(r.provider || "").toLowerCase().includes(term) ||
				(r.canonical_model_name || "").toLowerCase().includes(term) ||
				(r.incoming_model_alias || "").toLowerCase().includes(term) ||
				(r.api_key || "").toLowerCase().includes(term) ||
				(r.finish_reason || "").toLowerCase().includes(term),
		);
	}, [rows, filters.search]);

	const selectedRows = filteredRows.filter((r) => selected.has(r.request_id));

	const onSelect = useCallback((id, checked) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	const onSelectAll = useCallback(
		(checked) => {
			setSelected(
				checked ? new Set(filteredRows.map((r) => r.request_id)) : new Set(),
			);
		},
		[filteredRows],
	);

	const overCap = selected.size > MAX_REPORT_REQUESTS;

	async function createReport() {
		if (overCap) return;
		setReportBusy(true);
		setReportError(null);
		try {
			const res = await reportsApi.create(Array.from(selected), reportNotes);
			await downloadReport(res.reportId);
			setShowReport(false);
			setReportNotes("");
		} catch (err) {
			setReportError(err.message);
		} finally {
			setReportBusy(false);
		}
	}

	return (
		<div>
			<FilterPanel onFilter={setFilters} />
			{error && (
				<div role="alert" className="bg-red-100 text-red-800 p-3 rounded mb-4">
					{error}
				</div>
			)}
			<div className="flex justify-between items-center mb-2">
				<span className="text-sm text-slate-600">
					{filteredRows.length} requests shown
					{filters.search && ` (filtered from ${rows.length})`}
				</span>
				<div className="flex gap-2">
					<button
						className="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 disabled:opacity-50"
						disabled={selected.size === 0}
						onClick={() => setShowExport(true)}
					>
						Export {selected.size} selected
					</button>
					<button
						className="bg-indigo-700 text-white px-3 py-1 rounded text-sm hover:bg-indigo-800 disabled:opacity-50"
						disabled={selected.size === 0 || overCap}
						onClick={() => {
							setShowReport(true);
							setReportError(null);
						}}
						title={
							overCap
								? `Select at most ${MAX_REPORT_REQUESTS} requests`
								: `Build a provider evidence report from ${selected.size} selected request(s)`
						}
					>
						Provider report ({selected.size})
					</button>
					{filteredRows.length > 0 && selected.size !== filteredRows.length && (
						<button
							className="border border-slate-300 px-3 py-1 rounded text-sm hover:bg-slate-50"
							onClick={() => {
								setSelected(new Set(filteredRows.map((r) => r.request_id)));
								setShowExport(true);
							}}
						>
							Export all {filteredRows.length}
						</button>
					)}
					{hasMore && (
						<button
							className="border border-slate-300 px-3 py-1 rounded text-sm hover:bg-slate-50"
							onClick={loadMore}
						>
							Load more
						</button>
					)}
				</div>
			</div>
			<RequestTable
				rows={filteredRows}
				selected={selected}
				onSelect={onSelect}
				onSelectAll={onSelectAll}
				onRowClick={setDetailRow}
			/>
			{loading && (
				<div className="text-center py-4 text-slate-500">Loading...</div>
			)}
			{detailRow && (
				<DetailDrawer
					requestId={detailRow.request_id}
					usage={detailRow}
					onClose={() => setDetailRow(null)}
				/>
			)}
			{showExport && (
				<ExportModal
					requestIds={Array.from(selected)}
					onClose={() => setShowExport(false)}
				/>
			)}
			{showReport && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
					<div className="bg-white rounded-lg shadow p-4 w-[520px] max-w-[92vw]">
						<h3 className="font-bold mb-2">
							Provider report — {selected.size} request(s)
						</h3>
						<label
							className="block text-sm font-medium mb-1"
							htmlFor="dash-report-notes"
						>
							Summary notes
						</label>
						<textarea
							id="dash-report-notes"
							rows={5}
							maxLength={MAX_NOTES_CHARS}
							className="border rounded px-2 py-1 w-full"
							placeholder="What went wrong; what you want the provider to check."
							value={reportNotes}
							onChange={(e) => setReportNotes(e.target.value)}
						/>
						<div className="text-xs text-slate-500 mt-1">
							{reportNotes.length} / {MAX_NOTES_CHARS}
						</div>
						{reportError && (
							<div
								role="alert"
								className="bg-red-100 text-red-800 p-2 rounded text-sm mt-2"
							>
								{reportError}
							</div>
						)}
						<div className="flex justify-end gap-2 mt-3">
							<button
								className="px-3 py-1 rounded border text-sm"
								onClick={() => setShowReport(false)}
							>
								Cancel
							</button>
							<button
								className="bg-indigo-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
								disabled={reportBusy || selected.size === 0 || overCap}
								onClick={createReport}
							>
								{reportBusy ? "Creating…" : "Create & Download"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
