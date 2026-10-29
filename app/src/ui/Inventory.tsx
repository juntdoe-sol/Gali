/**
 * BAG: your miner and everything it can wear.
 *
 * Top: your miner wearing what is equipped, with five slots (Head, Clothes, Shoes, Weapon, Pet). Tap a slot to see
 * what you own for it and tap an item to equip it; your look goes out to the lobby, island and arena as before.
 * Below: the Gali NFTs the wallet holds (the Founding Miner certificate now, Gear 555 when the market opens), read
 * on chain through the `nft` function.
 */
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View, type ImageStyle } from 'react-native';
import { COLORS, GEAR, RARITY_COLOR, type GearKind } from '../game/constants';
import { useMarket } from '../game/market';
import { PART, PARTS, PARTS_H, PARTS_W, partCell } from '../game/minerParts';
import { fmtDay, useNft } from '../game/nft';
import { useGame, useOwnedMask } from '../game/store';
import { useName } from '../game/username';
import { CertCard, CertShare } from './CertClaim';
import { Btn, Card, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

const PIX = { imageRendering: 'pixelated' } as ImageStyle;

type Slot = 'head' | 'clothes' | 'shoes' | 'weapon' | 'pet';
const SLOTS: { id: Slot; label: string; kind: GearKind | null; icon: PixName }[] = [
  { id: 'head', label: 'HEAD', kind: 'helmet', icon: 'helmet' },
  { id: 'clothes', label: 'CLOTHES', kind: 'outfit', icon: 'vest' },
  { id: 'shoes', label: 'SHOES', kind: null, icon: 'jump' },
  { id: 'weapon', label: 'WEAPON', kind: 'pickaxe', icon: 'pick' },
  { id: 'pet', label: 'PET', kind: 'pet', icon: 'paw' },
];

/** One 40x40 layer from the parts sheet. */
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
  return { head: save.helmet || 'hat-yellow', clothes: save.outfit || 'fit-blue', weapon: save.pickaxe || 'pick-wood', pet: save.pet ?? null } as Record<Slot, string | null>;
}

