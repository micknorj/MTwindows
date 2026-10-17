import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ENGINE_ASSET,ENGINE_BANKS,unpackEngine} from '../../src/audio/sample-pack';
it('release engine decodes losslessly to all four accepted stereo float32 banks',async()=>{
 const layers=await unpackEngine(new Uint8Array(readFileSync('assets/'+ENGINE_ASSET)));
 expect(layers).toHaveLength(4);
 for(const [i,layer] of layers.entries()){
  expect(layer.id).toBe(ENGINE_BANKS[i].id);expect(layer.rpm).toBe(ENGINE_BANKS[i].rpm);
  expect(createHash('sha256').update(new Uint8Array(layer.bytes)).digest('hex')).toBe(ENGINE_BANKS[i].sha256);
  const wave=new DataView(layer.bytes);expect(wave.getUint16(20,true)).toBe(3); // IEEE float PCM, not a lossy conversion.
  expect(wave.getUint16(22,true)).toBe(2);expect(wave.getUint32(24,true)).toBe(44100);expect(wave.getUint16(34,true)).toBe(32);
 }
});
it('rejects damaged engine resources instead of silently choosing the dismissed live synth',async()=>{
 await expect(unpackEngine(new Uint8Array([1,2,3]))).rejects.toThrow();
 const data=new Uint8Array(readFileSync('assets/'+ENGINE_ASSET));data[100]^=1;
 await expect(unpackEngine(data)).rejects.toThrow();
});
