import { Router } from "express";
import path from "path";
import fs from "fs";
import { queryApp } from "../db/app.js";
import { plexusApi } from "../services/plexusApi.js";
import { createProviderReportBundle } from "../services/zipExporter.js";
import {
	analyzeResponse,
	buildReportDoc,
	rawFilesForRequest,
	formatReportFilename,
	resolveRequestIds,
	TooManyMatchesError,
	MAX_REPORT_REQUESTS,
	MAX_NOTES_CHARS,
} from "../services/providerReport.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";

const DEFAULT_USER = "admin";
const router = Router();
router.use(requireAuth);

// One request's evidence: usage metadata + debug payload, each best-effort.
// (listUsage by requestId is the only way to resolve a single usage row — the
// management API has no single-usage endpoint.)
async function assemble(requestId) {
	const [usage, debug] = await Promise.all([
		plexusApi
			.listUsage({ requestId, limit: "1" })
			.then((r) => r.data?.[0] || null)
			.catch(() => null),
		plexusApi.getDebugLog(requestId).catch(() => null),
	]);
	return {
		request_id: requestId,
		usage,
		debug,
		analysis: analyzeResponse(debug),
		resolved: !!usage || !!debug,
	};
}

router.post(
	"/",
	asyncHandler(async (req, res) => {
		const { requestIds, filters, notes = "" } = req.body || {};
		let ids = requestIds;
		if (filters && typeof filters === "object" && !Array.isArray(filters)) {
			// Criteria-driven report: resolve the matching request ids first.
			try {
				ids = await resolveRequestIds(filters, { listUsage: (f) => plexusApi.listUsage(f) });
			} catch (err) {
				if (err instanceof TooManyMatchesError) return res.status(400).json({ error: err.message });
				return res.status(400).json({ error: err.message });
			}
		}
		if (!Array.isArray(ids) || ids.length === 0) {
			return res.status(400).json({ error: "No requests match these criteria" });
		}
		if (ids.length > MAX_REPORT_REQUESTS) {
			return res.status(400).json({ error: `Maximum ${MAX_REPORT_REQUESTS} requests per report` });
		}
		if (typeof notes !== "string" || notes.length > MAX_NOTES_CHARS) {
			return res.status(400).json({ error: `Notes must be under ${MAX_NOTES_CHARS} characters` });
		}

		const assembled = await Promise.all(ids.map(assemble));
		const usable = assembled.filter((r) => r.resolved);
		if (usable.length === 0) {
			return res.status(400).json({ error: "No matching requests (no usage or debug found)" });
		}

		const reportMd = buildReportDoc(usable, notes);
		const rawFiles = Object.assign({}, ...usable.map(rawFilesForRequest));
		const provider = usable.map((r) => r.usage?.provider).find(Boolean) || null;

		const fileName = formatReportFilename(provider);
		const outPath = path.join(config.exportsDir, fileName);
		const bundle = await createProviderReportBundle({ reportMd, rawFiles }, outPath);

		const [row] = await queryApp(
			`INSERT INTO provider_reports (provider, notes, request_ids, file_path, file_size, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			[provider, notes, usable.map((r) => r.request_id), outPath, bundle.fileSize, DEFAULT_USER],
		);

		res.status(201).json({
			reportId: row.id,
			downloadUrl: `/api/reports/${row.id}`,
			fileSize: bundle.fileSize,
		});
	}),
);

// Live criteria match-count preview for the Reports form (never generates files).
router.get(
	"/preview",
	asyncHandler(async (req, res) => {
		const filters = { ...req.query };
		try {
			const preview = await resolveRequestIds(filters, {
				listUsage: (f) => plexusApi.listUsage(f),
				countOnly: true,
			});
			res.json(preview);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	}),
);

router.get(
	"/:id",
	asyncHandler(async (req, res) => {
		const [record] = await queryApp(`SELECT file_path FROM provider_reports WHERE id = $1`, [
			req.params.id,
		]);
		if (!record || !fs.existsSync(record.file_path)) {
			return res.status(404).json({ error: "Report not found" });
		}
		const resolved = path.resolve(record.file_path);
		if (!resolved.startsWith(path.resolve(config.exportsDir))) {
			return res.status(403).json({ error: "Invalid file path" });
		}
		res.download(resolved);
	}),
);

router.get(
	"/",
	asyncHandler(async (_req, res) => {
		const rows = await queryApp(
			`SELECT id, provider, notes, request_ids, file_size, created_at
       FROM provider_reports ORDER BY created_at DESC LIMIT 50`,
		);
		res.json({ data: rows });
	}),
);

export default router;
