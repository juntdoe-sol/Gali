import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { PIX, type PixName } from './pixIcons';

/**
 * A small pixel-art icon. The art is 16x16 and shipped at 4x, so sizes of 16, 32 and 48
 * stay crisp; the web build also asks the browser not to smooth it.
 */
export function PixIcon({ name, size = 32, style }: { name: PixName; size?: number; style?: StyleProp<ImageStyle> }) {
  return <Image source={PIX[name]} style={[{ width: size, height: size }, { imageRendering: 'pixelated' } as ImageStyle, style]} fadeDuration={0} accessibilityElementsHidden importantForAccessibility="no" />;
}
