// Meeting other miners: tap one on the map to wave, send SKR, or open the chat.
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useChat } from '../game/chat';
import { useGame } from '../game/store';
import { EMOTES, useWorld } from '../game/world';
import { fx } from '../pixel/fx';
import { Btn, Frame, T } from './kit';

export function PeerCard() {
  const focus = useWorld((s) => s.focus);
  const peer = useWorld((s) => (s.focus ? s.peers[s.focus] : undefined));
  const status = useWorld((s) => s.status);
  const owner = useGame((s) => s.wallet.owner);
  const insets = useSafeAreaInsets();
  const close = () => useWorld.getState().setFocus(null);
  useEffect(() => {
    if (focus && !peer) useWorld.getState().setFocus(null); // they left the world
  }, [focus, peer]);
  if (!focus || !peer) return null;
  const badge = peer.bot ? 'Practice bot' : peer.wallet ? 'Verified wallet' : 'Guest (no verified wallet)';
  const badgeColor = peer.bot ? COLORS.muted : peer.wallet ? COLORS.sol : COLORS.text;
  return (
    <Frame style={[styles.card, { bottom: Math.max(fx.viewBottom, insets.bottom + 80) + 8 }]} radius={12}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <T v="display" style={{ fontSize: 20 }} numberOfLines={1}>
            {peer.name}
          </T>
          <T v="bold" style={{ fontSize: 12, color: badgeColor }}>
            Level {peer.lvl} · {badge}
          </T>
        </View>
        <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close" style={styles.x}>
          <T v="display" style={{ fontSize: 16 }}>
            ✕
          </T>
        </Pressable>
      </View>
      <View style={[styles.row, { marginTop: 10, justifyContent: 'space-between' }]}>
        {EMOTES.map((e) => (
          <Pressable
            key={e}
            onPress={() => useWorld.getState().emote(e)}
            style={({ pressed }) => [styles.emote, pressed && { transform: [{ scale: 0.92 }] }]}
            accessibilityLabel={`Send ${e}`}
          >
            <T style={{ fontSize: 22 }}>{e}</T>
          </Pressable>
        ))}
      </View>
      <View style={[styles.row, { marginTop: 10 }]}>
        {peer.wallet && owner && peer.wallet !== owner ? (
          <Btn
            small
            kind="skr"
            label="Send SKR"
            style={{ flex: 1 }}
            onPress={() => {
              close();
              useChat.getState().setOpen(true);
              useChat.getState().setTipTarget(peer.wallet);
            }}
          />
        ) : null}
        <Btn
          small
          label="Open chat"
          style={{ flex: 1 }}
          onPress={() => {
            close();
            useChat.getState().setOpen(true);
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
  card: { position: 'absolute', left: 12, right: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  x: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  emote: {
    width: 48,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: '#0a1636',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
