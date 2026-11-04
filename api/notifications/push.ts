import express from 'express';
import { createPushRouter } from '../../server/notifications/http.js';
import { pushOptionsFromEnvironment } from '../../server/notifications/runtime.js';
const app = express();
app.disable('x-powered-by');
app.use('/api/notifications', createPushRouter(pushOptionsFromEnvironment(process.env)));
export default app;