/** Your miner, stacked from its layers, with the pet beside it. */
function MinerPreview({ eq, scale = 4 }: { eq: Record<Slot, string | null>; scale?: number }) {
  const sex = useName((s) => s.sex);
  const abs = { position: 'absolute' as const, left: 0, top: 0 };
  return (
    <View style={{ width: PART * scale * 1.6, height: PART * scale, alignItems: 'flex-start' }}>
      <View style={{ position: 'absolute', left: PART * scale * 0.12, bottom: scale * 2, width: PART * scale * 0.5, height: scale * 3, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <View style={{ width: PART * scale, height: PART * scale }}>
        <Part k={sex === 'f' ? 'body-f' : 'body-m'} scale={scale} style={abs} />
        {eq.clothes ? <Part k={eq.clothes} scale={scale} style={abs} /> : null}
        {eq.head ? <Part k={eq.head} scale={scale} style={abs} /> : null}
        {eq.weapon ? <Part k={eq.weapon} scale={scale} style={abs} /> : null}
      </View>
      {eq.pet ? <Part k={eq.pet} scale={scale * 0.6} style={{ position: 'absolute', right: 0, bottom: 0 }} /> : null}
    </View>
  );
}

function SlotBtn({ s, item, on, onPress }: { s: (typeof SLOTS)[number]; item: string | null; on: boolean; onPress: () => void }) {
  const g = item ? GEAR.find((x) => x.key === item) : null;
  const hue = g ? RARITY_COLOR[g.rarity] : '#2d4282';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${s.label}: ${g?.name ?? 'empty'}`}>
      {(st) => (
        <PixelBox fill={on ? '#1d2d5e' : (st as { hovered?: boolean }).hovered ? '#15224a' : 'rgba(11,20,48,0.9)'} hi={on ? COLORS.teal : hue} lo="#04060f" style={styles.slot}>
          <View style={styles.slotArt}>{item && partCell(item) !== null ? <Part k={item} scale={1.5} icon /> : <PixIcon name={s.icon} size={28} style={{ opacity: s.kind ? 0.5 : 0.25 }} />}</View>
          <T v="display" style={{ fontSize: 12, lineHeight: 13, color: on ? COLORS.teal : COLORS.muted, letterSpacing: 0.6 }}>
            {s.label}
          </T>
          <T v="bold" numberOfLines={1} style={{ fontSize: 11, color: s.kind ? COLORS.text : COLORS.muted }}>
            {g?.name ?? (s.kind ? 'None' : 'Soon')}
          </T>
        </PixelBox>
      )}
    </Pressable>
  );
}

function Wardrobe() {
  const eq = useEquipped();
  const mask = useOwnedMask();
  const equip = useGame((s) => s.equip);
  const showMarket = useMarket((s) => s.show);
  const [slot, setSlot] = useState<Slot>('head');
  const def = SLOTS.find((s) => s.id === slot)!;
  const items = def.kind ? GEAR.filter((g) => g.kind === def.kind) : [];
  const owned = items.filter((g) => mask & (1 << g.id));
  const locked = items.length - owned.length;
  return (
    <PixelBox fill="rgba(7,13,32,0.85)" hi="#2d4282" lo="#04060f" style={{ padding: 12, gap: 12 }}>
      <View style={styles.top}>
        <View style={styles.stage}>
          <MinerPreview eq={eq} />
        </View>
        <View style={styles.slots}>
          {SLOTS.map((s) => (
            <SlotBtn key={s.id} s={s} item={s.id === 'shoes' ? null : eq[s.id]} on={slot === s.id} onPress={() => setSlot(s.id)} />
          ))}
        </View>
      </View>
      <T v="label">{def.label} · YOU OWN</T>
      {def.kind ? (
        <View style={styles.grid}>
          {owned.map((g) => {
            const on = eq[slot] === g.key;
            const hue = RARITY_COLOR[g.rarity];
            return (
              <Pressable key={g.key} onPress={() => equip(g.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={g.name}>
                {(st) => (
                  <PixelBox fill={on ? 'rgba(62,230,255,0.14)' : (st as { hovered?: boolean }).hovered ? '#15224a' : 'rgba(11,20,48,0.9)'} hi={on ? COLORS.teal : hue} lo="#04060f" style={styles.item}>
                    <View style={styles.itemArt}>
                      <Part k={g.key} scale={2} icon />
                    </View>
                    <T v="bold" numberOfLines={2} style={{ fontSize: 12, textAlign: 'center' }}>
                      {g.name}
                    </T>
                    <T v="display" style={{ fontSize: 11, color: on ? COLORS.teal : hue }}>
                      {on ? (def.kind === 'pet' ? 'WITH YOU · TAP TO LEAVE' : 'EQUIPPED') : g.rarity.toUpperCase()}
                    </T>
                  </PixelBox>
                )}
              </Pressable>
            );
          })}
          {!owned.length ? <T v="muted">Nothing for this slot yet.</T> : null}
        </View>
      ) : (
        <T v="muted">Shoes arrive with the Gear 555 drop: 92 pairs, from Farmer Gumboots to rocket boots.</T>
      )}
      <Btn kind="teal" label={locked > 0 ? `MORE IN THE GEAR MARKET` : 'SEE THE GEAR MARKET'} onPress={() => showMarket(slot === 'head' ? 'head' : slot === 'clothes' ? 'clothes' : slot === 'shoes' ? 'shoes' : slot === 'weapon' ? 'weapons' : 'pets')} />
    </PixelBox>
  );
}

export function Inventory() {
  const owner = useGame((s) => s.wallet.owner);
  const { cert, items, loading, error, refresh, openPopup } = useNft();
  useEffect(() => {
    void refresh(owner, true);
  }, [owner, refresh]);

  const certs = items.filter((i) => i.kind === 'cert');
  const gear = items.filter((i) => i.kind === 'gear');
  const minted = cert?.claim?.status === 'minted';
  return (
    <View style={{ gap: 12 }}>
      <Wardrobe />

      <T v="label" style={{ marginTop: 6 }}>
        GALI NFTS
      </T>
      {!owner ? (
        <Card>
          <T>Connect a wallet to see the Gali NFTs it holds.</T>
        </Card>
      ) : minted || certs.length ? (
        <PixelBox fill="rgba(60,40,8,0.6)" hi={COLORS.gold} lo="#04060f" style={styles.cert}>
          <CertCard width={300} />
          <T v="display" style={{ fontSize: 22, color: COLORS.gold }}>
            {certs[0]?.name ?? `Gali Founding Miner #${String(cert?.claim?.serial ?? 0).padStart(4, '0')}`}
          </T>
          <T v="muted" style={{ fontSize: 13, textAlign: 'center' }}>
            {cert ? `${cert.rounds} beta rounds · first dig ${fmtDay(cert.firstAt)} · soulbound` : 'Soulbound'}
          </T>
          <T style={{ textAlign: 'center' }}>Claims the Legendary Jarl Helmet when the Gali NFT market opens.</T>
          {cert ? <CertShare cert={cert} /> : null}
        </PixelBox>
      ) : cert?.eligible ? (
        <Card glow={COLORS.gold}>
          <T v="bold">You are a Founding Miner: you mined ORE during the closed beta.</T>
          <Btn kind="gold" label="CLAIM CERTIFICATE" onPress={openPopup} style={{ marginTop: 8 }} />
        </Card>
      ) : (
        <Card>
          <T v="muted">{loading || !cert ? 'Checking your wallet...' : 'No Gali NFTs yet. Founding Miner certificates go to wallets that mined a live ORE round during the closed beta; Gear 555 comes with the market.'}</T>
        </Card>
      )}
      {gear.length ? (
        <View style={styles.grid}>
          {gear.map((g) => (
            <PixelBox key={g.id} fill="rgba(11,20,48,0.9)" hi="#2d4282" lo="#04060f" style={styles.item}>
              {g.image ? <Image source={{ uri: g.image }} style={[{ width: 72, height: 72 }, PIX]} /> : <PixIcon name="bag" size={48} />}
              <T v="bold" numberOfLines={2} style={{ fontSize: 12, textAlign: 'center' }}>
                {g.name}
              </T>
            </PixelBox>
          ))}
        </View>
      ) : null}
      {error && owner ? (
        <T v="muted" style={{ fontSize: 12, color: COLORS.red }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  stage: { width: 260, height: 190, alignItems: 'center', justifyContent: 'center', backgroundColor: '#120c1e', borderWidth: 2, borderColor: '#2d4282' },
  slots: { flex: 1, minWidth: 220, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slot: { width: 98, padding: 6, gap: 2, alignItems: 'center' },
  slotArt: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { width: 112, padding: 8, gap: 4, alignItems: 'center' },
  itemArt: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: '#120c1e' },
  cert: { padding: 12, gap: 6, alignItems: 'center' },
});
