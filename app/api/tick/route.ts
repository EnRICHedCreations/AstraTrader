import {env} from 'cloudflare:workers';
import {cycle} from '@/lib/engine';
export async function POST(r:Request){const token=(env as any).COLLECTOR_TOKEN;const bearer=r.headers.get('authorization');const trusted=r.headers.get('origin')===new URL(r.url).origin;if(!trusted&&(!token||bearer!==`Bearer ${token}`))return Response.json({error:'Unauthorized collector'},{status:403});return Response.json(await cycle())}
