/**
 * Cave Run on screen: the button that opens it and the full-screen game.
 *
 * The game itself is a canvas (pixel/CaveView). This file only opens it, hands it
 * your miner's look and today's runs, and passes what it reports to the store.
 * Wallet-only: it is mounted with the rest of the connected UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useCave } from '../game/caveStore';
import { haptic, play, type Sound } from '../game/sfx';
import { useGame } from '../game/store';
import type { CaveEvent } from '../engine/cave';
import { atlasSource } from '../pixel/atlasSource';
import CaveView, { type CaveRef } from '../pixel/CaveView';
import { myLook } from '../pixel/PixelMine';
import { useView } from '../pixel/view';
import { GEAR_ICON } from './gearIcons';
import { T } from './kit';
import { BAR_H } from './TabBar';
import { BackPill } from './Lobby';

const PIXEL = { dataSet: { pixelart: '1' } } as object;
const SFX: Record<string, Sound> = { hit: 'hit', crack: 'crack', pop: 'pop', gem: 'mint', hurt: 'bonk', descend: 'dig', over: 'lose', start: 'select', tick: 'tick', oil: 'claim' };

/** The spot a run from the map should open under: the one you are mining, else one you picked. */
function homeSpot(): number {
  const g = useGame.getState();
  if (g.pending) for (let i = 0; i < 25; i++) if (g.pending.mask & (1 << i)) return i;
  return g.selected[0] ?? useCave.getState().spot;
}

/** The Cave button on the map. Hidden while a panel or a spot's mine has the screen. */
export function CaveEntry() {
  const insets = useSafeAreaInsets();
  const dockOpen = useGame((s) => s.dockOpen);
  const inside = useView((s) => s.focus >= 0);
  const runs = useCave((s) => s.save.runs);
  const pick = useGame((s) => GEAR_ICON[s.save.pickaxe] ?? GEAR_ICON['pick-wood']);
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!runs) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bob, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, runs]);
  if (dockOpen || inside) return null;
  return (
    <Animated.View style={[styles.entryWrap, { bottom: insets.bottom + BAR_H + 46, transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}>
      <Pressable
        onPress={() => {
          haptic.tap();
          useCave.getState().show(homeSpot());
        }}
        style={({ pressed }) => [styles.entry, pressed && { transform: [{ scale: 0.94 }] }]}
        accessibilityRole="button"
        accessibilityLabel={`Play Cave Run. ${runs} runs left today`}
      >
        <Image source={pick} style={{ width: 26, height: 26 }} {...PIXEL} />
        <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
          CAVE RUN
        </T>
        <View style={[styles.entryCount, !runs && { backgroundColor: '#5a6a8a' }]}>
          <T v="black" style={{ fontSize: 11, color: '#070d20' }}>
            {runs}
          </T>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function CaveScreen() {
  const insets = useSafeAreaInsets();
  const open = useCave((s) => s.open);
  const ref = useRef<CaveRef>(null);
  const [atlas, setAtlas] = useState<string | null>(null);
  useEffect(() => {
    if (open && !atlas) atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
  }, [open, atlas]);

  const onEvent = useCallback((e: CaveEvent) => {
    const cave = useCave.getState();
    switch (e.t) {
      case 'run':
        cave.spend();
        break;
      case 'xp':
        cave.xp(e.n);
        break;
      case 'end':
        cave.ended(e.depth);
        haptic.lose();
        break;
      case 'sfx':
        if (SFX[e.name]) play(SFX[e.name]);
        if (e.name === 'hurt') haptic.heavy();
        else if (e.name === 'crack' || e.name === 'gem') haptic.thud();
        break;
      case 'close':
        cave.close();
        break;
      default:
        break;
    }
  }, []);

  if (!open) return null;
  const { spot, save } = useCave.getState();
  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => useCave.getState().close()}>
      <View style={styles.screen}>
        {atlas ? (
          <CaveView
            ref={ref}
            onEvent={onEvent}
            atlas={atlas}
            look={myLook()}
            opts={{ spot, runs: save.runs, best: save.best, top: insets.top, bottom: insets.bottom }}
            dom={{ style: { flex: 1, backgroundColor: '#0a0810' }, scrollEnabled: false, bounces: false, overScrollMode: 'never' } as never}
          />
        ) : null}
        <View style={[styles.caveBack, { top: insets.top + 8 }]} pointerEvents="box-none">
          <BackPill door="cave" onBefore={() => useCave.getState().close()} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  entryWrap: { position: 'absolute', right: 12 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 8,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#070d20e6',
    borderWidth: 1.5,
    borderColor: COLORS.gold2,
  },
  entryCount: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: '#0a0810' },
  caveBack: { position: 'absolute', left: 12 },
});
