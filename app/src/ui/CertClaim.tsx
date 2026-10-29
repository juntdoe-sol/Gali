/**
 * The Founding Miner certificate: the popup that tells a closed-beta miner they qualify and mints the NFT,
 * and the card the inventory shows once it is theirs.
 */
import { Image, Linking, Modal, Platform, Share, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { fmtDay, useNft, type CertStatus } from '../game/nft';
import { useGame } from '../game/store';
import { restBase } from '../game/world';
import { Btn, Frame, PixelBox, Scrim, T } from './kit';

const CARD = Platform.OS === 'web' ? require('../../assets/market/founding-miner.gif') : require('../../assets/market/founding-miner.png');
const STEP: Record<string, string> = {
  'signing-in': 'Sign the free sign-in message in your wallet...',
  building: 'Preparing your certificate...',
  wallet: 'Approve the mint in your wallet...',
  confirming: 'Waiting for Solana to confirm...',
};

/** The animated certificate card, 16:9. */
export function CertCard({ width }: { width: number }) {
  return <Image source={CARD} style={{ width, height: Math.round((width * 9) / 16), imageRendering: 'pixelated' } as never} fadeDuration={0} accessibilityLabel="Founding Miner certificate" />;
}

/** The certificate images, as the Founding Miner collection serves them. */
const certUrl = (ext: 'gif' | 'png') => `${restBase()}/storage/v1/object/public/gali-nft/cert/founding-miner.${ext}`;
const pad4 = (n: number) => String(n).padStart(4, '0');

function postText(cert: CertStatus) {
  const serial = cert.claim ? ` #${pad4(cert.claim.serial)}` : '';
  return `I'm Gali Founding Miner${serial}. I mined ${cert.rounds} ORE rounds on Gali Island in the closed beta, and my Legendary Jarl Helmet unlocks when the Gali NFT market opens. @Gali_Game`;
}

/** Save the certificate image: a real download in the browser, the share sheet on a phone app. */
export async function saveCert(ext: 'gif' | 'png', cert: CertStatus) {
  const url = certUrl(ext);
  const name = `gali-founding-miner${cert.claim ? '-' + pad4(cert.claim.serial) : ''}.${ext}`;
  try {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } else {
      await Share.share({ url, message: url, title: name });
    }
  } catch {
    useGame.getState().toast("Couldn't save the image. Try again", 'bad');
  }
}

/** Post on X. A phone browser that can share files attaches the GIF; otherwise X opens with the text and link. */
export async function postOnX(cert: CertStatus) {
  const text = postText(cert);
  const link = 'https://gali.lol';
  if (Platform.OS === 'web') {
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const blob = await (await fetch(certUrl('gif'))).blob();
      const file = new File([blob], 'gali-founding-miner.gif', { type: 'image/gif' });
      if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await nav.share({ files: [file], text: `${text} ${link}` });
        return;
      }
    } catch {
      /* fall through to the intent */
    }
    useGame.getState().toast('Tip: save the GIF first, then attach it to your post', 'info');
  }
  void Linking.openURL(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`);
}

/** Save GIF, Save PNG and Post on X, for a minted certificate. */
export function CertShare({ cert }: { cert: CertStatus }) {
  return (
    <View style={styles.share}>
      <Btn kind="plain" small label="SAVE GIF" onPress={() => void saveCert('gif', cert)} style={{ flex: 1 }} />
      <Btn kind="plain" small label="SAVE PNG" onPress={() => void saveCert('png', cert)} style={{ flex: 1 }} />
      <Btn kind="teal" small label="POST ON X" onPress={() => void postOnX(cert)} style={{ flex: 1.3 }} />
    </View>
  );
}

function Stats({ cert }: { cert: CertStatus }) {
  const serial = cert.claim?.status === 'minted' ? `#${String(cert.claim.serial).padStart(4, '0')}` : 'on claim';
  return (
    <View style={styles.stats}>
      {[
        ['BETA ROUNDS', String(cert.rounds)],
        ['FIRST DIG', fmtDay(cert.firstAt)],
        ['SERIAL', serial],
      ].map(([k, v]) => (
        <View key={k} style={styles.stat}>
          <T v="label" style={{ fontSize: 11 }}>
            {k}
          </T>
          <T v="display" style={{ fontSize: 20, lineHeight: 22, color: COLORS.gold }}>
            {v}
          </T>
        </View>
      ))}
    </View>
  );
}

export function CertClaimPopup() {
  const { popup, cert, claiming, error, minted, claim, later } = useNft();
  if (!popup || !cert?.eligible) return null;
  const done = cert.claim?.status === 'minted';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <Scrim onPress={claiming ? undefined : later}>
        <Frame tone="panel" glow={COLORS.gold} style={styles.box}>
          <T v="display" style={{ fontSize: 30, lineHeight: 32, color: COLORS.gold, textAlign: 'center', letterSpacing: 1 }}>
            {done ? 'FOUNDING MINER' : 'YOU ARE A FOUNDING MINER'}
          </T>
          <CertCard width={360} />
          <Stats cert={cert} />
          {done ? (
            <>
              <T style={{ textAlign: 'center' }}>Your certificate is in your wallet. It claims the Legendary Jarl Helmet when the Gali NFT market opens.</T>
              <CertShare cert={cert} />
              <Btn kind="ghost" label="VIEW ON SOLSCAN" onPress={() => void Linking.openURL(`https://solscan.io/token/${minted ?? cert.claim?.asset}`)} />
              <Btn kind="gold" label="NICE" onPress={later} />
            </>
          ) : (
            <>
              <T style={{ textAlign: 'center' }}>
                You mined ORE on Gali Island during the closed beta. Claim your Founding Miner certificate NFT: it stays in your wallet for good and claims the Legendary Jarl Helmet when the NFT market opens.
              </T>
              <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                You pay the mint: Solana rent and network fee, shown in your wallet before you approve. One per wallet.
              </T>
              {claiming ? (
                <PixelBox fill="rgba(62,230,255,0.1)" hi={COLORS.teal} lo="#04060f" style={{ padding: 10 }}>
                  <T v="bold" style={{ textAlign: 'center', color: COLORS.teal }}>
                    {STEP[claiming]}
                  </T>
                </PixelBox>
              ) : null}
              {error ? (
                <T v="bold" style={{ textAlign: 'center', color: COLORS.red }}>
                  {error}
                </T>
              ) : null}
              <Btn kind="gold" label={cert.open ? (claiming ? 'CLAIMING...' : 'CLAIM CERTIFICATE') : 'MINT OPENS SOON'} disabled={!cert.open || !!claiming} onPress={() => void claim()} />
              <Btn kind="ghost" label="LATER" disabled={!!claiming} onPress={later} />
            </>
          )}
        </Frame>
      </Scrim>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: { width: 400, maxWidth: '100%', padding: 18, gap: 10, alignItems: 'center' },
  stats: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  stat: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(4,6,15,0.55)', paddingVertical: 6 },
  share: { flexDirection: 'row', gap: 6, alignSelf: 'stretch' },
});
