require('dotenv').config();
const env = require('./config/env');
const createContext = require('./bootstrap/context');
const buildRegistry = require('./bootstrap/modules');
const createApp = require('./app');

const ctx = createContext();
const registry = buildRegistry(ctx);
const app = createApp(registry);
registry.getPipeline();

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Modules: ${registry.all().map((m) => m.type).join(', ')}`);
  console.log('Routes:');
  registry.listRoutes().forEach((r) => console.log(`  ${r.method.padEnd(4)} ${r.path}   [${r.module}]`));
  if (env.jobs.enabled) registry.startJobs().catch(error => console.error('[PIPELINE START]', error.message));
  else console.log('Sync/notify jobs are OFF (set ENABLE_JOBS=true to start them)');
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await registry.stopJobs();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
