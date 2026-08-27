import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import requestsRouter from './routes/requests.js';
import debugRouter from './routes/debug.js';
import exportRouter from './routes/export.js';
import annotationsRouter from './routes/annotations.js';
import filtersRouter from './routes/filters.js';
import healthRouter from './routes/health.js';
import reportsRouter from './routes/reports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use('/health', healthRouter);
app.use('/api', requireAuth);
app.use('/api/filters', filtersRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/export', exportRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/reports', reportsRouter);

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Plexus Debug UI running on port ${config.port}`);
});
