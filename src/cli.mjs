#!/usr/bin/env node
import {startProxy,MODES} from './fault-proxy.mjs';
import {status,recover} from './recovery.mjs';
const [command,...args]=process.argv.slice(2);
if(command==='proxy'){
 const options={};for(let i=0;i<args.length;i+=2){if(!['--upstream','--mode','--port'].includes(args[i])||!args[i+1])throw new Error('Use proxy --upstream URL --mode MODE --port PORT');options[args[i]]=args[i+1]}
 const port=Number(options['--port']||3339);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
 const proxy=await startProxy(options['--upstream'],{mode:options['--mode']||'drop-after',port});
 console.log(JSON.stringify({listening:proxy.url,upstream:options['--upstream'],oneShotFault:options['--mode']||'drop-after',warning:'FAKE FUNDS ONLY. Redacted transcript prints on exit.'}));
 let ending=false;async function stop(){if(ending)return;ending=true;await proxy.close();console.log(JSON.stringify({requests:proxy.events}));process.exit(0)}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}else if(command==='status'||command==='recover'){
 if(args.length!==1)throw new Error('Expected journal filename');
 console.log(JSON.stringify(command==='status'?status(args[0]):await recover(args[0])));
}else{
 console.log(`Boost Recovery Lab\n  node demo/run.mjs\n  node src/cli.mjs proxy --upstream http://127.0.0.1:3338 --mode drop-after --port 3339\n  node src/cli.mjs status path/to/tip.journal.json\n  node src/cli.mjs recover path/to/tip.journal.json\nFault modes: ${MODES.join(', ')}`);
 if(command)process.exitCode=1;
}
