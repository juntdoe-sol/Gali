// Meeting other miners: tap one on the map to wave, send SKR, or open the chat.
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { useGame } from '../game/store';
import { EMOTES, useWorld } from '../game/world';
import { fx } from '../pixel/fx';
import { Btn, Frame, IconBtn, PixelBox, T, U } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { useChrome } from './layout';

/** The island's emotes travel as emoji (other players' apps read them); they are drawn as pixel icons. */
const EMOTE_PIX: Record<string, PixName> = { '👋': 'wave', '⛏️': 'pick', '🎉': 'star', '💎': 'gem', '🔥': 'fire' };
const EMOTE_NAME: Record<string, string> = { '👋': 'a wave', '⛏️': 'a pickaxe', '🎉': 'a cheer', '💎': 'a gem', '🔥': 'fire' };

export function PeerCard() {
  const focus = useWorld((s) => s.focus);
  const peer = useWorld((s) => (s.focus ? s.peers[s.focus] : undefined));
  const status = useWorld((s) => s.status);
  const owner = useGame((s) => s.wallet.owner);
  const insets = useSafeAreaInsets();
  const ch = useChrome(insets);
  const close = () => useWorld.getState().setFocus(null);
  useEffect(() => {
    if (focus && !peer) useWorld.getState().setFocus(null); // they left the world
  }, [focus, peer]);
  if (!focus || !peer) return null;
  const badge = peer.bot ? 'Practice bot' : peer.wallet ? 'Verified wallet' : 'Guest (no verified wallet)';
  const badgeColor = peer.bot ? COLORS.muted : peer.wallet ? COLORS.sol : COLORS.text;
  return (
    <Frame style={[styles.card, ch.desktop ? { left: ch.left, right: undefined, width: 380, bottom: ch.bottom + 60 } : { bottom: Math.max(fx.viewBottom, insets.bottom + 80) + 8 }]}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <T v="display" style={{ fontSize: 24 }} numberOfLines={1}>
            {peer.name}
          </T>
          <T v="bold" style={{ fontSize: 12, color: badgeColor }}>
            Level {peer.lvl} · {badge}
          </T>
        </View>
        <IconBtn onPress={close} label="Close">
          <PixIcon name="close" size={16} />
        </IconBtn>
      </View>
      <View style={[styles.row, { marginTop: 10, justifyContent: 'space-between' }]}>
        {EMOTES.map((e) => (
          <Pressable key={e} onPress={() => useWorld.getState().emote(e)} accessibilityRole="button" accessibilityLabel={`Send ${EMOTE_NAME[e] ?? e}`}>
            {(st) => (
              <PixelBox fill={(st as { hovered?: boolean }).hovered ? '#22346a' : '#0e1838'} hi="#2d4282" lo="#04060f" style={[styles.emote, { transform: [{ translateY: (st as { pressed: boolean }).pressed ? U : 0 }] }]}>
                <PixIcon name={EMOTE_PIX[e] ?? 'star'} size={32} />
              </PixelBox>
            )}
          </Pressable>
        ))}
      </View>
      <View style={[styles.row, { marginTop: 10 }]}>
        <Btn
          small
          label="Open chat"
          style={{ flex: 1 }}
          onPress={() => {
            close();
            useLobby.getState().setChatOpen(true);
          }}
        />
      </View>
      {status !== 'online' && !peer.bot ? (
        <T v="muted" style={{ marginTop: 6, fontSize: 11 }}>
          Reconnecting to the world…
        </T>
      ) : null}
    </Frame>
  );
}

/** How many miners are on the map right now (you included). */
export const useMinersHere = () => useWorld((s) => Object.keys(s.peers).length + 1);

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 12, right: 12, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emote: { width: 50, height: 46, alignItems: 'center', justifyContent: 'center' },
});
