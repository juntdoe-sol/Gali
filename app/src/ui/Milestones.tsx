/**
 * Milestone certificates: Level 10 (one random Rare weapon) and Level 20 (one random Legendary weapon).
 *
 *  - MilestoneQuests: the Quest tab's "Milestones" list: Founding Miner, Reach Level 10, Reach Level 20, each with
 *    its progress and a claim button for the certificate NFT
 *  - MilestoneVault: the Bag's certificates for the two levels (claimed, ready to claim, or locked with progress)
 *
 * The level is the one the server worked out from verified XP, so what the quest shows is what the mint checks.
 */
import { Image, Linking, Platform, Share, StyleSheet, View, type ImageStyle } from 'react-native';
import { COLORS, levelFromXp, xpForLevel } from '../game/constants';
import { MILESTONE, MILESTONE_KINDS, useNft, type MilestoneKind, type Milestones } from '../game/nft';
import { useGame, useLevelXp } from '../game/store';
import { restBase } from '../game/world';
import { CertCard } from './CertClaim';
import { Bar, Btn, Card, Pill, T } from './kit';
import { Corners, Led, Readout, TECH, TechBtn } from './tech';

const PIX = { imageRendering: 'pixelated' } as ImageStyle;
const web = Platform.OS === 'web';
const ART: Record<MilestoneKind, number> = {
  lv10: web ? require('../../assets/market/level-10.gif') : require('../../assets/market/level-10.png'),
  lv20: web ? require('../../assets/market/level-20.gif') : require('../../assets/market/level-20.png'),
};
const STILL: Record<MilestoneKind, number> = { lv10: require('../../assets/market/level-10.png'), lv20: require('../../assets/market/level-20.png') };
const HUE: Record<MilestoneKind, string> = { lv10: '#5ab8ff', lv20: COLORS.gold };
const STEP: Record<string, string> = {
  'signing-in': 'Sign the free sign-in message in your wallet...',
  building: 'Preparing your certificate...',
  wallet: 'Approve the mint in your wallet...',
  confirming: 'Waiting for Solana to confirm...',
};
const pad4 = (n: number) => String(n).padStart(4, '0');

/** The certificate card, 16:9; animated on the web, `still` for a small thumbnail. */
export function MilestoneArt({ kind, width, dim, still }: { kind: MilestoneKind; width: number; dim?: boolean; still?: boolean }) {
  return (
    <Image
      source={still ? STILL[kind] : ART[kind]}
      style={[{ width, height: Math.round((width * 9) / 16), opacity: dim ? 0.45 : 1 }, PIX]}
      fadeDuration={0}
      accessibilityLabel={`${MILESTONE[kind].title} certificate`}
    />
  );
}

/** Level and XP: the server's verified numbers once known, the game's own before that. */
function useLevel(ms: Milestones | null | undefined) {
  const localXp = useLevelXp();
  const xp = ms ? ms.xp : localXp;
  return { xp, level: ms ? ms.level : levelFromXp(localXp) };
}

const fileUrl = (kind: MilestoneKind, ext: 'gif' | 'png') => `${restBase()}/storage/v1/object/public/gali-nft/milestone/level-${MILESTONE[kind].level}.${ext}`;

async function saveImage(kind: MilestoneKind, ext: 'gif' | 'png', serial?: number) {
  const url = fileUrl(kind, ext);
  const name = `gali-level-${MILESTONE[kind].level}${serial ? '-' + pad4(serial) : ''}.${ext}`;
  try {
    if (web) {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } else await Share.share({ url, message: url, title: name });
  } catch {
    useGame.getState().toast("Couldn't save the image. Try again", 'bad');
  }
}

