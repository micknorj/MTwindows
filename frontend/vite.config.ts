import { defineConfig, loadEnv, type Plugin } from 'vite';
import { publicAssetPlugin } from '../scripts/asset-plugin.mjs';
import { checkedPagesBase } from '../scripts/asset-manifest.mjs';

// AudioWorklet modules live in a separate realm: hot-swapping their URL does
// not replace a processor already registered in the running AudioContext.
function reloadAudio():Plugin{
  return {name:'reload-audio-worklet',apply:'serve',handleHotUpdate({file,server}){
    if(file.replaceAll('\\','/').includes('/frontend/src/audio/')){
      server.ws.send({type:'full-reload',path:'*'});return [];
    }
  }};
}

export default defineConfig(({ mode,command,isPreview }) => {
 const env=loadEnv(mode,process.cwd(),'VITE_');
 const pagesBase=checkedPagesBase(process.env.VITE_PAGES_BASE_PATH??env.VITE_PAGES_BASE_PATH??'/rimmile/');
 return {
  root:'frontend',
  publicDir:false,
  base: command==='build'||isPreview?pagesBase:'/',
  plugins: [publicAssetPlugin(command==='build',process.env.VITE_ASSET_BASE_URL??env.VITE_ASSET_BASE_URL??'',pagesBase),reloadAudio()],
  server: { hmr: mode === 'test' ? false : undefined, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/model-optimization/**','**/.private/**'] } },
  build: { target: 'es2022', outDir:'../dist/frontend',emptyOutDir:true },
 };
});
