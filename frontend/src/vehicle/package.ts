/** Incorporated game resource, not a standalone model download.
 * The client key is necessarily public. Packaging deters casual reuse; it is not
 * DRM and does not make a browser-delivered model impossible to extract.
 */
export const VEHICLE_ASSET = 'models/rimmile-vehicle.bin';
export const VEHICLE_SHA256 = '7980bcc8059c823377352bef1091088ede0385e6a8551712bdb90ce8cd024288';
export const VEHICLE_HEADER = new TextEncoder().encode('RIMMILE-CAR-v1\0\0');
export const VEHICLE_KEY = Uint8Array.from('361f7f63c53f1f130687066352f3538ac4b09dfd496488253b2bfa40b91139257'.match(/../g)!, pair => parseInt(pair, 16));
export async function unpackVehicle(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  if (bytes.length < 44 || !VEHICLE_HEADER.every((value, i) => bytes[i] === value)) throw new Error('Invalid vehicle resource. Retry to load again.');
  const key = await crypto.subtle.importKey('raw', VEHICLE_KEY, 'AES-GCM', false, ['decrypt']);
  const decoded = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.slice(16, 28), additionalData: VEHICLE_HEADER}, key, bytes.slice(28));
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', decoded)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== VEHICLE_SHA256) throw new Error('Vehicle integrity check failed. Retry to load again.');
  return decoded;
}
