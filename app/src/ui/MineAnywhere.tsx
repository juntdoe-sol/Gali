/**
 * Mining, from anywhere: off the island (the lobby, the cave, the arena) a small live chip shows the ORE round, the
 * time left and how you are in it. Tap it and the same round card and DEPLOY panel the island has slide in, so you
 * can deploy, claim, or start and stop a run or autopilot without walking back. LITE covers the whole board and PRO
 * picks its spots at random here; ISLAND takes you there to pick spots by hand.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { create } from 'zustand';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { oreLive } from '../chain/light';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { play } from '../game/sfx';
import { isLive, roundEndsAt, useGame } from '../game/store';
import { Dock } from './Dock';
import { RoundCard } from './Hud';
import { FocusRing, IconBtn, Kbd, PixelBox, T, U } from './kit';
import { GUTTER, LANDSCAPE_APP, RAIL_W, TOP_H, useLayout } from './layout';
import { PixIcon } from './PixIcon';
import { alpha, Led, useTick } from './tech';

const isWeb = Platform.OS === 'web';
const HIDE_KEY = 'gali:mine-hidden';

/**
 * The mining panel's state, shared by every place it shows: `hidden` (the miner tucked it away; remembered on this
 * device) and `open` (the drawer is out).
 */
export const useMinePanel = create<{ hidden: boolean; open: boolean; setHidden: (v: boolean) => void; setOpen: (v: boolean) => void }>((set) => ({
  hidden: false,
  open: false,
  setHidden: (hidden) => {
    set(hidden ? { hidden, open: false } : { hidden });
    AsyncStorage.setItem(HIDE_KEY, hidden ? '1' : '0').catch(() => undefined);
  },
  setOpen: (open) => set({ open }),
}));
AsyncStorage.getItem(HIDE_KEY).then(
  (v) => {
    if (v === '1') useMinePanel.setState({ hidden: true });
  },
  () => undefined,
);

/** The tucked-away panel: a small pickaxe tab with a live light. Tap it to bring the panel back. */
export function MineTab({ style }: { style?: object }) {
  const live = useGame(isLive);
  return (
    <Pressable
      onPress={() => {
        play('select');
        useMinePanel.getState().setHidden(false);
      }}
      accessibilityRole="button"
      accessibilityLabel="Show the mining panel"
      style={style}
    >
      {(st) => (
        <PixelBox fill={(st as { hovered?: boolean }).hovered ? 'rgba(22,34,74,0.96)' : 'rgba(8,13,32,0.9)'} hi={COLORS.trim} lo="#04060f" shadow={1} style={styles.tab}>
          <PixIcon name="pick" size={20} />
          <View style={styles.row}>
            <Led color={live ? COLORS.red : COLORS.gold} blink size={3} />
            <T v="tiny" style={{ fontSize: 8, letterSpacing: 1, color: COLORS.muted }}>
              MINE
            </T>
          </View>
        </PixelBox>
      )}
    </Pressable>
  );
}

/** A small "hide" button that sits beside the chip or in the panel's header. */
export function HideBtn({ label = 'HIDE', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <Pressable
      onPress={() => {
        play('deselect');
        useMinePanel.getState().setHidden(true);
      }}
      accessibilityRole="button"
      accessibilityLabel="Hide the mining panel"
    >
      {(st) => (
        <View style={[styles.hideBtn, { borderColor: (st as { hovered?: boolean }).hovered ? COLORS.muted : 'rgba(142,162,204,0.35)' }]}>
          <PixIcon name="eye" size={14} style={{ opacity: 0.8 }} />
          {compact ? null : (
            <T v="tiny" style={{ fontSize: 8, letterSpacing: 1, color: COLORS.muted }}>
              {label}
            </T>
          )}
        </View>
      )}
    </Pressable>
  );
}
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** What the chip says about you this round. */
function useMyLine(): { text: string; color: string } {
  const run = useGame((s) => s.run);
  const pending = useGame((s) => s.pending);
  const roundId = useGame((s) => s.roundId);
  if (run) {
    const done = Math.min(run.total, Math.max(0, run.total - run.left));
    return { text: `${run.automated ? 'AUTOPILOT' : run.kind.toUpperCase()} ${done}/${run.total}`, color: COLORS.green };
  }
  if (pending && pending.roundId === roundId) {
    const spots = pending.mask.toString(2).split('1').length - 1;
    return { text: `IN · ${spots} SPOT${spots === 1 ? '' : 'S'}`, color: COLORS.teal };
  }
  return { text: 'DEPLOY', color: COLORS.muted };
}

