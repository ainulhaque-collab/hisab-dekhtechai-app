import dotenv from 'dotenv';
import express from 'express';
import { createAIRouter } from './ai/http';
import { aiOptionsFromEnvironment } from './ai/runtime';
import { createPushRouter } from './notifications/http';
import { pushOptionsFromEnvironment } from './notifications/runtime';
import { createContentRouter } from './content/http';
import { contentOptionsFromEnvironment } from './content/runtime';

dotenv.config({ path: ['.env.ai.local', '.env'], quiet: true });
const options = aiOptionsFromEnvironment(process.env, true);
options.onFailure = failure => console.warn(JSON.stringify({ event: 'ai_request_failed', ...failure }));
const app = express();
app.disable('x-powered-by');
app.use('/api/ai', createAIRouter(options));
app.use('/api/notifications', createPushRouter(pushOptionsFromEnvironment(process.env)));
app.use('/api',createContentRouter(contentOptionsFromEnvironment(process.env)));
// Loopback only; Vite proxies local requests. No public unauthenticated server.
app.listen(3001, '127.0.0.1', () => {
  console.log(`Hisab AI API listening on 127.0.0.1:3001; configured=${options.enabled}`);
});
