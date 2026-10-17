export interface PublicAsset {id:string;file:string;sha256:string;bytes:number;mime:string;license:string;}
export function hash(bytes:Uint8Array):string;
export function reviewedAssets(manifestPath?:string):Promise<{manifest:{version:number;assets:PublicAsset[]};entries:(PublicAsset&{source:string})[];revision:string}>;
export function checkedAssetBase(value?:string):string;

export function checkedPagesBase(value?:string):string;
