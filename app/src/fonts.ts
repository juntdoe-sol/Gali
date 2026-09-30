// Native: the fonts ship inside the app, loaded through expo-font.
import { ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { Jersey15_400Regular } from '@expo-google-fonts/jersey-15';
import { useFonts } from 'expo-font';

export function useAppFonts(): boolean {
  const [ok] = useFonts({ Jersey15_400Regular, ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold });
  return ok;
}
