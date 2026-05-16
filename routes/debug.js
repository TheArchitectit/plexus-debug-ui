import { Router } from 'express';
import { plexusApi } from '../services/plexusApi.js';
import { extractToolCalls } from '../services/toolParser.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/:requestId', asyncHandler(async (req, res) => {
  const { requestId } = req.params;

  const [usage, debug, errors] = await Promise.all([
    plexusApi.getUsage(requestId).catch(() => null),
    plexusApi.getDebugLog(requestId).catch(() => null),
    plexusApi.listErrors(requestId).catch(() => []),
  ]);

  // Extract parsed tool calls from raw request/response if available
  const toolCalls = extractToolCalls(debug?.raw_request, debug?.raw_response);

  res.json({ usage, debug, errors, toolCalls });
}));

export default router;
