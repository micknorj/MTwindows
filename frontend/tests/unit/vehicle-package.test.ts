import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {VEHICLE_ASSET,VEHICLE_SHA256,unpackVehicle} from '../../src/vehicle/package';
it('reviewed game resource decodes to the exact verified optimized GLB, with its full handoff',async()=>{
 const packed=new Uint8Array(readFileSync('assets/'+VEHICLE_ASSET));
 const bytes=await unpackVehicle(packed);
 expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).toBe(VEHICLE_SHA256);
 const header=new DataView(bytes);expect(header.getUint32(0,true)).toBe(0x46546c67);expect(bytes.byteLength).toBe(3198460);
 const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,header.getUint32(12,true))));
 for(const wheel of ['FL','FR','RL','RR'])for(const suffix of ['Steer','Surface'])expect(gltf.nodes.some((n:{name:string})=>n.name===`Wheel_${wheel}${suffix}`)).toBe(true);
 expect(gltf.nodes.filter((n:{extras?:{shape?:string}})=>n.extras?.shape==='box')).toHaveLength(4);
 expect(gltf.images.every((image:{uri?:string;bufferView?:number})=>!image.uri&&image.bufferView!==undefined)).toBe(true);
});
it('rejects missing, corrupt, truncated and HTML vehicle responses instead of substituting another car',async()=>{
 for(const bytes of [new Uint8Array(),new TextEncoder().encode('<html>not found</html>'),new Uint8Array(readFileSync('assets/'+VEHICLE_ASSET)).slice(0,100)])await expect(unpackVehicle(bytes)).rejects.toThrow();
 const damaged=new Uint8Array(readFileSync('assets/'+VEHICLE_ASSET));damaged[100]^=1;await expect(unpackVehicle(damaged)).rejects.toThrow();
});
