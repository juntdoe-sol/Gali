/**
 * BAG: the loadout bay.
 *
 * Your miner stands on a holo pedestal with its five slots wired in around it: Head, Clothes and Shoes on the left,
 * Weapon and Pet on the right (and a jump to the Gear Market). Tap a slot and the rail under the bay slides through
 * what you own for it; tap an item to equip it, and the miner re-materialises wearing it. Your look goes out to the
 * lobby, island and arena as before. Below: the vault, with the Gali NFTs the wallet holds (the Founding Miner
 * certificate now, Gear 555 when the market opens), read on chain through the `nft` function.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View, type ImageStyle, type LayoutChangeEvent } from 'react-native';
import { COLORS, GEAR, RARITY_COLOR, type GearKind } from '../game/constants';
import { useMarket } from '../game/market';
import { PART, PARTS, PARTS_H, PARTS_W, partCell } from '../game/minerParts';
import { fmtDay, useNft } from '../game/nft';
import { play } from '../game/sfx';
import { useGame, useOwnedMask } from '../game/store';
import { useName } from '../game/username';
import { CertCard, postOnX, saveCert } from './CertClaim';
import { T, U } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { alpha, Corners, HoloStage, Led, Materialize, Meter, Prompt, Readout, stageGeo, TECH, TechBtn, TechPanel, useTick } from './tech';

const PIX = { imageRendering: 'pixelated' } as ImageStyle;

type Slot = 'head' | 'clothes' | 'shoes' | 'weapon' | 'pet';
const SLOTS: { id: Slot; label: string; kind: GearKind | null; icon: PixName; market: 'head' | 'clothes' | 'shoes' | 'weapons' | 'pets' }[] = [
  { id: 'head', label: 'HEAD', kind: 'helmet', icon: 'helmet', market: 'head' },
  { id: 'clothes', label: 'CLOTHES', kind: 'outfit', icon: 'vest', market: 'clothes' },
  { id: 'shoes', label: 'SHOES', kind: null, icon: 'jump', market: 'shoes' },
  { id: 'weapon', label: 'WEAPON', kind: 'pickaxe', icon: 'pick', market: 'weapons' },
  { id: 'pet', label: 'PET', kind: 'pet', icon: 'paw', market: 'pets' },
];
const LEFT: Slot[] = ['head', 'clothes', 'shoes'];
const RIGHT: Slot[] = ['weapon', 'pet'];
const RTIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 3, legendary: 4 };

/** One 40x40 layer from the parts sheet (`icon` takes the centred icon row instead). */
function Part({ k, scale, style, icon }: { k: string; scale: number; style?: object; icon?: boolean }) {
  const i = partCell(k);
  if (i === null) return null;
  return (
    <View style={[{ width: PART * scale, height: PART * scale, overflow: 'hidden' }, style]} pointerEvents="none">
      <Image source={PARTS} fadeDuration={0} style={[{ position: 'absolute', left: -i * PART * scale, top: icon ? -PART * scale : 0, width: PARTS_W * scale, height: PARTS_H * scale }, PIX]} />
    </View>
  );
}

function useEquipped() {
  const save = useGame((s) => s.save);
  return { head: save.helmet || 'hat-yellow', clothes: save.outfit || 'fit-blue', shoes: null, weapon: save.pickaxe || 'pick-wood', pet: save.pet ?? null } as Record<Slot, string | null>;
}

/** Renders its child with the box's width once laid out. */
function Measure({ children }: { children: (w: number) => ReactNode }) {
  const [w, setW] = useState(0);
  const on = (e: LayoutChangeEvent) => {
    const x = Math.floor(e.nativeEvent.layout.width / U) * U;
    if (x !== w) setW(x);
  };
  return <View onLayout={on}>{w ? children(w) : null}</View>;
}