function postOnX(kind: MilestoneKind, serial?: number) {
  const m = MILESTONE[kind];
  const text = `I hit ${m.title} on Gali Island${serial ? ` (certificate #${pad4(serial)})` : ''}. It rolls one ${m.rarity} weapon at random when the Gali NFT market opens: ${m.weapons.join(', ')}. @Gali_Game`;
  void Linking.openURL(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://gali.lol')}`);
}

/** The claim line under a milestone: the wallet step while minting, or the last error for it. */
function ClaimState({ kind }: { kind: MilestoneKind }) {
  const { claiming, claimKind, error } = useNft();
  if (claimKind !== kind) return null;
  if (claiming)
    return (
      <T v="bold" style={{ fontSize: 12, color: COLORS.teal }}>
        {STEP[claiming]}
      </T>
    );
  return error ? (
    <T v="bold" style={{ fontSize: 12, color: COLORS.red }}>
      {error}
    </T>
  ) : null;
}

/** Quest tab: Founding Miner, Reach Level 10, Reach Level 20. */
export function MilestoneQuests() {
  const owner = useGame((s) => s.wallet.owner);
  const { cert, claiming, claimKind, claim, openPopup } = useNft();
  const ms = cert?.milestones;
  const { xp, level } = useLevel(ms);
  const fmBtn = !owner
    ? { label: 'Wallet', on: false }
    : cert?.claim?.status === 'minted'
      ? { label: 'Done', on: false }
      : cert?.eligible
        ? { label: 'Claim', on: true }
        : cert?.counting
          ? { label: '...', on: false }
          : { label: 'Beta only', on: false };
  return (
    <>
      <T v="label" style={{ marginTop: 6 }}>
        Milestones · certificate NFTs, claim the gear when the market opens
      </T>
      <Card style={[styles.row, fmBtn.label === 'Done' && { opacity: 0.6 }]}>
        <View style={styles.thumb}>
          <CertCard width={96} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.titleRow}>
            <T v="bold" style={{ flexShrink: 1 }}>
              Founding Miner
            </T>
            <Pill text="Legendary" color="rgba(255,201,60,0.16)" fg={COLORS.gold} />
          </View>
          <T v="muted" style={{ fontSize: 12 }}>
            {cert?.eligible ? `Mined ${cert.rounds.toLocaleString()} ORE rounds in the closed beta.` : 'Mine a live ORE round during the closed beta.'} Claims the Jarl Helmet.
          </T>
        </View>
        <Btn small kind={fmBtn.on ? 'gold' : 'plain'} label={fmBtn.label} disabled={!fmBtn.on} onPress={openPopup} style={styles.btn} />
      </Card>
      {MILESTONE_KINDS.map((k) => {
        const m = MILESTONE[k];
        const info = ms?.[k];
        const minted = info?.claim?.status === 'minted';
        const reached = level >= m.level;
        const pct = Math.min(100, (xp / xpForLevel(m.level)) * 100);
        const btn = minted
          ? 'Done'
          : !reached
            ? `${Math.floor(pct)}%`
            : !owner
              ? 'Wallet'
              : !ms?.open
                ? 'Soon'
                : claiming && claimKind === k
                  ? '...'
                  : 'Claim';
        return (
          <Card key={k} style={[styles.row, minted && { opacity: 0.6 }]}>
            <View style={styles.thumb}>
              <MilestoneArt kind={k} width={96} still dim={!reached} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.titleRow}>
                <T v="bold" style={{ flexShrink: 1 }}>
                  Reach {m.title}
                </T>
                <Pill text={m.rarity} color={k === 'lv20' ? 'rgba(255,201,60,0.16)' : 'rgba(90,184,255,0.16)'} fg={HUE[k]} />
              </View>
              <Bar pct={pct} colors={k === 'lv20' ? [COLORS.gold2, COLORS.gold] : ['#2f6fd0', '#5ab8ff']} />
              <T v="muted" style={{ fontSize: 12 }}>
                {minted
                  ? `Certificate #${pad4(info!.claim!.serial)} is in your wallet.`
                  : `Lv ${level} · ${Math.min(xp, xpForLevel(m.level)).toLocaleString()}/${xpForLevel(m.level).toLocaleString()} XP`}{' '}
                · 1 random {m.rarity} weapon
              </T>
              <ClaimState kind={k} />
            </View>
            <Btn small kind={btn === 'Claim' ? 'gold' : 'plain'} label={btn} disabled={btn !== 'Claim'} onPress={() => void claim(k)} style={styles.btn} />
          </Card>
        );
      })}
    </>
  );
}

/** Bag vault: the two level certificates, claimed or not. */
export function MilestoneVault() {
  const owner = useGame((s) => s.wallet.owner);
  const { cert, claiming, claimKind, claim } = useNft();
  const ms = cert?.milestones;
  const { xp, level } = useLevel(ms);
  if (!owner) return null;
  return (
    <View style={{ gap: 12 }}>
      <T v="tiny" style={{ fontSize: 9, color: TECH.dim, letterSpacing: 1 }}>
        MILESTONE CERTIFICATES
      </T>
      {MILESTONE_KINDS.map((k) => {
        const m = MILESTONE[k];
        const info = ms?.[k];
        const minted = info?.claim?.status === 'minted';
        const reached = level >= m.level;
        const hue = HUE[k];
        return (
          <View key={k} style={[styles.vaultCard, { borderColor: reached ? hue : TECH.rule }]}>
            <View style={{ alignSelf: 'center' }}>
              <MilestoneArt kind={k} width={300} dim={!reached} />
              {minted ? <Corners color={hue} size={8} inset={-6} /> : null}
            </View>
            <T v="display" style={{ fontSize: 20, lineHeight: 21, color: reached ? hue : COLORS.text, letterSpacing: 1 }}>
              {minted ? `Gali ${m.title} Certificate #${pad4(info!.claim!.serial)}` : `${m.title} Certificate`}
            </T>
            <Readout k="ROLLS" v={`1 RANDOM ${m.rarity.toUpperCase()} WEAPON`} color={hue} />
            <Readout k="ONE OF" v={m.weapons.join(' · ').toUpperCase()} />
            <Readout k="STATUS" v={minted ? 'IN YOUR WALLET · SOULBOUND' : reached ? 'READY TO CLAIM' : `LV ${level} OF ${m.level} · ${Math.max(0, xpForLevel(m.level) - xp).toLocaleString()} XP TO GO`} color={minted ? COLORS.green : reached ? COLORS.gold : TECH.dim} />
            {minted ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <TechBtn small label="SAVE GIF" onPress={() => void saveImage(k, 'gif', info!.claim!.serial)} />
                </View>
                <View style={{ flex: 1 }}>
                  <TechBtn small label="SAVE PNG" onPress={() => void saveImage(k, 'png', info!.claim!.serial)} />
                </View>
                <View style={{ flex: 1.3 }}>
                  <TechBtn small primary label="POST ON X" onPress={() => postOnX(k, info!.claim!.serial)} />
                </View>
              </View>
            ) : reached ? (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Led color={hue} blink />
                  <T style={{ flex: 1, fontSize: 13 }}>You pay the mint: Solana rent and network fee, shown in your wallet. One per wallet.</T>
                </View>
                <TechBtn primary color={hue} label={!ms?.open ? 'MINT OPENS SOON' : claiming && claimKind === k ? 'CLAIMING...' : 'CLAIM CERTIFICATE'} disabled={!ms?.open || !!claiming} onPress={() => void claim(k)} />
                <ClaimState kind={k} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 96, height: 54, overflow: 'hidden' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  btn: { minWidth: 84, alignSelf: 'center' },
  vaultCard: { borderWidth: 2, padding: 10, gap: 6, backgroundColor: 'rgba(4,6,15,0.5)' },
});
