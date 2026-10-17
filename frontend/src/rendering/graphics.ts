/** Independent render budgets. None changes world placement or collision data. */
export const DETAIL_LEVELS=['Low','Medium','High'] as const;
export type Detail=typeof DETAIL_LEVELS[number];
export type Resolution='Auto'|Detail;
export interface Graphics {resolution:Resolution;shadows:Detail;trees:Detail;grass:Detail;terrain:Detail;distant:Detail;}
export const DEFAULT_GRAPHICS:Readonly<Graphics>={resolution:'Auto',shadows:'Medium',trees:'Medium',grass:'Medium',terrain:'Medium',distant:'Medium'};
export const detailIndex=(level:Detail)=>DETAIL_LEVELS.indexOf(level);
/** Migrate the former combined preset once; Auto now adapts resolution only. */
export function legacyGraphics(value:unknown):Graphics {
 const level:Detail=DETAIL_LEVELS.includes(value as Detail)?value as Detail:'Medium';
 return {resolution:value==='Auto'?'Auto':level,shadows:level,trees:level,grass:level,terrain:level,distant:level};
}
export function validateGraphics(value:unknown,fallback:Graphics={...DEFAULT_GRAPHICS}):Graphics {
 const result={...fallback};if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const key of Object.keys(result) as (keyof Graphics)[]){const v=(value as Record<string,unknown>)[key];
  if(DETAIL_LEVELS.includes(v as Detail)||(key==='resolution'&&v==='Auto'))(result as Record<string,string>)[key]=v as string;
 }return result;
}
