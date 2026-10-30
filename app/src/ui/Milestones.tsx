/**
 * Milestone certificates: Level 10 (one random Rare weapon) and Level 20 (one random Legendary weapon).
 *
 *  - MilestoneQuests: the Quest tab's "Milestones" list: Founding Miner, Reach Level 10, Reach Level 20, each with
 *    its progress and a claim button for the certificate NFT
 *  - MilestoneVault: the Bag's certificates for the two levels (claimed, ready to claim, or locked with progress)
 *
 * The level is the one the server worked out from verified XP, so what the quest shows is what the mint checks.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Image, Linking, Platform, Share, StyleSheet, View, type ImageStyle } from 'react-native';
import { COLORS, levelFromXp, xpForLevel } from '../game/constants';
import { MILESTONE, MILESTONE_KINDS, useNft, type MilestoneKind, type Milestones } from '../game/nft';
import { useGame, useLevelXp } from '../game/store';
import { gearNow, loadGear, type GearBook, type GearItem } from '../game/gear555';
import { restBase } from '../game/world';
import { CertCard } from './CertClaim';
import { GearSprite } from './GearSprite';
import { Bar, Btn, Pill, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import { alpha, Corners, Led, Readout, TECH, TechBtn, useTick } from './tech';

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

/** The gear a certificate claims, drawn from the Gear 555 catalogue (loaded on first use). */
function useGearItems(ids: string[]) {
  const [book, setBook] = useState<GearBook | null>(gearNow());
  useEffect(() => {
    if (!book) void loadGear().then(setBook);
  }, [book]);
  return book ? (ids.map((id) => book.items.find((g) => g.id === id)).filter(Boolean) as GearItem[]) : [];
}

/** The reward strip: the one item, or the three a certificate rolls between. */
function Rewards({ ids, hue, random }: { ids: string[]; hue: string; random: boolean }) {
  const items = useGearItems(ids);
  return (
    <View style={styles.rewards}>
      <T v="tiny" style={{ fontSize: 8, color: hue, letterSpacing: 1 }}>
        {random ? 'ROLLS 1 OF' : 'CLAIMS'}
      </T>
      {items.map((g, i) => (
        <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {i > 0 ? (
            <T v="display" style={{ fontSize: 12, color: TECH.dim }}>
              ?
            </T>
          ) : null}
          <View style={[styles.rewardCell, { borderColor: alpha(hue, 0.55), backgroundColor: alpha(hue, 0.08) }]}>
            <GearSprite item={g} scale={1} animate={g.rarity === 'Legendary'} />
          </View>
        </View>
      ))}
    </View>
  );
}

const JARL = ['G084'];
const PILL_BG: Record<string, string> = { Rare: 'rgba(90,184,255,0.16)', Legendary: 'rgba(255,201,60,0.16)' };