/** Your miner on the pedestal: body, outfit, hat and pick stacked, the pet at its side. */
function Figure({ eq, width, feet, sex }: { eq: Record<Slot, string | null>; width: number; feet: number; sex: 'm' | 'f' }) {
  const t = useTick(600);
  const bob = t % 2 ? -U : 0;
  // body cells are 40x40 with the feet on row 30
  // as big as the bay allows, but narrow enough that the pet beside the miner stays on the stage
  const s = Math.max(2, Math.min(6, Math.floor((feet - 24) / 30), Math.floor((width / 2 - 10) / 24)));
  const cx = width / 2;
  const abs = { position: 'absolute' as const, left: 0, top: 0 };
  const ps = Math.max(2, Math.round(s * 0.6));
  const hue = COLORS.teal;
  return (
    <Materialize key={`${eq.head}|${eq.clothes}|${eq.weapon}|${eq.pet}|${sex}`} color={hue} style={StyleSheet.absoluteFill}>
      <View style={{ position: 'absolute', left: Math.round(cx - 19 * s), top: feet - 30 * s + bob, width: PART * s, height: PART * s }}>
        <Part k={sex === 'f' ? 'body-f' : 'body-m'} scale={s} style={abs} />
        {eq.clothes ? <Part k={eq.clothes} scale={s} style={abs} /> : null}
        {eq.head ? <Part k={eq.head} scale={s} style={abs} /> : null}
        {eq.weapon ? <Part k={eq.weapon} scale={s} style={abs} /> : null}
      </View>
      {eq.pet ? (
        <View style={{ position: 'absolute', left: Math.round(cx + 6 * s), top: feet - 38 * ps + (t % 2 ? 0 : -U) }}>
          <Part k={eq.pet} scale={ps} />
        </View>
      ) : null}
    </Materialize>
  );
}

