import { Router } from "express";
import { plexusApi } from "../services/plexusApi.js";
import { extractToolCalls } from "../services/toolParser.js";
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

		// Extract parsed tool calls from raw request/response if available
		const toolCalls = extractToolCalls(debug?.raw_request, debug?.raw_response);

		res.json({ debug, errors, toolCalls });
	}),
);

export default router;
