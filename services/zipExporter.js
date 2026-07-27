import fs from "fs";
import path from "path";
import archiver from "archiver";

const MAX_INLINE_SIZE = 5 * 1024 * 1024;

function sanitizeId(id) {
	return id.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

export async function createDebugBundle(requests, outPath) {
	const dir = path.dirname(outPath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

	const output = fs.createWriteStream(outPath);
	const archive = archiver("zip", { zlib: { level: 6 } });

	await new Promise((resolve, reject) => {
		output.on("close", resolve);
		output.on("error", reject);
		archive.on("error", reject);
		archive.on("warning", (err) => {
			if (err.code !== "ENOENT") reject(err);
		});
		archive.pipe(output);

		const manifest = {
			exportedAt: new Date().toISOString(),
			requestCount: requests.length,
			requests: requests.map((r) => ({
				request_id: r.request_id,
				provider: r.provider,
				model: r.canonical_model_name || r.incoming_model_alias,
				status: r.response_status,
				hasError: !!r.error || (r.errors?.length ?? 0) > 0,
			})),
			warnings: [],
		};

		archive.append(JSON.stringify(manifest, null, 2), {
			name: "manifest.json",
		});

		for (const req of requests) {
			const safeId = sanitizeId(req.request_id);
			const base = `requests/${safeId}`;

			// Self-contained per-request record: everything except the raw
			// payloads, which live in raw/<id>_request.json / _response.json.
			const { raw_request, raw_response, ...rest } = req;
			archive.append(JSON.stringify(rest, null, 2), { name: `${base}.json` });

			const rawReqSize = req.raw_request?.length || 0;
			const rawRespSize = req.raw_response?.length || 0;

			if (rawReqSize > 0 && rawReqSize < MAX_INLINE_SIZE) {
				archive.append(req.raw_request, { name: `raw/${safeId}_request.json` });
			} else if (rawReqSize > 0) {
				manifest.warnings.push(
					`${req.request_id}: request payload too large (${rawReqSize} bytes)`,
				);
			}

			if (rawRespSize > 0 && rawRespSize < MAX_INLINE_SIZE) {
				archive.append(req.raw_response, {
					name: `raw/${safeId}_response.json`,
				});
			} else if (rawRespSize > 0) {
				manifest.warnings.push(
					`${req.request_id}: response payload too large (${rawRespSize} bytes)`,
				);
			}

			if (req.errors?.length) {
				archive.append(JSON.stringify(req.errors, null, 2), {
					name: `errors/${safeId}_error.json`,
				});
			} else if (req.error) {
				archive.append(JSON.stringify(req.error, null, 2), {
					name: `errors/${safeId}_error.json`,
				});
			}
		}

		const reportHtml = generateReportHtml(requests);
		archive.append(reportHtml, { name: "report.html" });

		archive.finalize();
	});

	const stats = fs.statSync(outPath);
	return {
		filePath: outPath,
		fileSize: stats.size,
		requestCount: requests.length,
	};
}

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function generateReportHtml(requests) {
	const providerCounts = {};
	const errorCount = requests.filter((r) => r.error).length;
	for (const r of requests) {
		providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1;
	}

	let providerRows = "";
	for (const [p, c] of Object.entries(providerCounts)) {
		providerRows += `<tr><td>${escapeHtml(p)}</td><td>${c}</td></tr>`;
	}

	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debug Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style>
</head><body>
<h1>Plexus Debug Report</h1>
<p>Generated: ${escapeHtml(new Date().toISOString())}</p>
<p>Total requests: ${requests.length}</p>
<p>Errors: ${errorCount}</p>
<h2>Provider Breakdown</h2>
<table><tr><th>Provider</th><th>Count</th></tr>${providerRows}</table>
</body></html>`;
}
