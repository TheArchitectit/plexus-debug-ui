import { Router } from "express";
import { plexusApi } from "../services/plexusApi.js";
import { extractToolCalls } from "../services/toolParser.js";
import { appPool } from "../db/app.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

router.get(
	"/:requestId",
	asyncHandler(async (req, res) => {
		const { requestId } = req.params;

		// Note: the Plexus management API has no single-usage endpoint — the
		// summary comes from the usage row the client already has.
		const [debug, errors] = await Promise.all([
			plexusApi.getDebugLog(requestId).catch((err) => {
				console.warn(`debug log fetch failed for ${requestId}:`, err.message);
				return null;
			}),
			plexusApi.listErrors(requestId).catch((err) => {
				console.warn(`errors fetch failed for ${requestId}:`, err.message);
				return [];
			}),
		]);

		// Extract parsed tool calls from the full trace (snapshot fields carry
		// the assembled stream for tool-bearing requests).
		const toolCalls = extractToolCalls(debug?.raw_request, debug?.raw_response, {
			transformedRequest: debug?.transformed_request,
			transformedResponse: debug?.transformed_response,
			transformedResponseSnapshot: debug?.transformed_response_snapshot,
			rawResponseSnapshot: debug?.raw_response_snapshot,
		});

		// Persist to parsed_tool_calls so the table is a durable, queryable
		// record of extracted calls (the API response also returns them inline).
		if (debug?.request_id && toolCalls.length > 0) {
			await persistToolCalls(debug.request_id, toolCalls);
		}

		res.json({ debug, errors, toolCalls });
	}),
);

async function persistToolCalls(requestId, toolCalls) {
	try {
		const client = await queryAppClient();
		try {
			await client.query("BEGIN");
			await client.query(
				"DELETE FROM parsed_tool_calls WHERE request_id = $1",
				[requestId],
			);
			for (const tc of toolCalls) {
				await client.query(
					`INSERT INTO parsed_tool_calls
					   (request_id, tool_name, arguments, result, error)
					 VALUES ($1, $2, $3, $4, $5)`,
					[
						requestId,
						tc.tool_name ?? null,
						tc.arguments != null ? JSON.stringify(tc.arguments) : null,
						tc.result != null ? JSON.stringify(tc.result) : null,
						tc.error ?? null,
					],
				);
			}
			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		} finally {
			client.release();
		}
	} catch (err) {
		// Persistence is best-effort: never fail the request because a write
		// to the local debug store failed.
		console.warn(`persist tool calls failed for ${requestId}:`, err.message);
	}
}

async function queryAppClient() {
	// A dedicated client so the whole delete+insert batch shares one transaction.
	return appPool.connect();
}

export default router;
