import {records} from '@/lib/store';
import {snapshot} from '@/lib/engine';
export async function GET(){return Response.json({...await snapshot(),observations:await records('observation',10000),quotes:await records('quote',10000),scoreHistory:await records('score',10000),exportedAt:Date.now(),coverage:'Newest 10,000 observations/quotes/scores; newest 500 other records. Not an unbounded archive.'},{headers:{'Content-Disposition':'attachment; filename="actor-evidence.json"','Cache-Control':'no-store'}})}
