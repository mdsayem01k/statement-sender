require('dotenv').config();
const env = require('./config/env');
const createContext = require('./bootstrap/context');
const buildRegistry = require('./bootstrap/modules');
const createApp = require('./app');

const ctx = createContext();
const registry = buildRegistry(ctx);
const app = createApp(registry);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Modules: ${registry.all().map((m) => m.type).join(', ')}`);
  console.log('Routes:');
  registry.listRoutes().forEach((r) => console.log(`  ${r.method.padEnd(4)} ${r.path}   [${r.module}]`));
  if (env.jobs.enabled) registry.startJobs();
  else console.log('Sync/notify jobs are OFF (set ENABLE_JOBS=true to start them)');
});

process.on('SIGINT', () => { registry.stopJobs(); process.exit(0); });
