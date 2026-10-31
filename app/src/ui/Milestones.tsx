/**
 * Milestone certificates for Levels 3, 6, 10, 15, 20 and 30: each claims that level's gear when the market opens
 * (one item, or one of several at random; Level 30 a full outfit). See MILESTONE in game/nft.ts.
 *
 *  - MilestoneQuests: the Quest tab's collection: Founding Miner and every level milestone, each showing the gear it
 *    gives (animated), its progress and a claim button for the certificate NFT
 *  - MilestoneVault: the Bag's level certificates, only the ones this wallet owns, as a short list (CertRow);
 *    hover a row (tap on a phone) for the card, its details and save and share buttons
 *
 * The level is the one the server worked out from verified XP, so what the quest shows is what the mint checks.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Image, Linking, Platform, Pressable, Share, StyleSheet, View, type ImageStyle } from 'react-native';
import { COLORS, levelFromXp, xpForLevel } from '../game/constants';
import { MILESTONE, MILESTONE_KINDS, useNft, type MilestoneKind, type Milestones } from '../game/nft';
import { useGame, useLevelXp } from '../game/store';
import { gearNow, loadGear, type GearBook, type GearItem } from '../game/gear555';
import { restBase } from '../game/world';
import { CertCard } from './CertClaim';
import { GearSprite } from './GearSprite';
import { Bar, Btn, Pill, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import { alpha, Corners, Readout, TECH, TechBtn, useTick } from './tech';

const PIX = { imageRendering: 'pixelated' } as ImageStyle;
const web = Platform.OS === 'web';
const STILL: Record<MilestoneKind, number> = {
  lv3: require('../../assets/market/level-3.png'),
  lv6: require('../../assets/market/level-6.png'),
  lv10: require('../../assets/market/level-10.png'),
  lv15: require('../../assets/market/level-15.png'),
  lv20: require('../../assets/market/level-20.png'),
  lv30: require('../../assets/market/level-30.png'),
};
// Inline Platform.OS check so Metro drops the GIFs from native bundles; Android
// rejects level-3.gif and level-3.png as duplicate resources (like CertClaim).
const ART: Record<MilestoneKind, number> = Platform.OS === 'web' ? {
  lv3: require('../../assets/market/level-3.gif'),
  lv6: require('../../assets/market/level-6.gif'),
  lv10: require('../../assets/market/level-10.gif'),
  lv15: require('../../assets/market/level-15.gif'),
  lv20: require('../../assets/market/level-20.gif'),
  lv30: require('../../assets/market/level-30.gif'),
} : STILL;
const HUE: Record<MilestoneKind, string> = { lv3: '#6ad46f', lv6: '#6ad46f', lv10: '#5ab8ff', lv15: '#5ab8ff', lv20: COLORS.gold, lv30: '#d682ff' };
const BAR: Record<MilestoneKind, [string, string]> = {
  lv3: ['#2f8a3a', '#6ad46f'],
  lv6: ['#2f8a3a', '#6ad46f'],
  lv10: ['#2f6fd0', '#5ab8ff'],
  lv15: ['#2f6fd0', '#5ab8ff'],
  lv20: [COLORS.gold2, COLORS.gold],
  lv30: ['#7a2ab8', '#d682ff'],
};
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
  const what = m.rewards.length > 1 ? `It rolls ${m.reward} when the Gali NFT market opens: ${m.rewards.join(', ')}.` : `It claims the ${m.reward} when the Gali NFT market opens.`;
  const text = `I hit ${m.title} on Gali Island${serial ? ` (certificate #${pad4(serial)})` : ''}. ${what} @Gali_Game`;
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

/**
 * What a milestone gives, shown big and animated in place of the certificate card: the item bobs and glows, and a
 * certificate that rolls between several items flips through them.
 */
