const tools=[
{name:'get_status',title:'Get AstraTrader status',description:'Read current mode, health, P&L, positions, live readiness and active strategy.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'get_opportunities',title:'Get trading opportunities',description:'Read current signals, eligibility and evidence.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'get_orders',title:'Get order journal',description:'Read current and recent paper or live orders.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'get_strategy',title:'Get strategy configuration',description:'Read every runtime-configurable AstraTrader strategy parameter and its validation schema.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'set_strategy',title:'Change trading strategy',description:'Change one or more AstraTrader strategy parameters at runtime. Changes persist.',inputSchema:{type:'object',required:['strategy'],properties:{strategy:{type:'object',additionalProperties:{type:['number','boolean']}},replace:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'reset_strategy',title:'Reset trading strategy',description:'Reset all runtime strategy parameters to application defaults.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'inspect_asset',title:'Inspect asset',description:'Inspect a Solana mint under the active strategy.',inputSchema:{type:'object',required:['mint'],properties:{mint:{type:'string',minLength:32,maxLength:44}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}},
{name:'approve_asset',title:'Approve asset policy entry',description:'Add or refresh a mint in asset policy. Strategy controls whether asset review is required for trading.',inputSchema:{type:'object',required:['mint','evidence'],properties:{mint:{type:'string',minLength:32,maxLength:44},evidence:{type:'string',minLength:20},reviewedBy:{type:'string'},days:{type:'integer',minimum:1,maximum:365}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
{name:'revoke_asset',title:'Revoke asset approval',description:'Remove a mint from asset policy.',inputSchema:{type:'object',required:['mint'],properties:{mint:{type:'string',minLength:32,maxLength:44}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'revoke_all_assets',title:'Revoke all assets',description:'Remove every approved asset.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'pause_signals',title:'Pause signals',description:'Pause autonomous signal evaluation.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'resume_signals',title:'Resume signals',description:'Resume signal evaluation.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'kill_trading',title:'Kill trading',description:'Stop trading immediately; live mode also requests signer shutdown.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'execute_signal',title:'Execute accepted signal',description:'Execute an existing eligible signal.',inputSchema:{type:'object',required:['signalId'],properties:{signalId:{type:'string',minLength:1}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
{name:'close_position',title:'Close paper position',description:'Close an open paper position.',inputSchema:{type:'object',required:['mint'],properties:{mint:{type:'string',minLength:32,maxLength:44}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}
];
const actionFor={inspect_asset:'inspect_asset',approve_asset:'approve_asset',revoke_asset:'revoke_asset',revoke_all_assets:'revoke_all_assets',pause_signals:'pause',resume_signals:'resume',kill_trading:'kill',execute_signal:'execute_signal',close_position:'close_position',set_strategy:'set_strategy',reset_strategy:'reset_strategy'};
const supported=['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
function json(res,status,value,extra={}){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...extra});res.end(value===undefined?'':JSON.stringify(value))}
async function read(req,max=32768){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>max)throw Error('MCP request too large');chunks.push(c)}return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}
function rpc(id,result){return{jsonrpc:'2.0',id,result}}
function rpcError(id,code,message){return{jsonrpc:'2.0',id,error:{code,message}}}
async function local(c,path,method='GET',payload){const r=await fetch(`http://127.0.0.1:${c.port}${path}`,{method,headers:{authorization:'Bearer '+c.apiToken,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error??`AstraTrader HTTP ${r.status}`);return j}
async function callTool(name,args,c){if(name==='get_status')return local(c,'/api/agent/status');if(name==='get_opportunities')return local(c,'/api/agent/opportunities');if(name==='get_orders')return local(c,'/api/agent/orders');if(name==='get_strategy')return local(c,'/api/strategy');const action=actionFor[name];if(!action)throw Error('Unknown MCP tool');return local(c,'/api/agent/action','POST',{action,...(args??{})})}
function authOk(req,c){return String(req.headers.authorization??'')==='Bearer '+c.apiToken}
function discoveryMethod(method){return method==='initialize'||method==='notifications/initialized'||method==='ping'||method==='tools/list'}
export async function handleMcp(req,res,c){const url=new URL(req.url,'http://localhost');if(url.pathname!=='/mcp')return false;
  if(req.method==='GET'){json(res,200,{service:'astratrader-mcp',status:'ready',authentication:'bearer',protocol:'MCP'});return true}
  if(req.method==='DELETE'){res.writeHead(204,{'cache-control':'no-store'});res.end();return true}
  if(req.method!=='POST'){json(res,405,{error:'Method not allowed'},{Allow:'GET, POST, DELETE'});return true}
  let m;try{m=await read(req)}catch(e){json(res,400,rpcError(null,-32700,e.message));return true}
  const id=m.id??null,method=m.method;
  if(!authOk(req,c)&&!discoveryMethod(method)){json(res,401,{error:'Unauthorized MCP'},{'WWW-Authenticate':'Bearer realm="AstraTrader"'});return true}
  try{
    if(method==='initialize'){const requested=String(m.params?.protocolVersion??'');const protocol=supported.includes(requested)?requested:'2025-11-25';json(res,200,rpc(id,{protocolVersion:protocol,serverInfo:{name:'AstraTrader',version:'2.1.1'},capabilities:{tools:{listChanged:false}},instructions:'AstraTrader operational control. Tool execution requires bearer authentication; deterministic risk, capital, and signer gates remain authoritative.'}),{'MCP-Protocol-Version':protocol});return true}
    if(method==='notifications/initialized'){res.writeHead(202,{'cache-control':'no-store'});res.end();return true}
    if(method==='ping'){json(res,200,rpc(id,{}));return true}
    if(method==='tools/list'){json(res,200,rpc(id,{tools}));return true}
    if(method==='tools/call'){if(!authOk(req,c)){json(res,401,{error:'Unauthorized MCP'},{'WWW-Authenticate':'Bearer realm="AstraTrader"'});return true}const name=m.params?.name;const data=await callTool(name,m.params?.arguments??{},c);json(res,200,rpc(id,{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}));return true}
    json(res,200,rpcError(id,-32601,'Method not found'));return true
  }catch(e){json(res,200,rpc(id,{content:[{type:'text',text:String(e?.message??e)}],isError:true}));return true}
}
