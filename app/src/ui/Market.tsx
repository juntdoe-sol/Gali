/**
 * The Gear Market: Gear 555 on a holo terminal, behind the vending machine in the lobby.
 *
 * SHOWCASE (the default): one item at a time on a holo pedestal, worn by your miner or on its own. Swipe it (finger
 * or mouse), press the arrows or use the keyboard to step through; the filmstrip under it jumps anywhere. The spec
 * sheet beside it reads out rarity, set, supply and mint status. GRID: the whole category at a glance; a tap sends
 * that item to the stage. Buying opens with the Gali NFT market; until then each item says how many will drop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { CATS, loadGear, RARITIES, RARITY_HUE, TRYON_CELL, type GearBook, type GearCat, type GearItem, type GearRarity } from '../game/gear555';
import { useMarket } from '../game/market';
import { useNft } from '../game/nft';
import { play } from '../game/sfx';
import { useName } from '../game/username';
import { GearSprite, TryOnSprite } from './GearSprite';
import { Frame, IconBtn, T, U } from './kit';
import { useLayout } from './layout';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { alpha, Corners, HoloStage, Led, Materialize, Meter, Pager, Prompt, Readout, stageGeo, TECH, TechBtn, TechPanel, TechTab, useTick, type PagerRef } from './tech';

const isWeb = Platform.OS === 'web';
const CAT_ICON: Record<GearCat, PixName> = { head: 'helmet', clothes: 'vest', shoes: 'jump', weapons: 'pick', pets: 'paw' };
const CAT_WORD: Record<GearCat, string> = { head: 'HEAD', clothes: 'CLOTHES', shoes: 'SHOES', weapons: 'WEAPON', pets: 'PET' };
const TIER: Record<GearRarity, number> = { Common: 1, Uncommon: 2, Rare: 3, Legendary: 4 };
const pad = (n: number, w = 3) => String(n).padStart(w, '0');

export function MarketWindow() {
  const open = useMarket((s) => s.open);
  const hide = useMarket((s) => s.hide);
  const { desktop, w, h } = useLayout();
  const insets = useSafeAreaInsets();
  if (!open) return null;
  const width = desktop ? Math.min(1040, w - 48) : w;
  const height = desktop ? Math.min(780, h - 48) : h - insets.top;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={hide}>
      <Pressable style={styles.scrim} onPress={hide} accessibilityLabel="Close the market" />
      <View style={[styles.wrap, desktop ? { alignItems: 'center', justifyContent: 'center' } : { justifyContent: 'flex-end' }]} pointerEvents="box-none">
        <Frame style={{ width, height, paddingTop: 12, backgroundColor: TECH.deep }}>
          <MarketBody wide={width >= 760} bottomPad={desktop ? 12 : insets.bottom + 12} />
        </Frame>
      </View>
    </Modal>
  );
}

function MarketBody({ wide, bottomPad }: { wide: boolean; bottomPad: number }) {
  const { cat, rarity, pick, setCat, setRarity, setPick, hide } = useMarket();
  const [book, setBook] = useState<GearBook | null>(null);
  const [view, setView] = useState<'show' | 'grid'>('show');
  const [tryOn, setTryOn] = useState(true);
  const sex = useName((s) => s.sex) === 'f' ? 'f' : 'm';
  const pager = useRef<PagerRef>(null);
  useEffect(() => {
    void loadGear().then(setBook);
  }, []);
  const inCat = useMemo(() => (book ? book.items.filter((it) => it.cat === cat) : []), [book, cat]);
  const items = useMemo(() => inCat.filter((it) => rarity === 'all' || it.rarity === rarity), [inCat, rarity]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of book?.items ?? []) c[it.cat] = (c[it.cat] ?? 0) + 1;
    return c;
  }, [book]);
  const rarCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of inCat) c[it.rarity] = (c[it.rarity] ?? 0) + 1;
    return c;
  }, [inCat]);
  const idx = Math.max(0, pick ? items.findIndex((it) => it.id === pick) : 0);
  const it = items[idx] ?? null;
  const jump = (g: GearItem) => {
    if (g.cat !== cat) setCat(g.cat);
    if (rarity !== 'all' && rarity !== g.rarity) setRarity('all');
    setPick(g.id);
  };
  const setIdx = (i: number) => {
    const next = items[i];
    if (next) setPick(next.id);
  };

  // keyboard: arrows step through the showcase (and do not walk the miner behind the window)
  useEffect(() => {
    if (!isWeb || view !== 'show') return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      pager.current?.go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [view]);

  const switcher = (
    <View style={styles.viewSwitch}>
      <TechTab label={wide ? 'SHOWCASE' : 'SHOW'} on={view === 'show'} onPress={() => setView('show')} />
      <TechTab label="GRID" on={view === 'grid'} onPress={() => setView('grid')} />
    </View>
  );
  const head = (
    <View style={styles.head}>
      <View style={[styles.logo, !wide && { width: 36, height: 36 }]}>
        <PixIcon name="bag" size={26} />
        <Corners color={COLORS.teal} size={5} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="display" numberOfLines={1} style={{ fontSize: wide ? 30 : 24, lineHeight: wide ? 30 : 24, letterSpacing: 2, color: COLORS.text }}>
          GEAR <T v="display" style={{ fontSize: wide ? 30 : 24, lineHeight: wide ? 30 : 24, color: COLORS.teal }}>MARKET</T>
        </T>
        {wide ? <Prompt text={`gali://market  ${book ? book.items.length : '...'} items  drop 01  status: pre-mint  gear changes looks, never the odds`} /> : null}
      </View>
      {wide ? switcher : null}
      <IconBtn onPress={hide} label="Close" kbd="ESC">
        <PixIcon name="close" size={18} />
      </IconBtn>
    </View>
  );
  const headAll = wide ? (
    head
  ) : (
    <>
      {head}
      <View style={styles.subHead}>
        <Prompt text="pre-mint · drop 01" style={{ flex: 1 }} />
        {switcher}
      </View>
    </>
  );

  const filters = (
    <>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {CATS.map((c) => (
          <TechTab
            key={c.id}
            label={c.label}
            count={counts[c.id] ? pad(counts[c.id]) : undefined}
            on={cat === c.id}
            icon={<PixIcon name={CAT_ICON[c.id]} size={16} />}
            onPress={() => {
              setCat(c.id);
              setRarity('all');
            }}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabs, { paddingTop: 2 }]}>
        <RarityChip label="ALL" n={inCat.length} hue={COLORS.text} on={rarity === 'all'} onPress={() => setRarity('all')} />
        {RARITIES.map((r) => (
          <RarityChip key={r} label={r.toUpperCase()} n={rarCount[r] ?? 0} hue={RARITY_HUE[r]} on={rarity === r} onPress={() => setRarity(r)} />
        ))}
      </ScrollView>
    </>
  );

  if (!book) {
    return (
      <View style={{ flex: 1 }}>
        {headAll}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Prompt text="booting the market terminal" />
        </View>
      </View>
    );
  }

  if (view === 'grid') {
    return (
      <View style={{ flex: 1 }}>
        {headAll}
        {filters}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.grid, { paddingBottom: bottomPad }]}>
          {items.map((g, i) => (
            <GridCell
              key={g.id}
              it={g}
              on={g.id === it?.id}
              onPress={() => {
                play('select');
                setIdx(i);
                setView('show');
              }}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  const stageBlock = (stageW: number, stageH: number) =>
    it ? (
      <MarketStage pagerRef={pager} items={items} idx={idx} onIndex={setIdx} tryOn={tryOn} sex={sex} width={stageW} height={stageH} />
    ) : (
      <View style={{ width: stageW, height: stageH, alignItems: 'center', justifyContent: 'center', backgroundColor: TECH.ink }}>
        <T v="muted">Nothing in this filter.</T>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      {headAll}
      {filters}
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: bottomPad, paddingTop: 6 }}>
          <Measure style={{ flex: 1 }}>
            {(w, h) => (
              <View style={{ gap: 8 }}>
                {stageBlock(w, Math.max(260, h - 96))}
                <Strip items={items} idx={idx} onPick={setIdx} width={w} />
              </View>
            )}
          </Measure>
          {it ? <Spec it={it} tryOn={tryOn} setTryOn={setTryOn} n={idx} of={items.length} style={{ width: 312 }} book={book} onJump={jump} /> : null}
        </View>
      ) : (
        <Measure style={{ flex: 1 }}>
          {(w) => (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: bottomPad, gap: 10 }}>
              {stageBlock(w - 24, Math.min(360, Math.max(280, Math.round((w - 24) * 0.9))))}
              <Strip items={items} idx={idx} onPick={setIdx} width={w - 24} />
              {it ? <Spec it={it} tryOn={tryOn} setTryOn={setTryOn} n={idx} of={items.length} book={book} onJump={jump} /> : null}
            </ScrollView>
          )}
        </Measure>
      )}
    </View>
  );
}

/** Renders its child with the box's own size once laid out. */
function Measure({ children, style }: { children: (w: number, h: number) => React.ReactNode; style?: object }) {
  const [size, setSize] = useState<[number, number] | null>(null);
  const on = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.floor(width / U) * U;
    const h = Math.floor(height / U) * U;
    if (!size || size[0] !== w || size[1] !== h) setSize([w, h]);
  };
  return (
    <View style={style} onLayout={on}>
      {size ? children(size[0], size[1]) : null}
    </View>
  );
}

