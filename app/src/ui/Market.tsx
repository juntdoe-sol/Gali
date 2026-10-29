/**
 * The Gear Market: a showcase of Gear 555 behind the vending machine in the lobby. Five categories, a rarity
 * filter, every item drawn on a silhouette miner so the gear stands out, Legendary items animated. Buying opens
 * with the Gali NFT market; until then each item says how many will drop.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { CATS, loadGear, RARITIES, RARITY_HUE, type GearBook, type GearItem } from '../game/gear555';
import { useMarket } from '../game/market';
import { useNft } from '../game/nft';
import { play } from '../game/sfx';
import { GearSprite } from './GearSprite';
import { Btn, Choice, Frame, IconBtn, PixelBox, T } from './kit';
import { useLayout } from './layout';
import { PixIcon } from './PixIcon';

const supplyLine = (it: GearItem) =>
  it.supply === 'claim' ? 'Claim only: Founding Miner certificate' : `${it.supply.toLocaleString()} will drop`;

export function MarketWindow() {
  const open = useMarket((s) => s.open);
  const hide = useMarket((s) => s.hide);
  const { desktop, w, h } = useLayout();
  const insets = useSafeAreaInsets();
  if (!open) return null;
  const width = desktop ? Math.min(980, w - 48) : w;
  const height = desktop ? Math.min(760, h - 48) : h - insets.top;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={hide}>
      <Pressable style={styles.scrim} onPress={hide} accessibilityLabel="Close the market" />
      <View style={[styles.wrap, desktop ? { alignItems: 'center', justifyContent: 'center' } : { justifyContent: 'flex-end' }]} pointerEvents="box-none">
        <Frame style={{ width, height, paddingTop: 12 }}>
          <MarketBody wide={width >= 720} bottomPad={desktop ? 12 : insets.bottom + 12} />
        </Frame>
      </View>
    </Modal>
  );
}

function MarketBody({ wide, bottomPad }: { wide: boolean; bottomPad: number }) {
  const { cat, rarity, pick, setCat, setRarity, setPick, hide } = useMarket();
  const [book, setBook] = useState<GearBook | null>(null);
  useEffect(() => {
    void loadGear().then(setBook);
  }, []);
  const items = useMemo(() => (book ? book.items.filter((it) => it.cat === cat && (rarity === 'all' || it.rarity === rarity)) : []), [book, cat, rarity]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of book?.items ?? []) c[it.cat] = (c[it.cat] ?? 0) + 1;
    return c;
  }, [book]);
  const chosen = pick ? book?.items.find((it) => it.id === pick) ?? null : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <PixIcon name="bag" size={32} />
        <View style={{ flex: 1 }}>
          <T v="display" style={{ fontSize: 30, lineHeight: 32, letterSpacing: 1, color: COLORS.gold }}>
            GEAR MARKET
          </T>
          <T v="muted" style={{ fontSize: 13 }} numberOfLines={2}>
            555 cosmetic NFTs, first drop coming soon. Gear changes how your miner looks, never the odds.
          </T>
        </View>
        <IconBtn onPress={hide} label="Close" kbd="ESC">
          <PixIcon name="close" size={18} />
        </IconBtn>
      </View>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {CATS.map((c) => (
          <Choice key={c.id} grow={false} label={c.label} sub={counts[c.id] ? String(counts[c.id]) : undefined} on={cat === c.id} onPress={() => setCat(c.id)} />
        ))}
      </ScrollView>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingTop: 0 }]}>
        <Choice grow={false} label="ALL" on={rarity === 'all'} onPress={() => setRarity('all')} />
        {RARITIES.map((r) => (
          <Choice key={r} grow={false} label={r.toUpperCase()} on={rarity === r} onPress={() => setRarity(r)} />
        ))}
      </ScrollView>
      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.grid, { paddingBottom: bottomPad }]}>
          {!book ? (
            <T v="muted" style={{ padding: 20 }}>
              Opening the market...
            </T>
          ) : (
            items.map((it) => <Card key={it.id} it={it} on={it.id === pick} onPress={() => (play('select'), setPick(it.id === pick ? null : it.id))} />)
          )}
        </ScrollView>
        {chosen ? <Detail it={chosen} wide={wide} onClose={() => setPick(null)} /> : null}
      </View>
    </View>
  );
}

function Card({ it, on, onPress }: { it: GearItem; on: boolean; onPress: () => void }) {
  const hue = RARITY_HUE[it.rarity];
  const legend = it.rarity === 'Legendary';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${it.name}, ${it.rarity}`}>
      {(st) => (
        <PixelBox
          fill={on ? '#1d2d5e' : (st as { hovered?: boolean }).hovered ? '#15224a' : legend ? 'rgba(60,40,8,0.85)' : 'rgba(11,20,48,0.9)'}
          hi={on ? COLORS.teal : hue}
          lo="#04060f"
          edge={on ? COLORS.teal : '#04060f'}
          style={styles.card}
        >
          <View style={[styles.stage, { backgroundColor: legend ? '#24170a' : '#120c1e' }]}>
            <GearSprite item={it} scale={2} animate={legend} />
          </View>
          <T v="bold" numberOfLines={2} style={styles.name}>
            {it.name}
          </T>
          <T v="display" style={{ fontSize: 13, lineHeight: 14, color: hue, letterSpacing: 0.6 }}>
            {it.rarity.toUpperCase()}
          </T>
        </PixelBox>
      )}
    </Pressable>
  );
}

function Detail({ it, wide, onClose }: { it: GearItem; wide: boolean; onClose: () => void }) {
  const hue = RARITY_HUE[it.rarity];
  const cert = useNft((s) => s.cert);
  const openClaim = useNft((s) => s.openPopup);
  const jarl = it.supply === 'claim';
  return (
    <PixelBox fill="rgba(7,13,32,0.96)" hi={hue} lo="#04060f" style={[styles.detail, wide ? { width: 300 } : { maxHeight: 330 }]}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 8, alignItems: 'center' }}>
        <View style={[styles.stageBig, { borderColor: hue }]}>
          <GearSprite item={it} scale={4} animate />
        </View>
        <T v="display" style={{ fontSize: 24, lineHeight: 26, textAlign: 'center' }}>
          {it.name}
        </T>
        <T v="display" style={{ fontSize: 15, color: hue, letterSpacing: 1 }}>
          {it.rarity.toUpperCase()} · {it.sub.toUpperCase()}
        </T>
        <T style={{ textAlign: 'center', fontStyle: 'italic' }}>"{it.flavor}"</T>
        <T v="muted" style={{ fontSize: 13 }}>
          Set: {it.set} · {it.id}
        </T>
        <T v="bold" style={{ fontSize: 13, color: COLORS.gold }}>
          {supplyLine(it)}
        </T>
        {jarl ? (
          cert?.eligible ? (
            <Btn kind="gold" label={cert.claim?.status === 'minted' ? 'YOUR CERTIFICATE' : 'CLAIM CERTIFICATE'} onPress={openClaim} />
          ) : (
            <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
              Founding Miners mined ORE during the closed beta. Their certificate claims this helmet when the market opens.
            </T>
          )
        ) : (
          <View style={styles.soon}>
            <T v="display" style={{ fontSize: 13, lineHeight: 14, color: '#070d20', letterSpacing: 1 }}>
              COMING SOON
            </T>
          </View>
        )}
        <Btn kind="ghost" label="CLOSE" onPress={onClose} />
      </ScrollView>
    </PixelBox>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2,4,12,0.62)' },
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, padding: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  chips: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16, justifyContent: 'flex-start' },
  card: { width: 112, padding: 8, gap: 4, alignItems: 'center' },
  stage: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  stageBig: { width: 172, height: 172, alignItems: 'center', justifyContent: 'center', backgroundColor: '#120c1e', borderWidth: 2 },
  name: { fontSize: 13, lineHeight: 15, textAlign: 'center', minHeight: 30 },
  detail: { margin: 10 },
  soon: { backgroundColor: COLORS.gold, paddingHorizontal: 10, paddingVertical: 4 },
});
