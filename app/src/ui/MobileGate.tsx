/**
 * Gali in a phone or tablet browser: it plays on a computer browser, or in the Android app. This screen
 * says so and links the app. The Android app itself is never stopped here (it is not a browser).
 */
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

/** the repo page: its README links the latest APK */
const APK_URL = 'https://github.com/juntdoe-sol/Gali#readme';

function isMobileBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  // test mode for the phone layout (?land=1) stays open
  if (/[?&]land=1\b/.test(window.location?.search ?? '')) return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
  // iPadOS reports itself as a Mac; it is the only "Mac" with a touch screen
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}
export const MOBILE_BROWSER = isMobileBrowser();

const GOLD = '#ffc93c';

export function MobileGate() {
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Image source={require('../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>PLAY ON A COMPUTER</Text>
        <Text style={styles.body}>Gali runs in a desktop browser. Open betatest.gali.lol on your computer in Chrome, Brave, Edge or Firefox.</Text>
        {android ? (
          <>
            <Text style={styles.body}>On an Android phone, play in the Gali app instead.</Text>
            <Pressable onPress={() => void Linking.openURL(APK_URL)} accessibilityRole="link" style={({ pressed }) => [styles.btn, pressed && { transform: [{ translateY: 2 }] }]}>
              <Text style={styles.btnText}>GET THE ANDROID APP</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070d20', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#0e1838', borderWidth: 3, borderColor: GOLD, padding: 22, alignItems: 'center', gap: 14 },
  logo: { width: 180, height: 76 },
  title: { color: GOLD, fontSize: 22, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  body: { color: '#e8ecff', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  btn: { backgroundColor: GOLD, paddingVertical: 14, paddingHorizontal: 20, alignSelf: 'stretch', alignItems: 'center', borderBottomWidth: 4, borderColor: '#b07a10' },
  btnText: { color: '#2a1a00', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
});