function SlotCell({ s, item, on, size, onPress }: { s: (typeof SLOTS)[number]; item: string | null; on: boolean; size: number; onPress: () => void }) {
  const g = item ? GEAR.find((x) => x.key === item) : null;
  const hue = g ? RARITY_COLOR[g.rarity] : TECH.dim;
  return (
    <Pressable
      onPress={() => {
        play('select');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${s.label}: ${g?.name ?? (s.kind ? 'empty' : 'coming soon')}`}
    >
      {(st) => {
        const hov = (st as { hovered?: boolean }).hovered;
        return (
          <View style={[styles.slot, { width: size, borderColor: on ? COLORS.teal : hov ? alpha(COLORS.teal, 0.5) : TECH.rule, backgroundColor: on ? alpha(COLORS.teal, 0.1) : TECH.panel }]}>
            <View style={styles.slotHead}>
              <Led color={on ? COLORS.teal : hue} on={Boolean(item) || on} size={4} />
              <T v="tiny" numberOfLines={1} style={{ fontSize: 8, letterSpacing: 1, color: on ? COLORS.teal : TECH.dim }}>
                {s.label}
              </T>
            </View>
            <View style={[styles.slotArt, { width: size - 12, height: size - 20 }]}>
              {item && partCell(item) !== null ? (
                <Part k={item} scale={size >= 80 ? 1.5 : 1.25} icon />
              ) : (
                <PixIcon name={s.icon} size={size >= 80 ? 26 : 22} style={{ opacity: s.kind ? 0.45 : 0.22 }} />
              )}
              {g ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: U, backgroundColor: hue }} /> : null}
            </View>
            <T v="bold" numberOfLines={1} style={{ fontSize: 10, color: s.kind ? COLORS.text : TECH.dim, alignSelf: 'stretch', textAlign: 'center' }}>
              {g?.name ?? (s.kind ? 'Empty' : 'Soon')}
            </T>
            {on ? <Corners color={COLORS.teal} size={6} inset={-U * 3} /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

/** Wires from the slots into the bay: dim, or lit with a data packet running along the chosen one. */
function Wires({ width, height, ys, side, lit }: { width: number; height: number; ys: number[]; side: 'left' | 'right'; lit: number }) {
  const t = useTick(70);
  const len = Math.min(56, Math.round(width * 0.18 / U) * U);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {ys.map((y, i) => {
        const on = i === lit;
        const pkt = on ? ((t * 4) % len) : -1;
        const x0 = side === 'left' ? 0 : width - len;
        return (
          <View key={i}>
            <View style={{ position: 'absolute', left: x0, top: y, width: len, height: U, backgroundColor: on ? alpha(COLORS.teal, 0.85) : alpha(COLORS.teal, 0.18) }} />
            <View style={{ position: 'absolute', left: side === 'left' ? len - U * 2 : x0 - U, top: y - U, width: U * 3, height: U * 3, backgroundColor: on ? COLORS.teal : alpha(COLORS.teal, 0.25) }} />
            {pkt >= 0 ? <View style={{ position: 'absolute', left: side === 'left' ? x0 + pkt : width - pkt - U * 2, top: y - U, width: U * 2, height: U * 3, backgroundColor: '#ffffff' }} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function Bay({ width }: { width: number }) {
  const eq = useEquipped();
  const sex = useName((s) => s.sex) === 'f' ? 'f' : 'm';
  const name = useName((s) => s.name);
  const mask = useOwnedMask();
  const equip = useGame((s) => s.equip);
  const showMarket = useMarket((s) => s.show);
  const [slot, setSlot] = useState<Slot>('head');
  const def = SLOTS.find((s) => s.id === slot)!;
  const gap = U * 4;
  const slotW = width >= 500 ? 86 : width >= 360 ? 70 : 60;
  const slotH = slotW + 24;
  const colH = slotH * 3 + gap * 2;
  const stageW = width - slotW * 2 - gap * 2;
  const geo = stageGeo(stageW, colH, 0.62);
  const ys = [0, 1, 2].map((i) => i * (slotH + gap) + Math.round(slotH / 2 / U) * U);
  const owned = def.kind ? GEAR.filter((g) => g.kind === def.kind && mask & (1 << g.id)) : [];
  const allOfKind = def.kind ? GEAR.filter((g) => g.kind === def.kind).length : 0;
  const totalOwned = GEAR.filter((g) => mask & (1 << g.id)).length;
  const worn = [eq.head, eq.clothes, eq.weapon, eq.pet].filter(Boolean).length;
  const cell = (id: Slot) => {
    const s = SLOTS.find((x) => x.id === id)!;
    return <SlotCell key={id} s={s} item={eq[id]} on={slot === id} size={slotW} onPress={() => setSlot(id)} />;
  };
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.bayHead}>
        <Prompt text={`loadout://${(name || 'miner').toLowerCase()}`} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <T v="tiny" style={styles.statK}>
              WORN
            </T>
            <Meter n={worn} of={5} color={COLORS.teal} cell={6} h={6} />
          </View>
          <T v="tiny" style={styles.statK}>
            OWNED <T v="tiny" style={{ fontSize: 9, color: COLORS.text }}>{String(totalOwned).padStart(2, '0')}</T>
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap }}>
        <View style={{ gap }}>{LEFT.map(cell)}</View>
        <View style={{ width: stageW, height: colH }}>
          <HoloStage width={stageW} height={colH} color={COLORS.teal} pedestal={0.62}>
            <Figure eq={eq} width={stageW} feet={geo.feet} sex={sex} />
            <Wires width={stageW} height={colH} ys={ys} side="left" lit={LEFT.indexOf(slot)} />
            <Wires width={stageW} height={colH} ys={ys.slice(0, 2)} side="right" lit={RIGHT.indexOf(slot)} />
          </HoloStage>
          <View pointerEvents="none" style={styles.bayTag}>
            <Led color={COLORS.teal} blink size={4} />
            <T v="tiny" style={{ fontSize: 8, letterSpacing: 1, color: COLORS.teal }}>
              LIVE
            </T>
          </View>
        </View>
        <View style={{ gap }}>
          {RIGHT.map(cell)}
          <Pressable onPress={() => showMarket(def.market)} accessibilityRole="button" accessibilityLabel="Open the Gear Market">
            {(st) => {
              const hov = (st as { hovered?: boolean }).hovered;
              return (
                <View style={[styles.slot, styles.marketSlot, { width: slotW, height: slotH, borderColor: hov ? COLORS.gold : alpha(COLORS.gold, 0.45), backgroundColor: hov ? alpha(COLORS.gold, 0.12) : alpha(COLORS.gold, 0.05) }]}>
                  <PixIcon name="bag" size={slotW >= 80 ? 26 : 22} />
                  <T v="display" style={{ fontSize: 18, lineHeight: 18, color: COLORS.gold }}>
                    +555
                  </T>
                  <T v="tiny" style={{ fontSize: 8, letterSpacing: 1, color: alpha(COLORS.gold, 0.8) }}>
                    MARKET
                  </T>
                </View>
              );
            }}
          </Pressable>
        </View>
      </View>

      <TechPanel
        title={`SLOT · ${def.label}`}
        right={
          <T v="tiny" style={{ fontSize: 9, color: TECH.dim }}>
            {def.kind ? `${owned.length}/${allOfKind} OWNED` : 'GEAR 555'}
          </T>
        }
      >
        {def.kind ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={104} decelerationRate="fast" contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingRight: 4 }}>
            {owned.map((g) => {
              const on = eq[slot] === g.key;
              const hue = RARITY_COLOR[g.rarity];
              return (
                <Pressable
                  key={g.key}
                  onPress={() => {
                    play(on ? 'deselect' : 'mint');
                    equip(g.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={g.name}
                >
                  {(st) => {
                    const hov = (st as { hovered?: boolean }).hovered;
                    return (
                      <View style={[styles.item, { borderColor: on ? COLORS.teal : hov ? alpha(hue, 0.8) : TECH.rule, backgroundColor: on ? alpha(COLORS.teal, 0.1) : 'transparent' }]}>
                        <View style={styles.itemArt}>
                          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 8, height: U, backgroundColor: alpha(hue, 0.4) }} />
                          <Part k={g.key} scale={2} icon />
                        </View>
                        <T v="bold" numberOfLines={1} style={{ fontSize: 11, alignSelf: 'stretch', textAlign: 'center' }}>
                          {g.name}
                        </T>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Led color={on ? COLORS.teal : hue} on={on} blink={false} size={4} />
                          <T v="tiny" style={{ fontSize: 8, letterSpacing: 1, color: on ? COLORS.teal : hue }}>
                            {on ? (def.kind === 'pet' ? 'WITH YOU' : 'EQUIPPED') : g.rarity.toUpperCase()}
                          </T>
                        </View>
                        <Meter n={RTIER[String(g.rarity).toLowerCase()] ?? 1} of={4} color={hue} cell={6} h={3} gap={1} />
                        {on ? <Corners color={COLORS.teal} size={6} /> : null}
                      </View>
                    );
                  }}
                </Pressable>
              );
            })}
            <Pressable onPress={() => showMarket(def.market)} accessibilityRole="button" accessibilityLabel="More in the Gear Market">
              {(st) => (
                <View style={[styles.item, styles.ghost, { borderColor: (st as { hovered?: boolean }).hovered ? COLORS.gold : alpha(COLORS.gold, 0.35) }]}>
                  <PixIcon name="sparkle" size={26} />
                  <T v="display" style={{ fontSize: 16, lineHeight: 17, color: COLORS.gold, textAlign: 'center' }}>
                    MORE IN{'\n'}THE MARKET
                  </T>
                </View>
              )}
            </Pressable>
          </ScrollView>
        ) : (
          <View style={{ gap: 8 }}>
            <T v="muted" style={{ fontSize: 13 }}>
              Shoes arrive with the Gear 555 drop: 92 pairs, from Farmer Gumboots to rocket boots.
            </T>
            <TechBtn small label="PREVIEW SHOES" color={COLORS.gold} onPress={() => showMarket('shoes')} />
          </View>
        )}
        {def.kind === 'pet' && eq.pet ? (
          <T v="tiny" style={{ fontSize: 8, color: TECH.dim, letterSpacing: 1 }}>
            TAP YOUR PET AGAIN TO LEAVE IT HOME
          </T>
        ) : null}
      </TechPanel>
    </View>
  );
}

