import {spawnSync} from 'node:child_process';
// No authentication or publication except when the user explicitly runs login/deploy.
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(result.error)throw result.error;process.exit(result.status??1);
