import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const actionFor={inspect_asset:'inspect_asset',approve_asset:'approve_asset',revoke_asset:'revoke_asset',revoke_all_assets:'revoke_all_assets',pause_signals:'pause',resume_signals:'resume',kill_trading:'kill',execute_signal:'execute_signal',close_position:'close_position'};

async function local(c,path,method='GET',payload){
  const r=await fetch(`http://127.0.0.1:${c.port}${path}`,{method,headers:{authorization:'Bearer '+c.apiToken,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  const j=await r.json();
  if(!r.ok)throw Error(j.error??`AstraTrader HTTP ${r.status}`);
  return j;
}
async function callTool(name,args,c){
  if(name==='get_status')return local(c,'/api/agent/status');
  if(name==='get_opportunities')return local(c,'/api/agent/opportunities');
  if(name==='get_orders')return local(c,'/api/agent/orders');
  const action=actionFor[name];
  if(!action)throw Error('Unknown MCP tool');
  return local(c,'/api/agent/action','POST',{action,...(args??{})});
}
function authorized(ctx,c){return ctx?.http?.req?.headers?.get('authorization')==='Bearer '+c.apiToken}
function result(data){return{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}
function register(server,c,name,config,schema){
  server.registerTool(name,{...config,inputSchema:schema},async(args,ctx)=>{
    if(!authorized(ctx,c))return{content:[{type:'text',text:'Unauthorized. Connect Astra Trader with the configured Bearer API key.'}],isError:true};
    try{return result(await callTool(name,args,c))}catch(e){return{content:[{type:'text',text:String(e?.message??e)}],isError:true}}
  });
}
function buildServer(c){
  const s=new McpServer({name:'Astra Trader',version:'1.1.0'},{capabilities:{tools:{listChanged:false}}});
  const empty=z.object({});
  register(s,c,'get_status',{title:'Get AstraTrader status',description:'Use this when you need current AstraTrader mode, health, processing lag, positions, P&L, approved assets, or live-readiness checks.',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},empty);
  register(s,c,'get_opportunities',{title:'Get trading opportunities',description:'Use this when you need current AstraTrader signals, scores, rejection reasons, eligibility, and evidence.',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},empty);
  register(s,c,'get_orders',{title:'Get order journal',description:'Use this when you need current and recent AstraTrader paper or live orders and their states.',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},empty);
  register(s,c,'inspect_asset',{title:'Inspect asset',description:'Use this when you need AstraTrader to inspect a Solana mint before changing asset policy.',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}},z.object({mint:z.string().min(32).max(44)}));
  register(s,c,'approve_asset',{title:'Approve asset policy entry',description:'Use this when AstraTrader should add or refresh a mint in the operator-reviewed asset policy. Approval does not bypass deterministic token safety checks.',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},z.object({mint:z.string().min(32).max(44),evidence:z.string().min(20),reviewedBy:z.string().optional(),days:z.number().int().min(1).max(365).optional()}));
  register(s,c,'revoke_asset',{title:'Revoke asset approval',description:'Use this when a mint must be removed from AstraTrader asset policy.',annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},z.object({mint:z.string().min(32).max(44)}));
  register(s,c,'revoke_all_assets',{title:'Emergency revoke all assets',description:'Use this for an emergency policy reset that removes every approved asset.',annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},empty);
  register(s,c,'pause_signals',{title:'Pause signals',description:'Use this when autonomous signal evaluation should stop without killing the service.',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},empty);
  register(s,c,'resume_signals',{title:'Resume signals',description:'Use this when signal evaluation should resume after a pause.',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},empty);
  register(s,c,'kill_trading',{title:'Kill trading',description:'Use this when trading must be stopped immediately. In live mode the backend also requests signer shutdown.',annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},empty);
  register(s,c,'execute_signal',{title:'Execute accepted signal',description:'Use this when an existing AstraTrader signal is eligible and should be executed. Backend risk, budget, and signer gates remain authoritative.',annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},z.object({signalId:z.string().min(1)}));
  register(s,c,'close_position',{title:'Close paper position',description:'Use this when an open paper position should be closed. Direct MCP live-position closing is not exposed; live exits remain signer/policy controlled.',annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},z.object({mint:z.string().min(32).max(44)}));
  return s;
}

let nodeHandler=null;
let boundConfig=null;
function getHandler(c){
  if(nodeHandler&&boundConfig===c)return nodeHandler;
  boundConfig=c;
  const handler=createMcpHandler(()=>buildServer(c),{responseMode:'json'});
  nodeHandler=toNodeHandler(handler);
  return nodeHandler;
}

export async function handleMcp(req,res,c){
  const url=new URL(req.url,'http://localhost');
  if(url.pathname!=='/mcp')return false;
  // Official MCP v2 handler serves both 2026-07-28 and legacy 2025-era clients.
  // Tool descriptors are discoverable; every actual tool invocation validates the Bearer ADMIN_TOKEN.
  await getHandler(c)(req,res);
  return true;
}
