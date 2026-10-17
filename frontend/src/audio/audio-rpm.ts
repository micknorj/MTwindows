/** Preserve the accepted demo11 timbre/range while following the real gearbox.
 * Physics reaches 9600 RPM; demo11's highest audible input was 7800 RPM.
 * Idle stays at 900. This affects audio only, never torque or shift thresholds. */
export function engineAudioRpm(physicalRpm:number){
  if(!Number.isFinite(physicalRpm))return 900;
  const rpm=Math.max(650,Math.min(9600,physicalRpm));
  return rpm<=900?rpm:900+(rpm-900)*(6900/8700);
}
