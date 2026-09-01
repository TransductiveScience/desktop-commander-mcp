import os from 'node:os';

const base=process.env.TEST_MCP_URL||'http://127.0.0.1:9180/mcp';
function parse(text){const d=text.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n'); return d?JSON.parse(d):null;}
async function post(body,sid,timeout=40000){
  const h={'content-type':'application/json','accept':'application/json, text/event-stream'}; if(sid)h['mcp-session-id']=sid;
  const t=Date.now(),r=await fetch(base,{method:'POST',headers:h,body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const text=await r.text(),ct=r.headers.get('content-type')||'';
  return {status:r.status,sid:r.headers.get('mcp-session-id'),payload:ct.includes('text/event-stream')?parse(text):(text?JSON.parse(text):null),ms:Date.now()-t};
}
const rpc=(id,method,params={})=>({jsonrpc:'2.0',id,method,params});
const call=(id,name,args)=>rpc(id,'tools/call',{name,arguments:args});
const text=r=>r?.payload?.result?.content?.map(x=>x?.text||'').join('\n')||'';
let activeSessions=[];
async function init(label){const r=await post(rpc(1,'initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:`accept-${label}`,version:'1'}})); if(r.status!==200||!r.sid||r.payload?.error)throw Error(`init ${label}: ${JSON.stringify(r)}`); return r;}
async function del(sid){try{await fetch(base,{method:'DELETE',headers:{'mcp-session-id':sid},signal:AbortSignal.timeout(5000)});}catch{}}
async function main(){
  const inits=await Promise.all(['A','B','C','D','E'].map(init));
  const sids=inits.map(x=>x.sid); if(new Set(sids).size!==5)throw Error('session IDs not unique');
  activeSessions=sids;
  console.log('SESSIONS',sids.join(' '));

  let required=await post(call(10,'get_config',{origin:'llm'}),sids[0]);
  if(required.status!==200||required.payload?.error||!text(required))throw Error(`get_config failed: ${JSON.stringify(required)}`);
  console.log('GET_CONFIG_PASS');
  required=await post(call(11,'list_sessions',{}),sids[0]);
  if(required.status!==200||required.payload?.error)throw Error(`list_sessions failed: ${JSON.stringify(required)}`);
  console.log('LIST_SESSIONS_PASS');
  required=await post(call(12,'start_process',{command:'hostname',timeout_ms:10000,shell:'cmd.exe'}),sids[0]);
  if(required.status!==200||required.payload?.error||!text(required).toLowerCase().includes(os.hostname().toLowerCase()))throw Error(`start_process(hostname) failed: ${JSON.stringify(required)}`);
  console.log('START_PROCESS_HOSTNAME_PASS',os.hostname());

  const jobs=[];
  for(let s=0;s<5;s++)for(let id=1;id<=3;id++){
    const token=`S${s+1}-ID${id}`;
    jobs.push(post(call(id,'start_process',{command:`echo ${token}`,timeout_ms:10000,shell:'cmd.exe'}),sids[s]).then(r=>({s,id,token,r})));
  }
  const out=await Promise.all(jobs);
  for(let i=0;i<out.length;i++){
    const x=out[i]; if(x.r.status!==200||x.r.payload?.id!==x.id)throw Error(`routing id fail ${x.token}: ${JSON.stringify(x.r)}`);
    if(!text(x.r).includes(x.token)){
      const m=text(x.r).match(/PID\s+(\d+)/i); if(!m)throw Error(`routing PID missing ${x.token}: ${JSON.stringify(x.r)}`);
      const rr=await post(call(9000+i,'read_process_output',{pid:Number(m[1]),timeout_ms:1000,offset:0,length:50}),sids[x.s]);
      if(rr.status!==200||!text(rr).includes(x.token))throw Error(`routing process ownership fail ${x.token}: ${JSON.stringify(rr)}`);
    }
  }
  console.log('REUSED_IDS_5X3_PASS',out.map(x=>`${x.token}:${x.r.ms}ms`).join(' '));

  const sid=sids[0], file='C:\\Windows\\Temp\\dc-gateway-acceptance.txt';
  let r=await post(call(100,'write_file',{path:file,content:'desktop-commander-gateway-ok\n',mode:'rewrite'}),sid); if(r.status!==200||r.payload?.error)throw Error('write_file failed');
  r=await post(call(101,'read_file',{path:file,offset:0,length:10}),sid); if(r.status!==200||!text(r).includes('desktop-commander-gateway-ok'))throw Error('read_file failed');
  r=await post(call(102,'list_directory',{path:'C:\\Windows\\Temp',depth:1}),sid); if(r.status!==200||r.payload?.error)throw Error('list_directory failed');
  r=await post(call(103,'start_process',{command:'echo PROC-OK & ping -n 4 127.0.0.1 >nul & echo PROC-DONE',timeout_ms:1200,shell:'cmd.exe'}),sid);
  const m=text(r).match(/PID\s+(\d+)/i); if(!m)throw Error(`start_process PID missing: ${text(r)}`); const pid=Number(m[1]);
  await new Promise(x=>setTimeout(x,3500));
  let procText='';
  for(let i=0;i<5&&!procText.includes('PROC-DONE');i++){
    r=await post(call(104+i,'read_process_output',{pid,timeout_ms:1000,offset:0,length:50}),sid); procText+=text(r); if(!procText.includes('PROC-DONE'))await new Promise(x=>setTimeout(x,500));
  }
  if(r.status!==200||!procText.includes('PROC-DONE'))throw Error(`read_process_output failed: ${procText}`);

  const warm=[]; for(let i=0;i<7;i++){r=await post(call(200+i,'read_file',{path:file,offset:0,length:10}),sid); if(r.status!==200||r.payload?.error)throw Error('warm read failed'); warm.push(r.ms);}
  warm.sort((a,b)=>a-b); console.log('WARM_READ_MS',warm.join(','),'MEDIAN',warm[Math.floor(warm.length/2)]);
  const health=await fetch(base.replace(/\/mcp$/,'/healthz'),{signal:AbortSignal.timeout(5000)}).then(x=>x.json()); console.log('HEALTH',JSON.stringify(health));

  // --- MODERN 2026-07-28 STATELESS & RECONNECTION ACCEPTANCE MATRIX ---
  console.log('TESTING_2026_STATELESS_MATRIX...');
  
  // 1. Modern 2026 stateless: consecutive tool calls with NO session header
  for (let i = 1; i <= 20; i++) {
    const sr = await post(call(5000 + i, 'read_file', { path: file, offset: 0, length: 10 }), null);
    if (sr.status !== 200 || sr.payload?.error) throw Error(`stateless call ${i} failed: ${JSON.stringify(sr)}`);
  }
  console.log('PASS_STATELESS_NO_SESSION_HEADER_20X');

  // 2. Unknown / Stale Session ID recovery test (must not return 400/500 storm, must recover cleanly)
  const staleSid = 'stale-vanished-uuid-' + Date.now();
  const recoverCall = await post(call(6001, 'read_file', { path: file, offset: 0, length: 10 }), staleSid);
  if (recoverCall.status !== 200 && recoverCall.status !== 404) throw Error(`stale session call returned unexpected status: ${recoverCall.status}`);
  console.log('PASS_STALE_SESSION_RECOVERY');

  await Promise.allSettled(sids.map(del)); activeSessions=[]; console.log('ORDINARY_TOOLS_PASS'); console.log('ACCEPTANCE_PASS');
}
main().catch(async e=>{await Promise.allSettled(activeSessions.map(del));console.error('ACCEPTANCE_FAIL',e?.stack||e);process.exit(1);});
