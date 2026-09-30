// Android/iOS: the canvas runs in a WebView with no server behind it, so the
// atlas bundled with the app is read here and handed over as a data URI.
import { Asset } from 'expo-asset';
import { readAsStringAsync } from 'expo-file-system/legacy';

export async function atlasSource(): Promise<string> {
  const asset = Asset.fromModule(require('../../assets/pixel/atlas.png'));
  await asset.downloadAsync();
  const b64 = await readAsStringAsync(asset.localUri ?? asset.uri, { encoding: 'base64' });
  return `data:image/png;base64,${b64}`;
}
