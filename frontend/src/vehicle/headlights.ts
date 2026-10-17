import * as THREE from 'three';

/** Analytic form of the projector cookie for sampler-constrained materials. */
export const HEADLIGHT_PROFILE_GLSL = `
vec4 rtHeadlightProfile(vec2 uv) {
  vec2 p=uv*2.0-1.0;
  float cutoff=1.0-clamp((p.y-.04)/.1,0.0,1.0);
  return vec4(vec3(exp(-p.x*p.x*2.1-(p.y+.12)*(p.y+.12)*19.0)*cutoff),1.0);
}
`;

/** Two physical projectors; neither illumination nor occlusion is centred on the car. */
export function createHeadlights(parent: THREE.Group) {
  // An elliptical projector profile and soft upper cutoff, shared by both lamps.
  // This shapes the light itself rather than painting a beam onto the road.
  const data = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u=x/127*2-1, v=y/127*2-1;
    const cutoff=1-Math.min(1,Math.max(0,(v-.04)/.1));
    const power=Math.exp(-u*u*2.1-(v+.12)*(v+.12)*19)*cutoff;
    const i=(y*128+x)*4; data[i]=data[i+1]=data[i+2]=Math.round(power*255); data[i+3]=255;
  }
  const profile = new THREE.DataTexture(data,128,128); profile.needsUpdate=true;
  profile.minFilter=profile.magFilter=THREE.LinearFilter;
  return [1, -1].map(side => {
    const light = new THREE.SpotLight(0xf3f5ff, 1800, 125, .55, .85, 2);
    light.map=profile;
    light.position.set(side * .76, .63, 2.46);
    light.target.position.set(side * 1.05, -.18, 52);
    light.castShadow = true;
    light.shadow.mapSize.set(768, 768);
    light.shadow.camera.near = .3; light.shadow.camera.far = 125;
    light.shadow.bias = -.00008; light.shadow.normalBias = .025; light.shadow.radius = 2;
    parent.add(light, light.target); return light;
  });
}
