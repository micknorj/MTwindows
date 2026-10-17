import * as THREE from 'three';
import {assetUrl} from '../assets';

const urls = [
  [assetUrl('textures/surfaces/asphalt_02-albedo.webp'), assetUrl('textures/surfaces/asphalt_02-surface.webp')],
  [assetUrl('textures/surfaces/forest_floor-albedo.webp'), assetUrl('textures/surfaces/forest_floor-surface.webp')],
  [assetUrl('textures/surfaces/rock_face-albedo.webp'), assetUrl('textures/surfaces/rock_face-surface.webp')],
  [assetUrl('textures/surfaces/gravelly_sand-albedo.webp'), assetUrl('textures/surfaces/gravelly_sand-surface.webp')],
  [assetUrl('textures/surfaces/grass_path_2-albedo.webp'), assetUrl('textures/surfaces/grass_path_2-surface.webp')],
];
const SIZE = 1024;

/** Five physical surfaces share two samplers, regardless of chunk/instance count. */
export class SurfaceTextures {
  readonly albedo: THREE.DataArrayTexture;
  readonly surface: THREE.DataArrayTexture;
  readonly ready: Promise<void>;
  private requests = new Set<AbortController>();
  private disposed = false;
  constructor(private renderer: THREE.WebGLRenderer) {
    const make = () => {
      const texture = new THREE.DataArrayTexture(null, SIZE, SIZE, urls.length);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true; texture.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
      // Allocate storage only. Decoded images go directly into individual layers;
      // canvas readback is privacy-protected in Firefox-family browsers.
      texture.source.dataReady=false;texture.needsUpdate=true;return texture;
    };
    this.albedo = make(); this.surface = make(); this.albedo.colorSpace = THREE.SRGBColorSpace;
    this.ready = this.load(); void this.ready.catch(() => {});
  }
  private async image(url: string) {
    const request=new AbortController();this.requests.add(request);let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;request.abort();},20000);
    try{
      const response=await fetch(url,{signal:request.signal});
      if(!response.ok)throw new Error('Surface request failed');
      return await response.blob();
    }catch{
      throw new Error(this.disposed?'Surface loading was interrupted.':timedOut?'The landscape textures took too long to load. Please retry.':'The landscape textures could not be loaded. Please retry.');
    }finally{clearTimeout(timer);this.requests.delete(request);}
  }
  private async load() {
    const images = await Promise.all(urls.flat().map(url => this.image(url)));
    if (this.disposed) return;
    for (let i=0;i<images.length;i++) {
      const target = i % 2 ? this.surface : this.albedo;
      // Flip before upload: WebGL2 array uploads require unpack flipY=false.
      // No premultiplication/color conversion: alpha holds AO in packed maps.
      const bitmap=await createImageBitmap(images[i],{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
      const source=new THREE.Texture(bitmap);source.flipY=false;source.colorSpace=target.colorSpace;
      try {
        if(this.disposed)return;
        if(bitmap.width!==SIZE||bitmap.height!==SIZE)throw new Error('Invalid landscape texture dimensions.');
        this.renderer.copyTextureToTexture(source,target,null,new THREE.Vector3(0,0,Math.floor(i/2)));
      } finally { source.dispose();bitmap.close(); }
    }
    if(this.renderer.getContext().getError()!==WebGL2RenderingContext.NO_ERROR)throw new Error('The landscape textures could not be uploaded. Please retry.');
  }
  dispose() {
    this.disposed = true;for(const request of this.requests)request.abort();
    this.requests.clear();this.albedo.dispose();this.surface.dispose();
  }
}