function Vault() {
  const owner = useGame((s) => s.wallet.owner);
  const { cert, items, loading, error, openPopup } = useNft();
  const certs = items.filter((i) => i.kind === 'cert');
  const gear = items.filter((i) => i.kind === 'gear');
  const minted = cert?.claim?.status === 'minted';
  const has = minted || certs.length > 0;
  return (
    <TechPanel
      title="VAULT · GALI NFTS"
      color={COLORS.gold}
      right={
        has ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <PixIcon name="lock" size={12} />
            <T v="tiny" style={{ fontSize: 9, color: COLORS.gold }}>
              SOULBOUND
            </T>
          </View>
        ) : null
      }
    >
      {!owner ? (
        <T v="muted">Connect a wallet to open the vault.</T>
      ) : has ? (
        <View style={{ gap: 10 }}>
          <Measure>
            {(w) => (
              <View style={{ alignSelf: 'center' }}>
                <CertCard width={Math.min(w, 420)} />
                <Corners color={COLORS.gold} size={10} inset={-U * 3} />
              </View>
            )}
          </Measure>
          <T v="display" style={{ fontSize: 24, lineHeight: 25, color: COLORS.gold, letterSpacing: 1 }}>
            {certs[0]?.name ?? `Gali Founding Miner #${String(cert?.claim?.serial ?? 0).padStart(4, '0')}`}
          </T>
          {cert ? (
            <View style={{ gap: 2 }}>
              <Readout k="SERIAL" v={`#${String(cert.claim?.serial ?? 0).padStart(4, '0')}`} color={COLORS.gold} />
              <Readout k="BETA ROUNDS" v={cert.rounds.toLocaleString()} />
              <Readout k="FIRST DIG" v={fmtDay(cert.firstAt).toUpperCase()} />
              <Readout k="UNLOCKS" v="LEGENDARY JARL HELMET" color={COLORS.gold} />
              <Readout k="WHEN" v="NFT MARKET OPENS" color={TECH.dim} />
            </View>
          ) : null}
          {cert ? (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1 }}>
                <TechBtn small label="SAVE GIF" onPress={() => void saveCert('gif', cert)} />
              </View>
              <View style={{ flex: 1 }}>
                <TechBtn small label="SAVE PNG" onPress={() => void saveCert('png', cert)} />
              </View>
              <View style={{ flex: 1.3 }}>
                <TechBtn small primary label="POST ON X" onPress={() => void postOnX(cert)} />
              </View>
            </View>
          ) : null}
        </View>
      ) : cert?.eligible ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Led color={COLORS.gold} blink />
            <T v="bold" style={{ flex: 1 }}>
              You are a Founding Miner: {cert.rounds.toLocaleString()} ORE rounds in the closed beta.
            </T>
          </View>
          <TechBtn primary color={COLORS.gold} label="CLAIM CERTIFICATE" onPress={openPopup} />
        </View>
      ) : cert?.counting ? (
        <Prompt color={COLORS.gold} text={`counting your beta rounds: ${cert.rounds.toLocaleString()} so far`} />
      ) : (
        <T v="muted">
          {loading || !cert ? 'Opening the vault...' : 'Empty for now. Founding Miner certificates go to wallets that mined a live ORE round in the closed beta; Gear 555 lands here when the market opens.'}
        </T>
      )}
      {gear.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {gear.map((g) => (
            <View key={g.id} style={[styles.item, { borderColor: TECH.rule }]}>
              {g.image ? <Image source={{ uri: g.image }} style={[{ width: 72, height: 72 }, PIX]} /> : <PixIcon name="bag" size={48} />}
              <T v="bold" numberOfLines={2} style={{ fontSize: 11, textAlign: 'center' }}>
                {g.name}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {error && owner ? (
        <T v="muted" style={{ fontSize: 12, color: COLORS.red }}>
          {error}
        </T>
      ) : null}
    </TechPanel>
  );
}

export function Inventory() {
  const owner = useGame((s) => s.wallet.owner);
  const refresh = useNft((s) => s.refresh);
  useEffect(() => {
    void refresh(owner, true);
  }, [owner, refresh]);
  return (
    <View style={{ gap: 14 }}>
      <Measure>{(w) => <Bay width={w} />}</Measure>
      <Vault />
    </View>
  );
}

const styles = StyleSheet.create({
  bayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  statK: { fontSize: 8, letterSpacing: 1, color: TECH.dim },
  slot: { padding: 5, gap: 3, alignItems: 'center', borderWidth: U },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'stretch' },
  slotArt: { alignItems: 'center', justifyContent: 'center', backgroundColor: TECH.ink, overflow: 'hidden' },
  marketSlot: { justifyContent: 'center', gap: 4 },
  bayTag: { position: 'absolute', right: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  item: { width: 96, padding: 6, gap: 4, alignItems: 'center', borderWidth: U },
  itemArt: { width: 80, height: 72, alignItems: 'center', justifyContent: 'center', backgroundColor: TECH.ink, overflow: 'hidden' },
  ghost: { height: 140, justifyContent: 'center', borderStyle: 'dashed' },
});