function RarityChip({ label, n, hue, on, onPress }: { label: string; n: number; hue: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        play('select');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}, ${n} items`}
      disabled={n === 0 && !on}
    >
      {(st) => (
        <View
          style={[
            styles.chip,
            {
              borderColor: on ? hue : TECH.rule,
              backgroundColor: on ? alpha(hue.startsWith('#') ? hue : '#ffffff', 0.16) : (st as { hovered?: boolean }).hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
              opacity: n === 0 && !on ? 0.35 : 1,
            },
          ]}
        >
          <View style={{ width: 6, height: 6, backgroundColor: hue }} />
          <T v="display" style={{ fontSize: 15, lineHeight: 16, letterSpacing: 1, color: on ? hue : COLORS.text }}>
            {label}
          </T>
          <T v="tiny" style={{ fontSize: 8, color: TECH.dim }}>
            {pad(n)}
          </T>
        </View>
      )}
    </Pressable>
  );
}

/** The holo pedestal with the pager of items on it, the HUD, and the arrows. */
function MarketStage({
  pagerRef,
  items,
  idx,
  onIndex,
  tryOn,
  sex,
  width,
  height,
}: {
  pagerRef: React.RefObject<PagerRef | null>;
  items: GearItem[];
  idx: number;
  onIndex: (i: number) => void;
  tryOn: boolean;
  sex: 'm' | 'f';
  width: number;
  height: number;
}) {
  const it = items[idx];
  const hue = RARITY_HUE[it.rarity];
  const geo = stageGeo(width, height, 0.46);
  const n = items.length;
  const prev = items[(idx - 1 + n) % n];
  const next = items[(idx + 1) % n];
  return (
    <View style={{ width, height }}>
      <HoloStage width={width} height={height} color={hue} pedestal={0.46}>
        <View style={StyleSheet.absoluteFill}>
          <Pagerish pagerRef={pagerRef} items={items} idx={idx} onIndex={onIndex} tryOn={tryOn} sex={sex} width={width} height={height} feet={geo.feet} />
        </View>
      </HoloStage>
      {/* HUD */}
      <View pointerEvents="none" style={styles.hudTL}>
        <Led color={hue} blink />
        <T v="tiny" style={{ fontSize: 10, letterSpacing: 1, color: hue }}>
          {tryOn ? 'ON YOUR MINER' : 'ITEM VIEW'}
        </T>
      </View>
      <View pointerEvents="none" style={styles.hudTR}>
        <T v="display" style={{ fontSize: 22, lineHeight: 22, color: COLORS.text, letterSpacing: 1 }}>
          {pad(idx + 1)}
        </T>
        <T v="tiny" style={{ fontSize: 10, color: TECH.dim }}>
          /{pad(n)}
        </T>
      </View>
      <View pointerEvents="none" style={styles.hudB}>
        <T v="display" numberOfLines={1} style={{ fontSize: 24, lineHeight: 24, letterSpacing: 1, color: COLORS.text, textAlign: 'center' }}>
          {it.name}
        </T>
        <T v="tiny" style={{ fontSize: 10, letterSpacing: 2, color: hue, textAlign: 'center' }}>
          {it.rarity.toUpperCase()} · {it.id}
        </T>
      </View>
      {n > 1 ? (
        <>
          <Arrow side="left" item={prev} onPress={() => pagerRef.current?.go(-1)} />
          <Arrow side="right" item={next} onPress={() => pagerRef.current?.go(1)} />
        </>
      ) : null}
      {/* position rail */}
      <View pointerEvents="none" style={styles.rail}>
        <View style={{ position: 'absolute', left: `${(idx / Math.max(1, n)) * 100}%`, width: `${Math.max(2, 100 / Math.max(1, n))}%`, top: 0, bottom: 0, backgroundColor: hue }} />
      </View>
    </View>
  );
}

function Pagerish(p: { pagerRef: React.RefObject<PagerRef | null>; items: GearItem[]; idx: number; onIndex: (i: number) => void; tryOn: boolean; sex: 'm' | 'f'; width: number; height: number; feet: number }) {
  return (
    <Pager
      ref={p.pagerRef}
      width={p.width}
      height={p.height}
      count={p.items.length}
      index={p.idx}
      onIndex={p.onIndex}
      render={(i, center) => <StageItem key={p.items[i].id + (p.tryOn ? 't' : 'i')} it={p.items[i]} center={center} tryOn={p.tryOn} sex={p.sex} width={p.width} feet={p.feet} />}
    />
  );
}

/** One item standing on the pedestal, bobbing a pixel while it is the one on show. */
function StageItem({ it, center, tryOn, sex, width, feet }: { it: GearItem; center: boolean; tryOn: boolean; sex: 'm' | 'f'; width: number; feet: number }) {
  const t = useTick(560, center);
  const bob = center && t % 2 === 1 ? -U : 0;
  const hue = RARITY_HUE[it.rarity];
  const cx = width / 2;
  let body: React.ReactNode;
  if (tryOn) {
    // try-on cells are 40x56 with the miner's feet on row 53
    const s = Math.max(3, Math.min(7, Math.floor((feet * 0.62) / 30)));
    body = (
      <View style={{ position: 'absolute', left: Math.round(cx - (TRYON_CELL[0] * s) / 2), top: feet - 53 * s + bob }}>
        <TryOnSprite item={it} sex={sex} scale={s} />
      </View>
    );
  } else {
    const s = Math.max(3, Math.min(7, Math.floor((feet * 0.66) / 40)));
    body = (
      <View style={{ position: 'absolute', left: Math.round(cx - 20 * s), top: feet - 39 * s + bob }}>
        <GearSprite item={it} scale={s} animate={center && it.anim !== null} />
      </View>
    );
  }
  return (
    <Materialize color={hue} style={StyleSheet.absoluteFill}>
      {body}
    </Materialize>
  );
}

function Arrow({ side, item, onPress }: { side: 'left' | 'right'; item: GearItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={side === 'left' ? `Previous: ${item.name}` : `Next: ${item.name}`} style={[styles.arrow, side === 'left' ? { left: 10 } : { right: 10 }]}>
      {(st) => {
        const hov = (st as { hovered?: boolean }).hovered;
        return (
          <View style={[styles.arrowBox, { borderColor: hov ? COLORS.teal : alpha(COLORS.teal, 0.45), backgroundColor: hov ? alpha(COLORS.teal, 0.14) : 'rgba(3,6,15,0.7)' }]}>
            <View style={{ opacity: hov ? 1 : 0.55 }}>
              <GearSprite item={item} scale={1} />
            </View>
            <T v="display" style={{ fontSize: 22, lineHeight: 22, color: COLORS.teal }}>
              {side === 'left' ? '<' : '>'}
            </T>
          </View>
        );
      }}
    </Pressable>
  );
}

/** The filmstrip: every item in the filter, the one on show framed; a tap jumps there. */
function Strip({ items, idx, onPick, width }: { items: GearItem[]; idx: number; onPick: (i: number) => void; width: number }) {
  const ref = useRef<ScrollView>(null);
  const CELLW = 50;
  useEffect(() => {
    ref.current?.scrollTo({ x: Math.max(0, idx * (CELLW + 6) - width / 2 + CELLW / 2), animated: true });
  }, [idx, width]);
  return (
    <View style={[styles.strip, { width }]}>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 6 }}>
        {items.map((g, i) => {
          const on = i === idx;
          const hue = RARITY_HUE[g.rarity];
          return (
            <Pressable
              key={g.id}
              onPress={() => {
                if (i !== idx) play('select');
                onPick(i);
              }}
              accessibilityRole="button"
              accessibilityLabel={g.name}
              accessibilityState={{ selected: on }}
            >
              {(st) => (
                <View style={[styles.stripCell, { borderColor: on ? COLORS.teal : (st as { hovered?: boolean }).hovered ? alpha(hue, 0.7) : 'transparent', backgroundColor: on ? alpha(COLORS.teal, 0.12) : TECH.ink }]}>
                  <GearSprite item={g} scale={1} />
                  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: U, backgroundColor: hue }} />
                  {on ? <Corners color={COLORS.teal} size={6} inset={-U * 3} /> : null}
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** The spec sheet: what the item is, how rare, how many, and what you can do with it now. */
function Spec({ it, tryOn, setTryOn, n, of, style, book, onJump }: { it: GearItem; tryOn: boolean; setTryOn: (v: boolean) => void; n: number; of: number; style?: object; book: GearBook; onJump: (g: GearItem) => void }) {
  const set = useMemo(() => (it.set && it.set !== 'Solo' ? book.items.filter((g) => g.set === it.set) : []), [book, it.set]);
  const hue = RARITY_HUE[it.rarity];
  const cert = useNft((s) => s.cert);
  const openClaim = useNft((s) => s.openPopup);
  const jarl = it.supply === 'claim';
  return (
    <TechPanel
      title={`ITEM ${it.id} · ${pad(n + 1)} OF ${pad(of)}`}
      color={hue}
      style={style}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Led color={COLORS.gold} blink size={4} />
          <T v="tiny" style={{ fontSize: 9, color: COLORS.gold }}>
            PRE-MINT
          </T>
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ gap: 8 }} showsVerticalScrollIndicator={false}>
        <Materialize key={it.id} color={hue}>
          <T v="display" style={{ fontSize: 30, lineHeight: 30, letterSpacing: 1, color: COLORS.text }}>
            {it.name}
          </T>
        </Materialize>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.rarTag, { backgroundColor: hue }]}>
            <T v="display" style={{ fontSize: 14, lineHeight: 15, letterSpacing: 1, color: TECH.ink }}>
              {it.rarity.toUpperCase()}
            </T>
          </View>
          <Meter n={TIER[it.rarity]} of={4} color={hue} cell={14} h={8} />
        </View>
        <View style={styles.rule} />
        <Readout k="SLOT" v={it.sub.toUpperCase() === CAT_WORD[it.cat] ? CAT_WORD[it.cat] : `${CAT_WORD[it.cat]} · ${it.sub.toUpperCase()}`} />
        <Readout k="SET" v={it.set.toUpperCase()} />
        <Readout k="SUPPLY" v={jarl ? 'CLAIM ONLY' : `${(it.supply as number).toLocaleString()} WILL DROP`} color={COLORS.gold} />
        <Readout k="MINTED">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Meter n={0} of={8} color={COLORS.teal} cell={6} h={6} />
            <T v="display" style={{ fontSize: 17, lineHeight: 18, color: COLORS.text }}>
              {jarl ? 'AT LAUNCH' : `000/${pad(it.supply as number)}`}
            </T>
          </View>
        </Readout>
        <Readout k="EFFECT" v="COSMETIC ONLY" color={TECH.dim} />
        {set.length > 1 ? (
          <View style={{ gap: 4 }}>
            <T v="tiny" style={{ fontSize: 9, color: TECH.dim, letterSpacing: 1 }}>
              {`SET · ${it.set.toUpperCase()} · ${set.length} PIECES`}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {set.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => {
                    if (g.id !== it.id) play('select');
                    onJump(g);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.name}, same set`}
                >
                  {(st) => (
                    <View style={[styles.setCell, { borderColor: g.id === it.id ? COLORS.teal : (st as { hovered?: boolean }).hovered ? alpha(RARITY_HUE[g.rarity], 0.8) : TECH.rule }]}>
                      <GearSprite item={g} scale={1} />
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View style={[styles.log, { borderLeftColor: hue }]}>
          <T v="tiny" style={{ fontSize: 9, color: TECH.dim, letterSpacing: 1 }}>
            FIELD NOTE
          </T>
          <T style={{ fontSize: 15, fontStyle: 'italic', color: COLORS.text }}>"{it.flavor}"</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flex: 1 }}>
            <TechBtn small label="TRY ON" primary={tryOn} onPress={() => setTryOn(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <TechBtn small label="ITEM" primary={!tryOn} onPress={() => setTryOn(false)} />
          </View>
        </View>
        {jarl ? (
          cert?.eligible ? (
            <TechBtn primary color={COLORS.gold} label={cert.claim?.status === 'minted' ? 'YOUR CERTIFICATE' : 'CLAIM CERTIFICATE'} onPress={openClaim} />
          ) : (
            <T v="muted" style={{ fontSize: 12 }}>
              Founding Miners mined ORE during the closed beta. Their certificate claims this helmet when the market opens.
            </T>
          )
        ) : (
          <TechBtn label="MINT OPENS SOON" color={COLORS.gold} disabled />
        )}
        {isWeb ? (
          <T v="tiny" style={{ fontSize: 8, color: TECH.dim, textAlign: 'center', letterSpacing: 1 }}>
            SWIPE OR {'<  >'} TO BROWSE
          </T>
        ) : (
          <T v="tiny" style={{ fontSize: 8, color: TECH.dim, textAlign: 'center', letterSpacing: 1 }}>
            SWIPE THE STAGE TO BROWSE
          </T>
        )}
      </ScrollView>
    </TechPanel>
  );
}

