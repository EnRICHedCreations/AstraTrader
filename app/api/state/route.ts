import {snapshot} from '@/lib/engine';
export async function GET(){try{return Response.json(await snapshot(),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Persistent storage unavailable. Try again shortly.'},{status:503})}}
