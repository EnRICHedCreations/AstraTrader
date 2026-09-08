const tools=[
{name:'get_status',title:'Get AstraTrader status',description:'Use this when you need current mode, health, processing lag, positions, P&L, approved assets, or live-readiness checks.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'get_opportunities',title:'Get trading opportunities',description:'Use this when you need current AstraTrader signals, scores, rejection reasons, eligibility, and evidence.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'get_orders',title:'Get order journal',description:'Use this when you need current and recent AstraTrader paper or live orders and their states.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'inspect_asset',title:'Inspect asset',description:'Use this when you need AstraTrader to inspect a Solana mint before changing asset policy.',inputSchema:{type:'object',required:['mint'],properties:{mint:{type:'string',description:'Solana mint address'}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}},
{name:'approve_asset',title:'Approve asset policy entry',description:'Use this when AstraTrader should add or refresh a mint in the operator-reviewed asset policy. This does not bypass other deterministic token safety checks.',inputSchema:{type:'object',required:['mint','evidence'],properties:{mint:{type:'string'},evidence:{type:'string',minLength:20},reviewedBy:{type:'string'},days:{type:'integer',minimum:1,maximum:365}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
{name:'revoke_asset',title:'Revoke asset approval',description:'Use this when a mint must be removed from AstraTrader asset policy.',inputSchema:{type:'object',required:['mint'],properties:{mint:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'revoke_all_assets',title:'Emergency revoke all assets',description:'Use this for an emergency policy reset that removes every approved asset.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'pause_signals',title:'Pause signals',description:'Use this when autonomous signal evaluation should stop without killing the service.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'resume_signals',title:'Resume signals',description:'Use this when signal evaluation should resume after a pause.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'kill_trading',title:'Kill trading',description:'Use this when trading must be stopped immediately. In live mode the backend also requests signer shutdown.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
{name:'execute_signal',title:'Execute accepted signal',description:'Use this when an existing AstraTrader signal is eligible and should be executed. Backend risk, budget, and signer gates remain authoritative.',inputSchema:{type:'object',required:['signalId'],properties:{signalId:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
{name:'close_position',title:'Close paper position',description:'Use this when an open paper position should be closed. Direct MCP live-position closing is not exposed; live exits remain signer/policy controlled.',inputSchema:{type:'object',required:['mint'],properties:{mint:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}
];
const actionFor={inspect_asset:'inspect_asset',approve_asset:'approve_asset',revoke_asset:'revoke_asset',revoke_all_assets:'revoke_all_assets',pause_signals:'pause',resume_signals:'resume',kill_trading:'kill',execute_signal:'execute_signal',close_position:'close_position'};
const supported=['2025-11-25','2025-06-18','2025-03-26'];
function json(res,status,value,extra={}){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...extra});res.end(value===undefined?'':JSON.stringify(value))}
async function read(req,max=32768){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>max)throw Error('MCP request too large');chunks.push(c)}return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}
function rpc(id,result){return{jsonrpc:'2.0',id,result}}
function rpcError(id,code,message){return{jsonrpc:'2.0',id,error:{code,message}}}
async function local(c,path,method='GET',payload){const r=await fetch(`http://127.0.0.1:${c.port}${path}`,{method,headers:{authorization:'Bearer '+c.apiToken,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error??`AstraTrader HTTP ${r.status}`);return j}
async function callTool(name,args,c){if(name==='get_status')return local(c,'/api/agent/status');if(name==='get_opportunities')return local(c,'/api/agent/opportunities');if(name==='get_orders')return local(c,'/api/agent/orders');const action=actionFor[name];if(!action)throw Error('Unknown MCP tool');return local(c,'/api/agent/action','POST',{action,...(args??{})})}
function authOk(req,c){const auth=String(req.headers.authorization??'');return auth==='Bearer '+c.apiToken}
function initialized(method){return method==='initialize'||method==='notifications/initialized'||method==='ping'||method==='tools/list'}
export async function handleMcp(req,res,c){const url=new URL(req.url,'http://localhost');if(url.pathname!=='/mcp')return false;
  if(req.method==='GET'){
    // ChatGPT may probe the endpoint while creating the credential link. Do not expose data or tools here.
    json(res,200,{service:'astratrader-mcp',status:'ready',authentication:'bearer',protocol:'MCP'});return true
  }
  if(req.method!=='POST'){json(res,405,{error:'Method not allowed'},{Allow:'GET, POST'});return true}
  let m;try{m=await read(req)}catch(e){json(res,400,rpcError(null,-32700,e.message));return true}
  const id=m.id??null,method=m.method;
  // Permit protocol discovery before credential attachment. Tool execution remains authenticated.
  if(!authOk(req,c)&&!initialized(method)){json(res,401,{error:'Unauthorized MCP'},{'WWW-Authenticate':'Bearer realm="AstraTrader"'});return true}
  try{
    if(method==='initialize'){
      const requested=String(m.params?.protocolVersion??'');
      const protocol=supported.includes(requested)?requested:'2025-03-26';
      json(res,200,rpc(id,{protocolVersion:protocol,serverInfo:{name:'AstraTrader',version:'1.0.2'},capabilities:{tools:{listChanged:false}},instructions:'AstraTrader operational control. Mutating tool calls require bearer authentication; deterministic risk, capital, and signer gates remain authoritative.'}),{'MCP-Protocol-Version':protocol});return true
    }
    if(method==='notifications/initialized'){res.writeHead(202,{'cache-control':'no-store'});res.end();return true}
    if(method==='ping'){json(res,200,rpc(id,{}));return true}
    if(method==='tools/list'){json(res,200,rpc(id,{tools}));return true}
    if(method==='tools/call'){
      if(!authOk(req,c)){json(res,401,{error:'Unauthorized MCP'},{'WWW-Authenticate':'Bearer realm="AstraTrader"'});return true}
      const name=m.params?.name;
      const data=await callTool(name,m.params?.arguments??{},c);
      json(res,200,rpc(id,{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}));return true
    }
    json(res,200,rpcError(id,-32601,'Method not found'));return true
  }catch(e){json(res,200,rpc(id,{content:[{type:'text',text:String(e.message??e)}],isError:true}));return true}
}
