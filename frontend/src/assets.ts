import paths from 'virtual:rimmile-assets';
/** Simple anonymous GETs need no credentials, preflight or canvas readback. */
export function assetUrl(id:keyof typeof paths):string { return paths[id]; }