/** One certificate in the collection. */
function CollectRow({
  art,
  title,
  rarity,
  hue,
  status,
  rewards,
  random,
  got,
  locked,
  progress,
  btn,
  onPress,
  extra,
}: {
  art: ReactNode;
  title: string;
  rarity: string;
  hue: string;
  status: string;
  rewards: string[];
  random: boolean;
  got: boolean;
  locked: boolean;
  progress?: { pct: number; colors: [string, string] };
  btn: string;
  onPress: () => void;
  extra?: ReactNode;
}) {
  const ready = btn === 'Claim';
  return (
    <PixelBox fill={got ? alpha(hue, 0.1) : ready ? alpha(hue, 0.07) : 'rgba(9,14,34,0.92)'} hi={got || ready ? hue : '#2a3a72'} lo="#04060f" style={styles.collectRow}>
      <View style={styles.artBox}>
        <View style={{ opacity: locked ? 0.4 : 1 }}>{art}</View>
        {locked ? (
          <View style={styles.lockOver}>
            <PixIcon name="lock" size={22} />
          </View>
        ) : null}
        {got ? (
          <View style={[styles.stamp, { backgroundColor: hue }]}>
            <T v="display" style={{ fontSize: 11, lineHeight: 12, color: TECH.ink, letterSpacing: 1 }}>
              COLLECTED
            </T>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={styles.titleRow}>
          <T v="display" style={{ fontSize: 18, lineHeight: 19, color: got || ready ? hue : COLORS.text, flexShrink: 1 }}>
            {title}
          </T>
          <Pill text={rarity} color={PILL_BG[rarity]} fg={hue} />
        </View>
        {progress ? <Bar pct={progress.pct} colors={progress.colors} /> : null}
        <T v="muted" style={{ fontSize: 12 }}>
          {status}
        </T>
        <Rewards ids={rewards} hue={hue} random={random} />
        {extra}
      </View>
      {got ? (
        <View style={styles.btn}>
          <PixIcon name="medal" size={34} style={{ alignSelf: 'center' }} />
        </View>
      ) : (
        <Btn small kind={ready ? 'gold' : 'plain'} label={btn} disabled={!ready} onPress={onPress} style={styles.btn} />
      )}
    </PixelBox>
  );
}

/** Quest tab: the certificate collection. Founding Miner, Level 10, Level 20: collect all three. */
export function MilestoneQuests() {
  const owner = useGame((s) => s.wallet.owner);
  const { cert, claiming, claimKind, claim, openPopup } = useNft();
  const ms = cert?.milestones;
  const { xp, level } = useLevel(ms);
  const t = useTick(500);
  const fmGot = cert?.claim?.status === 'minted';
  const fmBtn = !owner ? 'Wallet' : fmGot ? 'Done' : cert?.eligible ? 'Claim' : cert?.counting ? '...' : 'Beta only';
  const got = [fmGot, ...MILESTONE_KINDS.map((k) => ms?.[k]?.claim?.status === 'minted')];
  const n = got.filter(Boolean).length;
  const all = n === got.length;
  return (
    <PixelBox fill="rgba(30,16,52,0.95)" hi={t % 2 ? COLORS.gold : '#fff1a8'} lo="#04060f" shadow={1} style={styles.collection}>
      <View style={styles.colHead}>
        <PixIcon name="trophy" size={34} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="display" style={{ fontSize: 24, lineHeight: 25, color: COLORS.gold, letterSpacing: 1 }}>
            CERTIFICATE COLLECTION
          </T>
          <T style={{ fontSize: 13 }}>{all ? 'You collected them all. Your gear drops when the market opens.' : 'Collect all 3. Each NFT claims real gear when the market opens.'}</T>
        </View>
        <View style={{ alignItems: 'center' }}>
          <T v="display" style={{ fontSize: 30, lineHeight: 30, color: all ? COLORS.gold : COLORS.text }}>
            {n}/{got.length}
          </T>
          <T v="tiny" style={{ fontSize: 8, color: TECH.dim, letterSpacing: 1 }}>
            COLLECTED
          </T>
        </View>
      </View>
      <View style={styles.pips}>
        {got.map((g, i) => (
          <View key={i} style={[styles.pip, { backgroundColor: g ? COLORS.gold : '#2a2150', borderColor: g ? '#fff1a8' : '#3c3270' }]} />
        ))}
      </View>
      <CollectRow
        art={<CertCard width={128} />}
        title="Founding Miner"
        rarity="Legendary"
        hue={COLORS.gold}
        status={fmGot ? `#${pad4(cert!.claim!.serial)} in your wallet · ${cert!.rounds.toLocaleString()} beta rounds` : cert?.eligible ? `You mined ${cert.rounds.toLocaleString()} ORE rounds in the closed beta.` : 'Closed beta miners only. Gone for good.'}
        rewards={JARL}
        random={false}
        got={fmGot}
        locked={!fmGot && !cert?.eligible}
        btn={fmBtn}
        onPress={openPopup}
      />
      {MILESTONE_KINDS.map((k) => {
        const m = MILESTONE[k];
        const info = ms?.[k];
        const minted = info?.claim?.status === 'minted';
        const reached = level >= m.level;
        const need = xpForLevel(m.level);
        const pct = Math.min(100, (xp / need) * 100);
        const btn = minted ? 'Done' : !reached ? `${Math.floor(pct)}%` : !owner ? 'Wallet' : !ms?.open ? 'Soon' : claiming && claimKind === k ? '...' : 'Claim';
        return (
          <CollectRow
            key={k}
            art={<MilestoneArt kind={k} width={128} still={!reached} />}
            title={`Reach ${m.title}`}
            rarity={m.rarity}
            hue={HUE[k]}
            status={
              minted
                ? `#${pad4(info!.claim!.serial)} in your wallet`
                : reached
                  ? `${m.title} reached. Claim your certificate.`
                  : `Lv ${level} · ${Math.min(xp, need).toLocaleString()}/${need.toLocaleString()} XP · ${(need - xp).toLocaleString()} to go`
            }
            rewards={m.ids}
            random
            got={minted}
            locked={!reached}
            progress={minted ? undefined : { pct, colors: k === 'lv20' ? [COLORS.gold2, COLORS.gold] : ['#2f6fd0', '#5ab8ff'] }}
            btn={btn}
            onPress={() => void claim(k)}
            extra={<ClaimState kind={k} />}
          />
        );
      })}
    </PixelBox>
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
                  <T style={{ flex: 1, fontSize: 13 }}>The cost shows in your wallet before you approve. One per wallet.</T>
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
  collection: { padding: 12, gap: 10, marginTop: 6 },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pips: { flexDirection: 'row', gap: 4 },
  pip: { flex: 1, height: 8, borderWidth: 1 },
  collectRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  artBox: { width: 128, height: 72, overflow: 'hidden' },
  lockOver: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  stamp: { position: 'absolute', right: 3, bottom: 3, paddingHorizontal: 4, paddingVertical: 2, transform: [{ rotate: '-6deg' }] },
  rewards: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  rewardCell: { width: 40, height: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  btn: { minWidth: 84, alignSelf: 'center' },
  vaultCard: { borderWidth: 2, padding: 10, gap: 6, backgroundColor: 'rgba(4,6,15,0.5)' },
});
