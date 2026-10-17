/** Shared, metre-scale contract for the later GLB handoff. Local +Z forward, +Y up. */
export const VEHICLE = { length: 4.95, width: 2.03, height: 1.131, wheelbase: 2.781373, track: 1.704958, wheelRadius: .3425 } as const;
export const CHASE = { distance: 8.2, height: 3.3, lookAhead: 8, targetHeight: .85, baseFov: 52, maxFov: 58, damping: 5 } as const;