function Chip({ onPress, open }: { onPress: () => void; open: boolean }) {
  useTick(500);
  const roundId = useGame((s) => s.roundId);
  const now = Date.now();
  const live = useGame(isLive);
  const liveClock = useGame((s) => s.liveClock);
  const liveClockError = useGame((s) => s.liveClockError);
  const phase = useGame((s) => s.phase);
  const endsAt = useGame(roundEndsAt);
  const me = useMyLine();
  const syncing = live && !liveClock;
  const idle = live && Boolean(liveClock) && phase === 'mining' && liveClock?.phase !== 'mining';
  const left = endsAt - now;
  const time = liveClockError ? 'OFFLINE' : syncing ? 'SYNC' : idle ? 'WAITING' : mmss(left);
  const hot = !syncing && !idle && left > 0 && left < 10_000;
  return (
    <Pressable
      onPress={() => {
        play('select');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`ORE round ${roundId % 100000}, ${time} left. ${me.text}. Open the mining panel`}
    >
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        return (
          <PixelBox
            fill={hovered || open ? 'rgba(22,34,74,0.96)' : 'rgba(8,13,32,0.92)'}
            hi={open ? COLORS.teal : COLORS.trim}
            lo="#04060f"
            shadow={1}
            style={[styles.chip, { transform: [{ translateY: pressed ? U : 0 }] }]}
          >
            <PixIcon name="pick" size={22} />
            <View style={{ gap: 1 }}>
              <View style={styles.row}>
                <Led color={live ? COLORS.red : COLORS.gold} blink size={4} />
                <T v="tiny" style={{ fontSize: 9, letterSpacing: 1, color: COLORS.muted }}>
                  {live ? 'LIVE' : 'PRACTICE'} · #{(roundId % 100000).toLocaleString()}
                </T>
              </View>
              <View style={styles.row}>
                <T v="display" style={{ fontSize: 22, lineHeight: 22, letterSpacing: 1, color: hot ? COLORS.red : COLORS.text }}>
                  {time}
                </T>
                <T v="display" numberOfLines={1} style={{ fontSize: 14, lineHeight: 15, letterSpacing: 0.6, color: me.color }}>
                  {me.text}
                </T>
              </View>
            </View>
            {isWeb && !LANDSCAPE_APP ? <Kbd k="M" /> : null}
            {focused && isWeb ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const { desktop, side, h } = useLayout();
  const insets = useSafeAreaInsets();
  const toIsland = () => {
    onClose();
    useLobby.getState().go('island');
  };
  const body = (
    <>
      <View style={styles.drawHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="display" style={{ fontSize: 22, lineHeight: 23, color: COLORS.gold, letterSpacing: 1 }}>
            MINING
          </T>
          <T v="label" style={{ fontSize: 12 }}>
            Deploy from anywhere
          </T>
        </View>
        <Pressable onPress={toIsland} accessibilityRole="button" accessibilityLabel="Go to ORE Island to pick spots on the map">
          {(st) => (
            <View style={[styles.islandBtn, { borderColor: (st as { hovered?: boolean }).hovered ? COLORS.teal : alpha(COLORS.teal, 0.5) }]}>
              <PixIcon name="map" size={16} />
              <T v="display" style={{ fontSize: 15, lineHeight: 16, color: COLORS.teal, letterSpacing: 1 }}>
                ISLAND
              </T>
            </View>
          )}
        </Pressable>
        <HideBtn compact />
        <IconBtn onPress={onClose} label="Close the mining panel" kbd="ESC">
          <PixIcon name="close" size={16} />
        </IconBtn>
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator>
        <RoundCard embedded />
        <PixelBox fill="rgba(15,23,52,0.95)" hi="#33498c" lo="#0c1430" style={{ paddingTop: 8 }}>
          <View style={styles.dockHead}>
            <T v="display" style={{ fontSize: 20, lineHeight: 22, color: COLORS.gold, letterSpacing: 1 }}>
              DEPLOY
            </T>
            <T v="label" style={{ fontSize: 11 }}>
              LITE covers every spot
            </T>
          </View>
          <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 }}>
            <Dock embedded />
          </View>
        </PixelBox>
      </ScrollView>
    </>
  );
  if (desktop) {
    return (
      <View style={[styles.deskDrawer, { width: side, right: GUTTER, top: GUTTER, bottom: GUTTER }]} pointerEvents="box-none">
        <PixelBox fill="rgba(10,16,38,0.97)" hi={COLORS.trim} lo="#04060f" shadow={2} style={styles.drawBox}>
          {body}
        </PixelBox>
      </View>
    );
  }
  return (
    <View style={[styles.phoneDrawer, { bottom: insets.bottom + 72, maxHeight: Math.round(h * 0.8) }]}>
      <PixelBox fill="rgba(10,16,38,0.97)" hi={COLORS.trim} lo="#04060f" shadow={2} style={styles.drawBox}>
        {body}
      </PixelBox>
    </View>
  );
}

/**
 * The chip and its drawer. `at` says where it is mounted, which decides where the chip sits: under the lobby's
 * header, or under the cave or arena's own top bar.
 */
export function MineAnywhere({ at = 'lobby' }: { at?: 'lobby' | 'cave' | 'arena' }) {
  const guest = useGame((s) => oreLive && !s.wallet.owner);
  const { desktop } = useLayout();
  const insets = useSafeAreaInsets();
  const open = useMinePanel((s) => s.open);
  const hidden = useMinePanel((s) => s.hidden);
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const st = useMinePanel.getState();
    st.setOpen(typeof v === 'function' ? v(st.open) : v);
  };
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined') return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
      } else if (e.key.toLowerCase() === 'm' && !LANDSCAPE_APP) {
        const st = useMinePanel.getState();
        if (st.hidden) st.setHidden(false);
        else setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (guest) return null;
  const top = desktop ? (at === 'lobby' ? TOP_H + GUTTER : GUTTER + 56) : insets.top + (at === 'lobby' ? 108 : 64);
  const left = desktop ? (at === 'lobby' ? RAIL_W + GUTTER : GUTTER) : 12;
  return (
    <>
      <View style={[styles.chipWrap, { top, left }]} pointerEvents="box-none">
        {hidden ? (
          <MineTab />
        ) : (
          <View style={styles.row}>
            <Chip open={open} onPress={() => setOpen((o) => !o)} />
            <HideBtn compact={!desktop} />
          </View>
        )}
      </View>
      {open && !hidden ? <Drawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  chipWrap: { position: 'absolute', zIndex: 45 },
  tab: { alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 6 },
  hideBtn: { height: 30, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: U, backgroundColor: 'rgba(8,13,32,0.85)' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deskDrawer: { position: 'absolute', zIndex: 46 },
  phoneDrawer: { position: 'absolute', left: 8, right: 8, zIndex: 46 },
  drawBox: { flexShrink: 1, minHeight: 0, padding: 10, gap: 8 },
  drawHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  islandBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 10, borderWidth: U, backgroundColor: alpha(COLORS.teal, 0.08) },
  dockHead: { paddingHorizontal: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderBottomWidth: U, borderColor: '#22356f', marginHorizontal: U * 2 },
});
