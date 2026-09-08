import {backtest} from '@/lib/engine';
export async function POST(r:Request){if(r.headers.get('origin')!==new URL(r.url).origin)return Response.json({error:'Origin rejected'},{status:403});return Response.json(await backtest())}
