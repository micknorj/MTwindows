import {expect,it} from 'vitest';
import * as THREE from 'three';
import {GameView} from '../../src/rendering/view';
import {WorldUniforms} from '../../src/rendering/world-materials';
import {CHASE} from '../../src/vehicle/config';

// Exercise the real follow/rebase methods without creating a WebGL context.
function cameraRig(){
  return Object.assign(Object.create(GameView.prototype),{
    camera:new THREE.PerspectiveCamera(CHASE.baseFov,16/9,.1,6000),
    desired:new THREE.Vector3(),target:new THREE.Vector3(),look:new THREE.Vector3(),
    followed:new THREE.Vector2(),following:false,worldUniforms:new WorldUniforms(),
    moon:new THREE.DirectionalLight(),renderer:{domElement:{height:720}},
  }) as GameView;
}
it('keeps chase distance at 350 km/h across frame rates, turns and reversing',()=>{
  for(const dt of [1/30,1/60,1/144]){
    const view=cameraRig(),car={x:0,y:0,z:0,heading:0,speed:350/3.6},origin={x:0,z:0};
    view.follow(car,origin,0,true);
    for(let i=0;i<500;i++){
      car.heading=.22*Math.sin(i*dt*.4);car.speed=i<350?350/3.6:-20;
      car.x+=Math.sin(car.heading)*car.speed*dt;car.z+=Math.cos(car.heading)*car.speed*dt;
      view.follow(car,origin,dt);
      const distance=Math.hypot(view.camera.position.x-car.x,view.camera.position.z-car.z);
      expect(distance).toBeGreaterThan(CHASE.distance*.98);expect(distance).toBeLessThanOrEqual(CHASE.distance+.001);
    }
  }
});
it('rebases the follow anchor without introducing a false travel delta',()=>{
  const view=cameraRig(),car={x:995,y:20,z:995,heading:.3,speed:90},origin={x:0,z:0};
  view.follow(car,origin,0,true);car.x+=10;car.z+=10;
  view.rebase(1000,1000);origin.x=origin.z=1000;view.follow(car,origin,1/60);
  expect(Math.hypot(view.camera.position.x-(car.x-1000),view.camera.position.z-(car.z-1000))).toBeCloseTo(CHASE.distance,6);
});
