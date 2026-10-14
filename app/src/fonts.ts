// Native: the fonts ship inside the app, loaded through expo-font.
import { Jersey15_400Regular } from '@expo-google-fonts/jersey-15';
import { PixelifySans_400Regular, PixelifySans_600SemiBold, PixelifySans_700Bold } from '@expo-google-fonts/pixelify-sans';
import { Silkscreen_400Regular } from '@expo-google-fonts/silkscreen';
import { useFonts } from 'expo-font';

export function useAppFonts(): boolean {
  const [ok] = useFonts({ Jersey15_400Regular, PixelifySans_400Regular, PixelifySans_600SemiBold, PixelifySans_700Bold, Silkscreen_400Regular });
  return ok;
}