function GridCell({ it, on, onPress }: { it: GearItem; on: boolean; onPress: () => void }) {
  const hue = RARITY_HUE[it.rarity];
  const legend = it.rarity === 'Legendary';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${it.name}, ${it.rarity}`}>
      {(st) => {
        const hov = (st as { hovered?: boolean }).hovered;
        return (
          <View style={[styles.cell, { borderColor: on ? COLORS.teal : hov ? alpha(hue, 0.8) : TECH.rule, backgroundColor: hov ? alpha(hue, 0.06) : TECH.panel }]}>
            <View style={styles.cellStage}>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 10, height: U, backgroundColor: alpha(hue, 0.4) }} />
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, backgroundColor: alpha(hue, 0.07) }} />
              <GearSprite item={it} scale={2} animate={legend} />
            </View>
            <View style={styles.cellHead}>
              <T v="tiny" style={{ fontSize: 8, color: TECH.dim }}>
                {it.id}
              </T>
              <Meter n={TIER[it.rarity]} of={4} color={hue} cell={4} h={4} gap={1} />
            </View>
            <T v="bold" numberOfLines={2} style={styles.name}>
              {it.name}
            </T>
            <View style={{ height: U, alignSelf: 'stretch', backgroundColor: hue }} />
            {hov || on ? <Corners color={on ? COLORS.teal : hue} size={6} /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(2,4,12,0.7)' },
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, padding: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  logo: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha('#3ee6ff', 0.06) },
  subHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  viewSwitch: { flexDirection: 'row', gap: 4 },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 6, paddingBottom: 8 },
  chip: { height: 30, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: U },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16, justifyContent: 'flex-start' },
  cell: { width: 116, padding: 6, gap: 4, borderWidth: U, alignItems: 'center' },
  cellStage: { width: 100, height: 86, alignItems: 'center', justifyContent: 'center', backgroundColor: TECH.ink, overflow: 'hidden' },
  cellHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  name: { fontSize: 13, lineHeight: 15, textAlign: 'center', minHeight: 30, alignSelf: 'stretch' },
  hudTL: { position: 'absolute', left: 16, top: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hudTR: { position: 'absolute', right: 16, top: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  hudB: { position: 'absolute', left: 70, right: 70, bottom: 12, gap: 2 },
  arrow: { position: 'absolute', top: '42%' },
  arrowBox: { width: 50, paddingVertical: 6, alignItems: 'center', gap: 2, borderWidth: U },
  rail: { position: 'absolute', left: 0, right: 0, bottom: 0, height: U * 2, backgroundColor: 'rgba(255,255,255,0.06)' },
  strip: { backgroundColor: TECH.panel, borderWidth: U, borderColor: TECH.rule },
  stripCell: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: U, overflow: 'visible' },
  setCell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: U, backgroundColor: TECH.ink },
  rarTag: { paddingHorizontal: 8, paddingVertical: 3 },
  rule: { height: U, backgroundColor: TECH.rule },
  log: { borderLeftWidth: U * 2, paddingLeft: 10, paddingVertical: 6, gap: 2, backgroundColor: 'rgba(255,255,255,0.025)' },
});
