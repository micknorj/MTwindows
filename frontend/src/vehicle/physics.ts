import type {DriveInput} from '../input/keyboard';
import {clamp,smooth,landscapeNoise,nearestRoad,bridgeAt,roadAt,roadSurface,ROAD_HALF_WIDTH,tunnelAt} from '../world/road';
import {surfaceHeight,waterDepth,vehicleSubmerged,tunnelRoofHeight,bridgeCeiling} from '../world/surface';
import {VEHICLE} from './config';
import {DEFAULT_BODY,penetration,type Obstacle} from './collider';
import {Drivetrain} from './drivetrain';
import {tunnelCeiling} from '../world/tunnels';
import {DEFAULT_HANDLING,handlingFactors,type Handling} from './handling';
import {CENTRE_Z,DYNAMICS as D,tireForces,wheelX,wheelZ} from './dynamics';

export class VehiclePhysics {
  colliders=DEFAULT_BODY;
  submerged=false;
  distanceTravelled=0;
  private calibration=handlingFactors(DEFAULT_HANDLING);
  get handling(){return {...this.calibration};}
  setHandling(value:Handling){this.calibration=handlingFactors(value);}
  readonly drivetrain=new Drivetrain();
  x=0;z=0;y=0;heading=0;speed=0;steer=0;pitch=0;roll=0;
  lateralSpeed=0;yawRate=0;slip=0;acceleration=0;braking=false;
  readonly wheelTravel=[0,0,0,0]; // FL, FR, RL, RR.
  readonly wheelContact=[true,true,true,true];
  readonly wheelLoad=[0,0,0,0];
  readonly wheelAngular=[0,0,0,0];
  readonly wheelSteer=[0,0,0,0];
  readonly wheelSlip=[0,0,0,0];
  obstacles:readonly(readonly Obstacle[])[]=[];
  impacts=0;impactStrength=0;impactMaterial='stone';
  private verticalSpeed=0;private pitchSpeed=0;private rollSpeed=0;
  private tireLateral=[0,0,0,0];
  private heights=[0,0,0,0];private previousHeights=[0,0,0,0];
  private wheelsInitialized=false;
  constructor(readonly seed:number,private readonly groundHeight=(x:number,z:number)=>surfaceHeight(x,z,seed,this),private readonly surfaceGrip=(x:number,z:number)=>{
    const road=roadSurface(z,seed),distance=Math.abs(x-road.x);
    const shoulder=1.24+( .94-1.24)*smooth((distance-3.3)/1.2);
    const soil=.81+.07*landscapeNoise(x/70,z/90,seed+311);
    if(this.y<road.y-.5&&bridgeAt(z,seed).active)return soil;
    return shoulder+(soil-shoulder)*smooth((distance-4.7)/2.5);
  }){this.recover();}
  recover(){
    this.submerged=false;
    const p=nearestRoad(this.x,this.z,this.seed);
    this.z=p.z+Math.sin(p.heading)*1.7;this.x=p.x-Math.cos(p.heading)*1.7;
    this.heading=p.heading;this.speed=0;this.steer=0;
    this.lateralSpeed=0;this.yawRate=0;this.acceleration=0;this.slip=0;this.braking=false;
    this.verticalSpeed=0;this.pitchSpeed=0;this.rollSpeed=0;this.drivetrain.reset();
    this.wheelAngular.fill(0);this.wheelSteer.fill(0);this.wheelSlip.fill(0);this.tireLateral.fill(0);this.wheelsInitialized=false;
    this.y=roadSurface(this.z,this.seed).y;
    this.sampleGround();
    this.y=this.heights.reduce((s,h)=>s+h,0)/4;
    this.pitch=-Math.atan2((this.heights[0]+this.heights[1]-this.heights[2]-this.heights[3])/2,VEHICLE.wheelbase);
    this.roll=Math.atan2((this.heights[0]+this.heights[2]-this.heights[1]-this.heights[3])/2,VEHICLE.track);
    this.previousHeights=[...this.heights];this.suspension(0);
  }
  get offRoad(){return Math.abs(this.x-roadSurface(this.z,this.seed).x)>ROAD_HALF_WIDTH;}
  setSpeed(speed:number){this.verticalSpeed-=(speed-this.speed)*Math.sin(this.pitch);this.speed=speed;this.wheelAngular.fill(speed/VEHICLE.wheelRadius);this.wheelsInitialized=true;}
  step(dt:number,input:DriveInput){
    if(!Number.isFinite(dt)||dt<=0)return;
    if(!this.wheelsInitialized){this.wheelAngular.fill(this.speed/VEHICLE.wheelRadius);this.wheelsInitialized=true;}
    // 240 Hz minimum, with translation steps below 0.4 m in the speed envelope.
    const count=Math.min(24,Math.max(1,Math.ceil(dt*240),Math.ceil(Math.hypot(this.speed,this.lateralSpeed)*dt/.4)));
    for(let i=0;i<count;i++)this.integrate(dt/count,input);
  }
  private sampleGround(){
    const c=Math.cos(this.heading),s=Math.sin(this.heading);
    for(let i=0;i<4;i++)this.heights[i]=this.groundHeight(this.x+c*wheelX(i)+s*wheelZ(i),this.z-s*wheelX(i)+c*wheelZ(i));
  }
  private suspension(dt:number){
    const velocity=Math.abs(this.speed),cos=Math.cos(this.pitch)*Math.cos(this.roll);
    for(let i=0;i<4;i++){
      const axle=i<2?0:1,share=axle===0?D.frontWeight:1-D.frontWeight;
      const travel=this.heights[i]-this.y+Math.sin(this.pitch)*wheelZ(i)-Math.sin(this.roll)*wheelX(i);
      this.wheelContact[i]=travel>=-.18;this.wheelTravel[i]=clamp(travel,-.18,.14);
      const roadVelocity=dt>0&&Math.abs(this.heights[i]-this.previousHeights[i])<.25?(this.heights[i]-this.previousHeights[i])/dt:0;
      const compressionVelocity=clamp(roadVelocity-this.verticalSpeed+this.pitchSpeed*(wheelZ(i)-CENTRE_Z)-this.rollSpeed*wheelX(i),-6,6);
      const preload=D.mass*D.gravity*share/2*Math.max(.3,cos),aero=D.downforce[axle]*velocity*velocity/2;
      const spring=preload+aero+D.spring[axle]*travel+D.damper[axle]*compressionVelocity+600000*Math.max(0,travel-.1)**2;
      this.wheelLoad[i]=this.wheelContact[i]?clamp(spring,0,preload*4+aero):0;
      this.previousHeights[i]=this.heights[i];
    }
    for(let axle=0;axle<2;axle++){
      const l=axle*2,r=l+1;
      if(this.wheelContact[l]&&this.wheelContact[r]){
        const bar=D.antiRoll[axle]*(this.wheelTravel[l]-this.wheelTravel[r]);
        this.wheelLoad[l]=Math.max(0,this.wheelLoad[l]+bar);this.wheelLoad[r]=Math.max(0,this.wheelLoad[r]-bar);
      }
    }
  }
  private integrate(dt:number,input:DriveInput){
    if(!this.submerged&&vehicleSubmerged(this,this.colliders,this.seed))this.submerged=true;
    // Flooding removes driver/engine authority, not gravity, suspension or collisions.
    if(this.submerged)input={throttle:false,brake:false,steer:0};
    this.sampleGround();this.suspension(dt);
    const depth=waterDepth(this.x,this.z,this.seed,this.y),velocity=Math.abs(this.speed);
    // Usable keyboard cornering authority, including aero, without full lock at speed.
    const availableCornering=this.surfaceGrip(this.x,this.z)*this.calibration.grip*(D.gravity+(D.downforce[0]+D.downforce[1])*velocity*velocity/D.mass);
    const limit=Math.min(.5,Math.atan(availableCornering*.93*VEHICLE.wheelbase/(velocity*velocity+24)));
    this.steer+=(input.steer*limit-this.steer)*(1-Math.exp(-(input.steer===0?11:7.5)*dt));
    this.braking=input.brake;
    const throttle=input.throttle&&!input.brake?1:0;
    let drive=this.drivetrain.step(dt,this.speed,throttle);
    if(this.submerged)drive=0;
    const gradeZ=(this.heights[0]+this.heights[1]-this.heights[2]-this.heights[3])/2/VEHICLE.wheelbase;
    const gradeX=(this.heights[0]+this.heights[2]-this.heights[1]-this.heights[3])/2/VEHICLE.track;
    const gradient=Math.hypot(gradeX,gradeZ),terrainNormal=1/Math.sqrt(1+gradient*gradient);
    // The spring's vertical preload is not a cliff-normal tire load. Its former
    // use let AWD generate uphill force even against nearly vertical faces.
    const contactTraction=terrainNormal*(1-smooth((gradient-.7)/.8));
    let fx=0,fy=0,moment=0,softGround=0;
    const c0=Math.cos(this.heading),s0=Math.sin(this.heading);
    const bodySlip=Math.atan2(this.lateralSpeed,Math.max(3,velocity));
    const referenceYaw=this.speed*Math.tan(this.steer)/VEHICLE.wheelbase;
    const yawError=this.yawRate-referenceYaw;
    // Do not consume front grip braking into ordinary turn-in understeer.
    // Intervene for excessive rotation/sideslip, with tire forces still limiting it.
    const correction=velocity>8&&(Math.abs(bodySlip)>.05||yawError*Math.sign(referenceYaw)>Math.max(.025,Math.abs(referenceYaw)*.18))
      ?clamp(-D.yawInertia*3*yawError+7000*bodySlip,-3500,3500):0;
    for(let i=0;i<4;i++){
      const front=i<2,rx=wheelX(i),rz=wheelZ(i)-CENTRE_Z;
      const angle=front?Math.atan(Math.tan(this.steer)/(1-rx/VEHICLE.wheelbase*Math.tan(this.steer))):0;
      this.wheelSteer[i]=angle;const cs=Math.cos(angle),ss=Math.sin(angle);
      const longitudinal=this.speed-this.yawRate*rx,lateral=this.lateralSpeed+this.yawRate*rz;
      const u=front?longitudinal*cs+lateral*ss:longitudinal,v=front?lateral*cs-longitudinal*ss:lateral;
      const wx=this.x+c0*rx+s0*wheelZ(i),wz=this.z-s0*rx+c0*wheelZ(i);
      const surfaceMu=this.surfaceGrip(wx,wz);softGround+=Number(surfaceMu<1)/4;
      const staticLoad=D.mass*D.gravity*(front?D.frontWeight:1-D.frontWeight)/2,loadRatio=Math.max(.15,this.wheelLoad[i]/staticLoad);
      const mu=surfaceMu*contactTraction*(front?this.calibration.frontGrip:this.calibration.rearGrip)*Math.pow(loadRatio,-.07)/(1+depth*.7);
      let torque=drive*(front?D.frontDrive:1-D.frontDrive)/2*VEHICLE.wheelRadius;
      // Individual traction and ABS retain grip on split surfaces/unloaded wheels.
      if(throttle&&Math.abs(this.wheelSlip[i])>.12)torque*=Math.max(.15,.12/Math.abs(this.wheelSlip[i]));
      if(this.braking){
        const brake=Math.min(D.maximumBrake*D.mass*(front?D.frontBrake:1-D.frontBrake)/2,mu*this.wheelLoad[i]*.97);
        const sign=Math.sign(this.wheelAngular[i])||Math.sign(u);
        torque-=sign*Math.min(brake*VEHICLE.wheelRadius,Math.abs(this.wheelAngular[i])*D.wheelInertia/dt+Math.abs(torque));
      }
      // ESC applies a real outside-front brake force, bounded by the same
      // combined-slip tire envelope; it never directly overwrites yaw.
      if(front&&Math.sign(rx)===Math.sign(correction)*Math.sign(this.speed)){
        const stabilityBrake=Math.min(Math.abs(correction)/(VEHICLE.track/2),mu*this.wheelLoad[i]*.55);
        torque-=Math.sign(this.speed)*stabilityBrake*VEHICLE.wheelRadius;
      }
      const tire=tireForces(this.wheelLoad[i],mu,D.cornering[front?0:1]*(front?this.calibration.frontStiffness:this.calibration.rearStiffness)*Math.pow(loadRatio,.85),u,v,this.wheelAngular[i],torque,dt,this.tireLateral[i]);
      this.tireLateral[i]=tire.lateral;this.wheelAngular[i]=tire.omega;this.wheelSlip[i]=tire.slip;
      const tireX=front?tire.longitudinal*cs-tire.lateral*ss:tire.longitudinal;
      const tireY=front?tire.lateral*cs+tire.longitudinal*ss:tire.lateral;
      fx+=tireX;fy+=tireY;moment+=rz*tireY-rx*tireX;
    }
    let contacts=0;for(let i=0;i<4;i++)contacts+=Number(this.wheelLoad[i]>0)/4;
    const downforce=(D.downforce[0]+D.downforce[1])*velocity*velocity;
    const resistance=Math.sign(this.speed)*(220*contacts+D.drag*velocity*velocity+downforce*.04+softGround*velocity*110*contacts+depth*velocity*900);
    const oldSpeed=this.speed,oldHeading=this.heading;
    this.acceleration=(fx-resistance)/D.mass-D.gravity*gradeZ*terrainNormal*contacts+this.lateralSpeed*this.yawRate;
    this.speed+=this.acceleration*dt;
    this.lateralSpeed+=(fy/D.mass-D.gravity*gradeX*terrainNormal*contacts-this.speed*this.yawRate)*dt;
    this.yawRate+=moment/D.yawInertia*dt;
    // Dissipative stability aid beyond the tire envelope, with no kinematic yaw override.
    if(contacts>0){
      const maxYaw=(1.24*this.calibration.grip*D.gravity+downforce/D.mass)/Math.max(3,velocity);
      if(Math.abs(this.yawRate)>maxYaw*1.25)this.yawRate*=Math.exp(-3*dt);
    }
    if(oldSpeed*this.speed<0&&(this.braking||throttle===0))this.speed=0;
    if(throttle===0&&contacts>.5&&Math.abs(this.speed)<.18&&Math.abs(this.lateralSpeed)<.12&&Math.hypot(gradeX,gradeZ)<.3){
      this.speed=0;this.lateralSpeed=0;this.yawRate*=Math.exp(-14*dt);this.wheelAngular.fill(0);
    }
    this.slip=Math.abs(this.lateralSpeed)/Math.max(3,velocity);
    for(let i=0;i<4;i++)this.slip=Math.max(this.slip,Math.abs(this.wheelSlip[i]));
    this.slip=Math.min(1,this.slip);
    if(this.submerged){
      // Stable drag in all axes, with no buoyancy or artificial position lock.
      const drag=Math.exp(-(1.4+Math.min(3,depth)) * dt);
      this.speed*=drag;this.lateralSpeed*=drag;this.yawRate*=Math.exp(-4*dt);
      this.verticalSpeed*=Math.exp(-2*dt);this.pitchSpeed*=Math.exp(-3*dt);this.rollSpeed*=Math.exp(-3*dt);
    }
    // Integrate physical travel before contact depenetration. Recovery and inspection
    // never increment it; steering-root corrections and suspension bob are excluded.
    this.distanceTravelled+=Math.hypot(this.speed,this.lateralSpeed)*dt*Math.sqrt(1+gradeZ*gradeZ);
    this.heading+=this.yawRate*dt;
    const c=Math.cos(this.heading),s=Math.sin(this.heading);
    // CoG velocity, exported visual root between axles.
    this.x+=(s*this.speed+c*this.lateralSpeed)*terrainNormal*dt+(Math.sin(oldHeading)-s)*CENTRE_Z;
    this.z+=(c*this.speed-s*this.lateralSpeed)*terrainNormal*dt+(Math.cos(oldHeading)-c)*CENTRE_Z;
    this.bodyMotion(dt,fx,fy,downforce);
    const ceiling=this.clearanceCeiling(this.x,this.z);
    if(Number.isFinite(ceiling)&&(!tunnelAt(this.z,this.seed)||this.y<tunnelRoofHeight(this.x,this.z,this.seed)-.3)){
      let allowed=Infinity;const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),cr=Math.cos(this.roll),sr=Math.sin(this.roll);
      for(const box of this.colliders)for(const sx of [-1,1])for(const sz of [-1,1]){
        const lx=box.centre[0]+sx*box.halfExtents[0],ly=box.centre[1]+box.halfExtents[1],lz=box.centre[2]+sz*box.halfExtents[2];
        const rx=cr*lx-sr*ly,ry=sr*lx+cr*ly,py=cp*ry-sp*lz,pz=sp*ry+cp*lz;
        allowed=Math.min(allowed,this.clearanceCeiling(this.x+c*rx+s*pz,this.z-s*rx+c*pz)-py);
      }
      if(this.y>allowed){this.y=allowed;this.verticalSpeed=Math.min(0,this.verticalSpeed);this.pitchSpeed*=.5;this.rollSpeed*=.5;}
    }
    this.resolveCollisions(c,s);
    this.sampleGround();
    for(let i=0;i<4;i++){
      const travel=this.heights[i]-this.y+Math.sin(this.pitch)*wheelZ(i)-Math.sin(this.roll)*wheelX(i);
      this.wheelTravel[i]=clamp(travel,-.18,.14);this.wheelContact[i]=travel>=-.18;
    }
  }
  private clearanceCeiling(x:number,z:number){return Math.min(tunnelCeiling(x,z,this.seed),bridgeCeiling(x,z,this.seed,this.y));}
  private bodyMotion(dt:number,fx:number,fy:number,downforce:number){
    let vertical=0,pitch=0,roll=0;
    for(let i=0;i<4;i++){const load=this.wheelLoad[i];vertical+=load;pitch-=(wheelZ(i)-CENTRE_Z)*load;roll+=wheelX(i)*load;}
    this.verticalSpeed+=clamp((vertical-downforce)/D.mass-D.gravity,-D.gravity,40)*dt;
    this.y+=this.verticalSpeed*dt;this.pitchSpeed+=(pitch-D.centreHeight*fx)/D.pitchInertia*dt;this.rollSpeed+=(roll+D.centreHeight*fy)/D.rollInertia*dt;
    this.pitch=clamp(this.pitch+this.pitchSpeed*dt,-.75,.75);this.roll=clamp(this.roll+this.rollSpeed*dt,-.8,.8);
    // Bump stops absorb penetration without launching the body.
    let floor=-Infinity;
    for(let i=0;i<4;i++)floor=Math.max(floor,this.heights[i]+Math.sin(this.pitch)*wheelZ(i)-Math.sin(this.roll)*wheelX(i)-.14);
    if(this.y<floor){this.y=floor;this.verticalSpeed=Math.max(0,this.verticalSpeed);}
    if(Math.abs(this.pitch)===.75)this.pitchSpeed=0;if(Math.abs(this.roll)===.8)this.rollSpeed=0;
  }
  private resolveCollisions(c:number,s:number){
    for(let pass=0;pass<3;pass++)for(const batch of this.obstacles)for(const obstacle of batch){
      if(Math.abs(obstacle.x-this.x)>obstacle.halfX+obstacle.halfZ+4||Math.abs(obstacle.z-this.z)>obstacle.halfX+obstacle.halfZ+4)continue;
      const contact=penetration(this.x,this.y,this.z,this.heading,this.colliders,obstacle);if(!contact)continue;
      const rx=clamp(contact.x-this.x-s*CENTRE_Z,-2.6,2.6),rz=clamp(contact.z-this.z-c*CENTRE_Z,-2.6,2.6);
      this.x+=contact.nx*(contact.depth+.001);this.z+=contact.nz*(contact.depth+.001);
      let vx=s*this.speed+c*this.lateralSpeed,vz=c*this.speed-s*this.lateralSpeed;
      const lever=rz*contact.nx-rx*contact.nz,normalSpeed=vx*contact.nx+vz*contact.nz+this.yawRate*lever;
      if(normalSpeed>=0)continue;
      this.impactStrength=-normalSpeed;this.impactMaterial=obstacle.material??'stone';if(-normalSpeed>.8)this.impacts++;
      const restitution=-normalSpeed<5?(obstacle.material==='metal'?.015:.03):0;
      const impulse=-(1+restitution)*normalSpeed/(1/D.mass+lever*lever/D.yawInertia);
      vx+=impulse/D.mass*contact.nx;vz+=impulse/D.mass*contact.nz;this.yawRate+=impulse/D.yawInertia*lever;
      const tx=-contact.nz,tz=contact.nx,tangentLever=rz*tx-rx*tz;
      const tangentSpeed=vx*tx+vz*tz+this.yawRate*tangentLever,friction=obstacle.material==='metal'?.25:obstacle.material==='wood'?.4:.5;
      const tangentImpulse=clamp(-tangentSpeed/(1/D.mass+tangentLever*tangentLever/D.yawInertia),-friction*impulse,friction*impulse);
      vx+=tangentImpulse/D.mass*tx;vz+=tangentImpulse/D.mass*tz;this.yawRate+=tangentImpulse/D.yawInertia*tangentLever;
      // Unsimulated crushing dissipates extreme spin; no visible damage state.
      this.yawRate=clamp(this.yawRate,-1.8,1.8);
      this.speed=vx*s+vz*c;this.lateralSpeed=vx*c-vz*s;if(Math.hypot(vx,vz)<.15){this.speed=0;this.lateralSpeed=0;}
    }
  }
  placeOnRoad(z:number){this.z=z;this.x=roadAt(z,this.seed).x;this.recover();}
}