function ItemShow({ ids, hue, locked }: { ids: string[]; hue: string; locked: boolean }) {
  const items = useGearItems(ids);
  const t = useTick(450);
  if (!items.length) return <View style={styles.artBox} />;
  const g = items[Math.floor(t / 3) % items.length];
  const bob = t % 2 ? -2 : 0;
  return (
    <View style={[styles.artBox, styles.show, { borderColor: alpha(hue, 0.6), backgroundColor: alpha(hue, 0.1) }]}>
      <View style={[styles.glow, { backgroundColor: alpha(hue, t % 2 ? 0.28 : 0.18) }]} />
      <View style={{ transform: [{ translateY: bob }], opacity: locked ? 0.75 : 1 }}>
        <GearSprite item={g} scale={1.6} animate={g.rarity === 'Legendary'} />
      </View>
      <View style={styles.showTag}>
        <T v="tiny" style={{ fontSize: 8, color: hue, letterSpacing: 1 }} numberOfLines={1}>
          {g.name.toUpperCase()}
        </T>
      </View>
      {items.length > 1 ? (
        <View style={[styles.showCount, { backgroundColor: alpha(hue, 0.85) }]}>
          <T v="display" style={{ fontSize: 10, lineHeight: 11, color: TECH.ink }}>
            {`${(Math.floor(t / 3) % items.length) + 1}/${items.length}`}
          </T>
        </View>
      ) : null}
      {locked ? (
        <View style={styles.lockBadge}>
          <PixIcon name="lock" size={14} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One certificate in the Bag: a short row (small card, name, what it claims). Hover it (tap on a phone) for the
 * full card, its details and the save and share buttons.
 */
export function CertRow({
  thumb,
  art,
  title,
  line,
  hue,
  details,
  actions,
}: {
  thumb: ReactNode;
  art: ReactNode;
  title: string;
  line: string;
  hue: string;
  details: [string, string, string?][];
  actions: [string, () => void, boolean?][];
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  return (
    <View
      style={{ zIndex: open ? 20 : 0 }}
      {...({ onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } as object)}
    >
      <Pressable onPress={() => setPinned((v) => !v)} accessibilityRole="button" accessibilityLabel={`${title}: details`}>
        <View style={[styles.certRow, { borderColor: open ? hue : alpha(hue, 0.4), backgroundColor: open ? alpha(hue, 0.12) : 'rgba(4,6,15,0.5)' }]}>
          <View style={{ width: 80, height: 45, overflow: 'hidden' }}>{thumb}</View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="bold" style={{ fontSize: 13, color: hue }} numberOfLines={1}>
              {title}
            </T>
            <T v="muted" style={{ fontSize: 11 }} numberOfLines={1}>
              {line}
            </T>
          </View>
          <PixIcon name="lock" size={12} style={{ opacity: 0.6 }} />
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.pop, { borderColor: hue }]}>
          <View style={{ alignSelf: 'center' }}>
            {art}
            <Corners color={hue} size={8} inset={-6} />
          </View>
          <T v="display" style={{ fontSize: 16, lineHeight: 17, color: hue, letterSpacing: 1 }}>
            {title}
          </T>
          <View style={{ gap: 1 }}>
            {details.map(([k, v, c]) => (
              <Readout key={k} k={k} v={v} color={c} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {actions.map(([label, fn, primary]) => (
              <View key={label} style={{ flex: primary ? 1.3 : 1 }}>
                <TechBtn small primary={primary} label={label} onPress={fn} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const JARL = ['G084'];
const PILL_BG: Record<string, string> = { Uncommon: 'rgba(106,212,111,0.16)', Rare: 'rgba(90,184,255,0.16)', Legendary: 'rgba(255,201,60,0.16)' };

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
        {art}
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
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.hook}>
            <T v="display" style={{ fontSize: 22, lineHeight: 23, color: t % 2 ? COLORS.gold : '#fff1a8', letterSpacing: 1 }}>
              COLLECT XP, GET FREE ITEMS
            </T>
            <View style={[styles.nftTag, { backgroundColor: COLORS.teal }]}>
              <T v="display" style={{ fontSize: 12, lineHeight: 13, color: TECH.ink }}>
                NFT
              </T>
            </View>
          </View>
          <T style={{ fontSize: 13 }}>
            {all ? 'You collected them all. Your gear drops when the market opens.' : `Level up and every milestone gives you free gear as an NFT. Collect all ${got.length}.`}
          </T>
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
        art={<ItemShow ids={JARL} hue={COLORS.gold} locked={!fmGot && !cert?.eligible} />}
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
            art={<ItemShow ids={m.ids} hue={HUE[k]} locked={!reached} />}
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
            random={m.rewards.length > 1}
            got={minted}
            locked={!reached}
            progress={minted ? undefined : { pct, colors: BAR[k] }}
            btn={btn}
            onPress={() => void claim(k)}
            extra={<ClaimState kind={k} />}
          />
        );
      })}
    </PixelBox>
  );
}

/** Bag vault: the level certificates this wallet owns (collecting them happens on the Quest tab). */
export function MilestoneVault() {
  const owner = useGame((s) => s.wallet.owner);
  const ms = useNft((s) => s.cert?.milestones);
  const owned = MILESTONE_KINDS.filter((k) => ms?.[k]?.claim?.status === 'minted');
  if (!owner || !owned.length) return null;
  return (
    <>
      {owned.map((k) => {
        const m = MILESTONE[k];
        const serial = ms![k]!.claim!.serial;
        const hue = HUE[k];
        const details: [string, string, string?][] = [
          ['SERIAL', `#${pad4(serial)}`, hue],
          [m.rewards.length > 1 ? 'ROLLS' : 'CLAIMS', m.reward.toUpperCase(), hue],
          ...(m.rewards.length > 1 ? ([['ONE OF', m.rewards.join(' · ').toUpperCase()]] as [string, string][]) : []),
          ['WHEN', 'NFT MARKET OPENS', TECH.dim],
        ];
        return (
          <CertRow
            key={k}
            thumb={<MilestoneArt kind={k} width={80} still />}
            art={<MilestoneArt kind={k} width={280} />}
            title={`Gali ${m.title} Certificate #${pad4(serial)}`}
            line={`${m.rewards.length > 1 ? 'Rolls' : 'Claims'} ${m.reward}`}
            hue={hue}
            details={details}
            actions={[
              ['SAVE GIF', () => void saveImage(k, 'gif', serial)],
              ['SAVE PNG', () => void saveImage(k, 'png', serial)],
              ['POST ON X', () => postOnX(k, serial), true],
            ]}
          />
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  collection: { padding: 12, gap: 10, marginTop: 6 },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pips: { flexDirection: 'row', gap: 4 },
  pip: { flex: 1, height: 8, borderWidth: 1 },
  collectRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  artBox: { width: 128, height: 72, overflow: 'hidden' },
  stamp: { position: 'absolute', right: 3, bottom: 3, paddingHorizontal: 4, paddingVertical: 2, transform: [{ rotate: '-6deg' }] },
  rewards: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  rewardCell: { width: 40, height: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  btn: { minWidth: 84, alignSelf: 'center' },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 6 },
  pop: { position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, borderWidth: 2, padding: 10, gap: 6, backgroundColor: 'rgba(14,10,30,0.98)', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12, elevation: 12 },
  show: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 56, height: 56, borderRadius: 28 },
  showTag: { position: 'absolute', left: 3, top: 2, right: 3 },
  showCount: { position: 'absolute', right: 3, top: 3, paddingHorizontal: 3, paddingVertical: 1 },
  lockBadge: { position: 'absolute', left: 3, bottom: 3, backgroundColor: 'rgba(4,6,15,0.8)', padding: 2 },
  hook: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  nftTag: { paddingHorizontal: 5, paddingVertical: 2 },
});
