/** Fixed road/portal columns include all possible clamped river knots. Stitched
 * boundary fans share EVERY fine edge vertex, avoiding far-LOD T-junction gaps. */
export const TERRAIN_BAND_CELLS=16;
const fine=(col:number,cells:number,mask?:Uint8Array)=>{const first=(cells+1-7)/2;return !!mask?.[col]||(col>=first-13&&col<=first+18);};
export function terrainLodIndices(cells:number,rows=20,mask?:Uint8Array){
 const point=(row:number,col:number)=>(Math.min(row,rows-1)*cells+Math.min(col,cells-1))*6+(row===rows?(col===cells?5:1):col===cells?2:0);
 return [1,2,4].map(step=>{
  const indices:number[]=[];
  for(let col=0;col<cells;col++){
   const stride=fine(col,cells,mask)?1:step,left=stride>1&&fine(col-1,cells,mask),right=stride>1&&fine(col+1,cells,mask);
   for(let row=0;row<rows;row+=stride){const end=Math.min(rows,row+stride),a=point(row,col),b=point(row,col+1),c=point(end,col),d=point(end,col+1);
    if(left){for(let r=row;r<end;r++)indices.push(point(r,col),point(r+1,col),b);indices.push(b,c,d);}
    else if(right){indices.push(a,c,b);for(let r=row;r<end;r++)indices.push(point(r,col+1),c,point(r+1,col+1));}
    else indices.push(a,c,b,b,c,d);
   }
  }return new Uint16Array(indices);
 });
}
export function terrainLodRanges(cells:number,rows=20,mask?:Uint8Array){
 return [1,2,4].map(step=>{
  const offsets=new Uint32Array(cells+1);
  for(let col=0;col<cells;col++){
   const stride=fine(col,cells,mask)?1:step,stitch=stride>1&&(fine(col-1,cells,mask)||fine(col+1,cells,mask));let count=0;
   for(let row=0;row<rows;row+=stride)count+=stitch?(Math.min(rows,row+stride)-row+1)*3:6;
   offsets[col+1]=offsets[col]+count;
  }return offsets;
 });
}
