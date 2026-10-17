import {describe,it,expect} from 'vitest';
import {engineAudioRpm} from '../../src/audio/audio-rpm';

describe('live audio calibration to demo11',()=>{
  it('preserves idle and maps physical redline to the accepted demo peak',()=>{
    expect(engineAudioRpm(900)).toBe(900);expect(engineAudioRpm(9600)).toBe(7800);
    expect(engineAudioRpm(4500)).toBeCloseTo(3755.1724,3);
  });
  it('stays continuous, monotonic and bounded through acceleration and gear changes',()=>{
    let previous=650;
    for(let rpm=650;rpm<=10000;rpm+=25){const audible=engineAudioRpm(rpm);expect(audible).toBeGreaterThanOrEqual(previous);expect(audible).toBeLessThanOrEqual(7800);previous=audible;}
    expect(engineAudioRpm(6500)).toBeLessThan(engineAudioRpm(8900));
  });
  it('handles invalid inputs without forwarding invalid automation',()=>{
    expect(engineAudioRpm(NaN)).toBe(900);expect(engineAudioRpm(Infinity)).toBe(900);expect(engineAudioRpm(-100)).toBe(650);
  });
});
