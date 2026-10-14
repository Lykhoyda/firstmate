import {createServer} from 'node:http';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(), home=resolve('.test-live-pi/home'), agentDir=resolve('.test-live-pi/agent');
process.env.FM_HOME=home; process.env.PI_CODING_AGENT_DIR=agentDir; process.env.PI_OFFLINE='1';
for(const k of ['FM_ROOT_OVERRIDE','FM_STATE_OVERRIDE','FM_CONFIG_OVERRIDE','FM_DATA_OVERRIDE','FM_PROJECTS_OVERRIDE','FM_GATE_REFUSE_BYPASS']) delete process.env[k];
mkdirSync(agentDir,{recursive:true});
writeFileSync(home+'/state/.lock',process.pid+'\n');
writeFileSync(home+'/state/.wake-queue','');
const requests=[];
const server=createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;
 const request=JSON.parse(body);requests.push(request);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'lab',object:'chat.completion.chunk',created:1,model:'lab',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 if(request.tools?.some(t=>t.function?.name==='fm_branch_report') && !request.messages.some(m=>m.role==='tool')) {
 chunk({role:'assistant',tool_calls:[{index:0,id:'lab-report',type:'function',function:{name:'fm_branch_report',arguments:JSON.stringify({task:'lab',verdict:'routine',summary:'Disposable lab observation recorded',wake:'signal: lab.status'})}}]});chunk({},'tool_calls');
 } else {chunk({role:'assistant',content:'LAB_TURN_COMPLETED'});chunk({},'stop');}res.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
writeFileSync(agentDir+'/models.json',JSON.stringify({providers:{lab:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'disposable-local',models:[{id:'lab',contextWindow:128000,maxTokens:2000}]}}}));
writeFileSync(home+'/config/supervision-branch-model','lab/lab\n');
const sdk=await import('/Users/antonlykhoyda/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js');
const runtime=await sdk.ModelRuntime.create({authPath:agentDir+'/auth.json',modelsPath:agentDir+'/models.json',modelsStorePath:agentDir+'/catalog',allowModelNetwork:false});
let bus;
const settings=sdk.SettingsManager.create(root,agentDir);
const loader=new sdk.DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[{name:"lab-bus-probe",factory:pi=>{bus=pi.events}}],additionalExtensionPaths:[root+'/.pi/extensions/'+(process.env.LAB_BASE?'local-base-branch.ts':'fm-branch-supervision.ts'),root+'/.pi/extensions/'+(process.env.LAB_BASE?'local-base-watch.ts':'fm-primary-pi-watch.ts')]});
await loader.reload();
const {session,extensionsResult}=await sdk.createAgentSession({cwd:root,agentDir,modelRuntime:runtime,model:runtime.getModel('lab','lab'),resourceLoader:loader,settingsManager:settings,sessionManager:sdk.SessionManager.create(root,agentDir+'/sessions'),tools:[]});
const errors=[];
console.log('EXTENSIONS',extensionsResult.extensions.map(e=>e.path), 'LOAD_ERRORS',extensionsResult.errors);
assert.equal(extensionsResult.errors.length,0);
await session.bindExtensions({onError:e=>{errors.push(e);console.log('EXTENSION_ERROR',e)}});
await (async()=>{try {
 await session.sendCustomMessage({customType:'lab-injected',content:'Injected continuation without captain prompt',display:false},{triggerTurn:true});
 assert.equal(errors.length,0);assert.equal(requests.length,1);
 console.log('PROMPTLESS_CUSTOM_TURN completed; provider requests=1; extension errors=0');
 for(const prompt of [undefined,null,42,{}]) await session.extensionRunner.emitBeforeAgentStart({messageType:'user',prompt},{basePrompt:'lab'});
 if(process.env.LAB_BASE){assert(errors.some(e=>String(e.error||e.message||JSON.stringify(e)).includes('trim')));console.log('BASE_REGRESSION reproduced trim failure via real extension runner');} else assert.equal(errors.length,0); if(!process.env.LAB_BASE)console.log('MALFORMED_USER_EVENTS undefined/null/number/object accepted by real runner without extension errors');
 if(process.env.LAB_BASE){return;}
 await session.prompt('  Captain normal live prompt  ');
 assert.equal(errors.length,0);assert.equal(requests.length,2);
 console.log('CAPTAIN_USER_TURN completed; provider requests=2; extension errors=0');
 // Inject a harmless signal into the disposable queue so the real branch constructs and flushes its mirror.
 writeFileSync(home+'/state/.wake-queue','1\t1\tsignal\tlab.status\tsignal: lab.status\n');
 writeFileSync(home+'/state/lab.meta','project='+home+'/projects/approved\nwindow=fm-lab\n');
 const offer={message:'signal: lab.status',projects:[],heartbeat:false,eligible:true,awayOnly:false,accepted:false,accept(p){this.accepted=true;this.settlement=p}};
 bus.emit('fm-branch-supervision:dispatch',offer);
 assert.equal(offer.accepted,true);await offer.settlement;
 const pointer=readFileSync(home+'/state/.branch-session','utf8').trim();
 const entries=readFileSync(pointer,'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const mirror=entries.filter(e=>e.type==='custom_message'&&e.customType==='fm-main-mirror').map(e=>e.content);
 console.log('BRANCH_MIRROR',JSON.stringify(mirror));
 assert.equal(mirror.filter(s=>s==='[captain] Captain normal live prompt').length,1);
 assert.equal(mirror.filter(s=>s.startsWith('[captain] ')).length,1);
 assert.equal(errors.length,0);
 console.log('CAPTAIN_MIRROR trimmed once; custom/malformed inputs absent');
} finally {await session.extensionRunner.emit({type:'session_shutdown'});session.dispose();server.close();}})();
