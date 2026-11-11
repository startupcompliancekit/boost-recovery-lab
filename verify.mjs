import {spawnSync} from 'node:child_process';
for(const args of [['--test'],['demo/run.mjs']]){const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
