// Web: index.html has already preloaded the atlas from /pixel/atlas.png. The ?v= is the atlas's fingerprint
// (scripts/pixel-art.py), so a browser or CDN holding an older copy fetches the new art as soon as it ships.
import ART from '../engine/art.json';

export async function atlasSource(): Promise<string> {
  const v = (ART.atlas as { v?: string }).v;
  return v ? `/pixel/atlas.png?v=${v}` : '/pixel/atlas.png';
}
