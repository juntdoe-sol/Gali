/**
 * Gear Market: a design preview, not a working market.
 *
 * The plan: every gear item becomes a Metaplex Core NFT in the player's wallet,
 * tradeable with other miners for SOL or SKR. A 5% royalty on each resale is split
 * the way first sales are today: most of it to the SKR jackpot pool, the rest to the
 * treasury. Nothing here signs or sends. Listings are samples, labelled as such, and
 * every action button explains that the market is not open yet.
 */
import { useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { COLORS, GEAR, GEAR_KINDS, MOTHERLODE_POOL_SHARE, RARITY_COLOR, usd, type Gear, type GearKind } from '../game/constants';
import { useGame, useOwnedMask } from '../game/store';
import { GEAR_ICON as PIXEL_ICON } from './gearIcons';
import { GEAR_ICON, ITEM_ICON } from './icons';
import { Btn, Card, Pill, T } from './kit';

/** Royalty on every resale, in basis points. */
export const ROYALTY_BPS = 500;
const ROYALTY = ROYALTY_BPS / 10_000;
const POOL_SHARE = MOTHERLODE_POOL_SHARE;

const SOON = 'The market opens after launch. This page is a preview.';

export function GearIcon({ g, size = 54 }: { g: Gear; size?: number }) {
  const px = PIXEL_ICON[g.key];
  return (
    <View style={[styles.icon, { width: size, height: size, borderColor: RARITY_COLOR[g.rarity], backgroundColor: g.accent + '22' }]}>
      {px ? (
        <Image source={px} style={{ width: size * 0.74, height: size * 0.74 }} {...({ dataSet: { pixelart: '1' } } as object)} />
      ) : (
        <T style={{ fontSize: size * 0.44 }}>{ITEM_ICON[g.key] ?? GEAR_ICON[g.kind]}</T>
      )}
    </View>
  );
}

interface Listing {
  id: string;
  gear: Gear;
  edition: number;
  seller: string;
  price: number;
  unit: 'SKR' | 'SOL';
}

/** Stable pseudo-random numbers, so the sample listings look the same on every visit. */
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeKey = (seed: number) => {
  let s = '';
  for (let i = 0; i < 8; i++) s += B58[hash(seed * 31 + i) % B58.length];
  return `${s.slice(0, 4)}…${s.slice(4)}`;
};

/** Sample listings: one to three of each paid item, priced around its Store price. */
function sampleListings(): Listing[] {
  const out: Listing[] = [];
  for (const g of GEAR) {
    if (g.priceSkr === 0) continue;
    const n = 1 + (hash(g.id) % 3);
    for (let k = 0; k < n; k++) {
      const h = hash(g.id * 97 + k);
      const mult = 0.7 + (h % 90) / 100; // 0.7x to 1.6x the Store price
      out.push({
        id: `${g.key}-${k}`,
        gear: g,
        edition: 1 + (h % 900),
        seller: fakeKey(h),
        // samples are priced in SKR only, so they line up with the Store's prices
        price: Math.round((g.priceSkr * mult) / 10) * 10,
        unit: 'SKR',
      });
    }
  }
  return out;
}

const fmtPrice = (l: { price: number; unit: 'SKR' | 'SOL' }) =>
  l.unit === 'SOL' ? `${l.price} SOL` : `${l.price.toLocaleString()} SKR`;

export function Market() {
  const [view, setView] = useState<'browse' | 'mine'>('browse');
  return (
    <>
      <Card glow={COLORS.gold}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <T v="label">🏪 Gear Market</T>
          <Pill text="COMING SOON" color={COLORS.gold} fg="#2a1a00" />
        </View>
        <T>Every item you buy becomes an NFT in your wallet. Trade it with other miners for SOL or SKR.</T>
        <T v="muted" style={{ marginTop: 6 }}>
          A {ROYALTY_BPS / 100}% royalty on every resale goes {Math.round(POOL_SHARE * 100)}% to the SKR jackpot pool and {Math.round((1 - POOL_SHARE) * 100)}% to the treasury. Gear stays cosmetic: it never changes your odds.
        </T>
      </Card>
      <View style={styles.seg}>
        {(
          [
            ['browse', 'Browse'],
            ['mine', 'My items'],
          ] as const
        ).map(([id, label]) => (
          <Pressable key={id} onPress={() => setView(id)} style={[styles.segBtn, view === id && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: view === id }}>
            <T v="bold" style={{ fontSize: 13, color: view === id ? COLORS.text : COLORS.muted }}>
              {label}
            </T>
          </Pressable>
        ))}
      </View>
      {view === 'browse' ? <Browse /> : <MyItems />}
      <T v="muted" style={{ textAlign: 'center', fontSize: 11 }}>
        Preview only. Listings are samples and nothing here is on chain yet.
      </T>
    </>
  );
}

function KindChips({ kind, onKind }: { kind: GearKind | 'all'; onKind: (k: GearKind | 'all') => void }) {
  const all: { kind: GearKind | 'all'; label: string }[] = [{ kind: 'all', label: 'All' }, ...GEAR_KINDS];
  return (
    <View style={styles.chips}>
      {all.map((k) => (
        <Pressable key={k.kind} onPress={() => onKind(k.kind)} style={[styles.chip, kind === k.kind && styles.chipOn]}>
          <T v="bold" style={{ fontSize: 12, color: kind === k.kind ? COLORS.gold : COLORS.muted }}>
            {k.kind === 'all' ? '' : `${GEAR_ICON[k.kind]} `}
            {k.label}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

function Browse() {
  const toast = useGame((s) => s.toast);
  const listings = useMemo(sampleListings, []);
  const [kind, setKind] = useState<GearKind | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const shown = listings
    .filter((l) => kind === 'all' || l.gear.kind === kind)
    .sort((a, b) => b.gear.priceSkr - a.gear.priceSkr);
  const floor = (g: Gear) => Math.min(...listings.filter((l) => l.gear.id === g.id && l.unit === 'SKR').map((l) => l.price));
  return (
    <>
      <KindChips kind={kind} onKind={setKind} />
      <T v="muted" style={{ fontSize: 11 }}>
        {shown.length} sample listings · rarest first
      </T>
      {shown.map((l) => {
        const g = l.gear;
        const on = open === l.id;
        const fl = floor(g);
        return (
          <Pressable key={l.id} onPress={() => setOpen(on ? null : l.id)} accessibilityRole="button" accessibilityLabel={`${g.name} for ${fmtPrice(l)}`}>
            <Card style={{ borderColor: RARITY_COLOR[g.rarity] + '99' }}>
              <View style={styles.row}>
                <GearIcon g={g} />
                <View style={{ flex: 1 }}>
                  <T v="bold">
                    {g.name} <T v="muted">#{String(l.edition).padStart(3, '0')}</T>
                  </T>
                  <T v="bold" style={{ fontSize: 11, color: RARITY_COLOR[g.rarity], textTransform: 'capitalize' }}>
                    {g.rarity} {g.kind}
                  </T>
                  <T v="muted" style={{ fontSize: 11 }}>
                    Seller {l.seller}
                  </T>
                </View>
                <Btn small kind="skr" label={`Buy ${fmtPrice(l)}`} sub={l.unit === 'SKR' ? usd(l.price) : undefined} onPress={() => toast(SOON, 'info')} />
              </View>
              {on ? (
                <View style={styles.detail}>
                  <Trait k="Perk" v={g.perk} />
                  <Trait k="Store price" v={`${g.priceSkr.toLocaleString()} SKR`} />
                  <Trait k="Floor" v={Number.isFinite(fl) ? `${fl.toLocaleString()} SKR` : '—'} />
                  <Trait k="Royalty" v={`${ROYALTY_BPS / 100}% · ${Math.round(POOL_SHARE * 100)}% to the SKR pool`} />
                  <Trait k="Standard" v="Metaplex Core NFT" />
                  <T v="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Buying moves the NFT to your wallet, and it shows on your miner at once.
                  </T>
                </View>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </>
  );
}

function Trait({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.trait}>
      <T v="muted" style={{ fontSize: 12 }}>
        {k}
      </T>
      <T v="bold" style={{ fontSize: 12, flexShrink: 1, textAlign: 'right' }}>
        {v}
      </T>
    </View>
  );
}

function MyItems() {
  const toast = useGame((s) => s.toast);
  const owned = useOwnedMask();
  const save = useGame((s) => s.save);
  const equipped = [save.pickaxe, save.helmet, save.outfit, save.pet];
  const real = GEAR.filter((g) => owned & (1 << g.id));
  // nothing bought yet: show two sample items so the listing flow can be seen
  const samples = real.some((g) => g.priceSkr > 0) ? [] : GEAR.filter((g) => g.key === 'pick-gold' || g.key === 'hat-songkok');
  const mine = [...real, ...samples];
  const [selling, setSelling] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<'SKR' | 'SOL'>('SKR');
  const p = Number(price) || 0;
  const fee = p * ROYALTY;
  return (
    <>
      <T v="muted" style={{ fontSize: 12 }}>
        Starter gear is free and bound to your miner. Anything you buy in the Store can be listed here.
      </T>
      {mine.map((g) => {
        const starter = g.priceSkr === 0;
        const on = equipped.includes(g.key);
        const open = selling === g.key;
        return (
          <Card key={g.key} style={{ borderColor: RARITY_COLOR[g.rarity] + '99' }}>
            <View style={styles.row}>
              <GearIcon g={g} />
              <View style={{ flex: 1 }}>
                <T v="bold">{g.name}</T>
                <T v="bold" style={{ fontSize: 11, color: RARITY_COLOR[g.rarity], textTransform: 'capitalize' }}>
                  {g.rarity} {g.kind}
                  {on ? ' · equipped' : ''}
                  {samples.includes(g) ? ' · sample' : ''}
                </T>
              </View>
              {starter ? (
                <Pill text="BOUND" />
              ) : (
                <Btn
                  small
                  label={open ? 'Cancel' : 'List for sale'}
                  onPress={() => {
                    setSelling(open ? null : g.key);
                    setPrice(open ? '' : String(g.priceSkr));
                    setUnit('SKR');
                  }}
                />
              )}
            </View>
            {open ? (
              <View style={styles.detail}>
                <View style={styles.row}>
                  <View style={styles.priceBox}>
                    <TextInput
                      value={price}
                      onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="Price"
                      placeholderTextColor={COLORS.muted}
                      style={[styles.input, WEB_NO_OUTLINE]}
                      accessibilityLabel="Listing price"
                    />
                  </View>
                  {(['SKR', 'SOL'] as const).map((u) => (
                    <Pressable key={u} onPress={() => setUnit(u)} style={[styles.chip, unit === u && styles.chipOn]}>
                      <T v="bold" style={{ fontSize: 12, color: unit === u ? COLORS.gold : COLORS.muted }}>
                        {u}
                      </T>
                    </Pressable>
                  ))}
                </View>
                <Trait k={`Royalty ${ROYALTY_BPS / 100}%`} v={`${fmtAmt(fee)} ${unit}`} />
                <Trait k="You receive" v={`${fmtAmt(p - fee)} ${unit}`} />
                <Btn kind="gold" label="List on the market" sub="Coming soon" disabled={!(p > 0)} onPress={() => toast(SOON, 'info')} />
              </View>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}

const fmtAmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString() : Number(v.toFixed(4)).toString());

const WEB_NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

const styles = StyleSheet.create({
  icon: { borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: '#00000055', borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  segOn: { backgroundColor: COLORS.card2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#00000033' },
  chipOn: { borderColor: COLORS.gold, backgroundColor: COLORS.card2 },
  detail: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: COLORS.line, gap: 6 },
  trait: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  priceBox: { flex: 1, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, paddingHorizontal: 10, backgroundColor: '#00000044' },
  input: { color: COLORS.text, fontSize: 16, paddingVertical: 8, fontFamily: Platform.OS === 'web' ? 'inherit' : undefined },
});
