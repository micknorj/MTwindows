import { ShaderChunk } from 'three';

/** Skip projector/shading work only when Three's own cone/range attenuation is
 * exactly zero. Both lights still evaluate independently wherever they contribute.
 * Cookie/depth textures have no mip chain, so branching does not change LOD.
 */
export function finiteSpotLightChunk(source = ShaderChunk.lights_fragment_begin) {
  const block = /(getSpotLightInfo\( spotLight, geometryPosition, directLight \);)([\s\S]*?)(\n\t}\n\t#pragma unroll_loop_end)/;
  if (!block.test(source)) throw new Error('Unsupported spotlight shader layout');
  return source.replace(block, '$1\n\t\tif ( directLight.visible ) { // rimmile finite-light begin$2\n\t\t} // rimmile finite-light end$3');
}
export const FINITE_LIGHTS_FRAGMENT = finiteSpotLightChunk().replace(
 /getShadow\( directionalShadowMap\[ i \][^;]+?vDirectionalShadowCoord\[ i \] \)/g,
 expression=>`mix(1.0, ${expression}, smoothstep(0.0,.12,min(min(vDirectionalShadowCoord[i].x/vDirectionalShadowCoord[i].w,1.0-vDirectionalShadowCoord[i].x/vDirectionalShadowCoord[i].w),min(vDirectionalShadowCoord[i].y/vDirectionalShadowCoord[i].w,1.0-vDirectionalShadowCoord[i].y/vDirectionalShadowCoord[i].w))))`,
);
