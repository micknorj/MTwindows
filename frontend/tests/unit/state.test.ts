import {expect,it} from 'vitest';
import {transition} from '../../src/app/state';
it('uses explicit menu/back navigation and never resumes from focus',()=>{
  expect(transition('running','blur')).toBe('paused');
  expect(transition('paused','ready')).toBe('paused');
  expect(transition('paused','resume')).toBe('running');
  expect(transition('running','escape')).toBe('paused');
  expect(transition('paused','escape')).toBe('running');
  for(const root of ['landing','paused'] as const)for(const page of ['settings','about'] as const){
    const screen=transition(root,page);
    expect(screen).toBe(`${root}-${page}`);
    expect(transition(screen,'escape')).toBe(root);
    expect(transition(screen,'back')).toBe(root);
    expect(transition(screen,'blur')).toBe(screen);
  }
});
it('ignores stale readiness and permits settings through loading/failure',()=>{
  expect(transition('landing','play')).toBe('loading');
  expect(transition('loading','fail')).toBe('error');
  expect(transition('error','ready')).toBe('error');
  expect(transition('error','settings')).toBe('landing-settings');
  expect(transition('loading','about')).toBe('landing-about');
  expect(transition('loading','ready')).toBe('running');
});
