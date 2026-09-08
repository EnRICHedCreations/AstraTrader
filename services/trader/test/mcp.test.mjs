import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {handleMcp} from '../src/mcp.mjs';

const token='a'.repeat(32);
async function server(){const c={apiToken:token,port:0};const s=createServer(async(req,res)=>{if(await handleMcp(req,res,c))return;res.writeHead(404);res.end()});await new Promise(r=>s.listen(0,'127.0.0.1',r));c.port=s.address().port;return{s,c,url:'http://127.0.0.1:'+c.port}}
function rpc(method,params={},id=1){return JSON.stringify({jsonrpc:'2.0',id,method,params})}
test('MCP discovery and bearer-protected tool calls are HTTP compatible',async()=>{const x=await server();try{let r=await fetch(x.url+'/mcp');assert.equal(r.status,200);assert.equal((await r.json()).status,'ready');r=await fetch(x.url+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:rpc('initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'test',version:'1'}})});assert.equal(r.status,200);let j=await r.json();assert.equal(j.result.protocolVersion,'2026-07-28');r=await fetch(x.url+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:rpc('tools/list')});assert.equal(r.status,200);j=await r.json();assert.ok(j.result.tools.some(t=>t.name==='get_status'));assert.ok(j.result.tools.some(t=>t.name==='get_strategy'));r=await fetch(x.url+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:rpc('tools/call',{name:'get_status',arguments:{}})});assert.equal(r.status,401);r=await fetch(x.url+'/mcp',{method:'DELETE'});assert.equal(r.status,204)}finally{await new Promise(r=>x.s.close(r))}});
