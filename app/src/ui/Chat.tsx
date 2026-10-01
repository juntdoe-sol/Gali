import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { short } from '../chain/light';
import { chatReady, useChat, type ChatMsg } from '../game/chat';
import { COLORS, usd } from '../game/constants';
import { useGame } from '../game/store';
import { Btn, F, T } from './kit';

const TIP_AMOUNTS = [25, 100, 500, 1000];

export function ChatSheet() {
  const insets = useSafeAreaInsets();
  const open = useChat((s) => s.open);
  const msgs = useChat((s) => s.msgs);
  const error = useChat((s) => s.error);
  const sending = useChat((s) => s.sending);
  const tipTarget = useChat((s) => s.tipTarget);
  const { setOpen, send, setTipTarget } = useChat.getState();
  const me = useGame((s) => s.wallet.owner);
  const connect = useGame((s) => s.connect);
  const [text, setText] = useState('');
  const list = useRef<FlatList<ChatMsg>>(null);

  useEffect(() => {
    if (open) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
  }, [open, msgs.length]);

  if (!open) return null;
  return (
    <Modal transparent visible animationType="slide" onRequestClose={() => setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.head}>
            <View>
              <T v="display" style={{ fontSize: 24 }}>
                Miners chat
              </T>
              <T v="muted">{chatReady ? 'Global room · signed by your session key' : 'Chat server not connected yet'}</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Btn small kind="skr" label="Send SKR" onPress={() => setTipTarget('')} />
              <Btn small label="✕" onPress={() => setOpen(false)} />
            </View>
          </View>

          <FlatList
            ref={list}
            data={msgs}
            keyExtractor={(m) => String(m.id)}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <T style={{ fontSize: 36 }}>⛏</T>
                <T v="bold" style={{ textAlign: 'center' }}>
                  {chatReady ? 'No messages yet. Say hi to the other miners.' : 'The chat server for this build is not set up.'}
                </T>
                <T v="muted" style={{ textAlign: 'center' }}>
                  {chatReady ? 'Tap a miner to send them SKR.' : 'Add the Supabase URL and key to app/src/chain/chat.json. You can still send SKR with the button above.'}
                </T>
              </View>
            }
            renderItem={({ item }) => <Bubble m={item} mine={item.wallet === me} onTip={() => item.wallet !== me && setTipTarget(item.wallet)} />}
          />

          {error ? (
            <T v="muted" style={{ color: COLORS.red, marginBottom: 6 }}>
              {error}
            </T>
          ) : null}

          {me ? (
            <View style={styles.inputRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={chatReady ? 'Message the mine…' : 'Chat is offline'}
                placeholderTextColor={COLORS.muted}
                maxLength={280}
                editable={chatReady && !sending}
                style={styles.input}
                onSubmitEditing={async () => {
                  if (await send(text)) setText('');
                }}
                returnKeyType="send"
              />
              <Btn
                kind="gold"
                small
                label={sending ? '…' : 'Send'}
                disabled={!chatReady || !text.trim() || sending}
                onPress={async () => {
                  if (await send(text)) setText('');
                }}
              />
            </View>
          ) : (
            <Btn kind="skr" label="Connect wallet to chat" onPress={() => void connect()} />
          )}
        </View>
        {tipTarget !== null ? <TipSheet initialTo={tipTarget} onClose={() => setTipTarget(null)} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Bubble({ m, mine, onTip }: { m: ChatMsg; mine: boolean; onTip: () => void }) {
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (m.kind === 'tip') {
    return (
      <View style={styles.tip}>
        <T v="black" style={{ color: COLORS.skr, textAlign: 'center' }}>
          🎁 {m.name} sent {Number(m.tip_amount).toLocaleString()} SKR to {m.tip_to ? short(m.tip_to) : '?'}
        </T>
        <T v="muted" style={{ textAlign: 'center' }}>
          “{m.body}” · {time}
        </T>
      </View>
    );
  }
  return (
    <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
      <Pressable onPress={onTip} disabled={mine} style={[styles.bubble, mine && styles.bubbleMine]} accessibilityHint={mine ? undefined : 'Send this miner SKR'}>
        {!mine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <View style={styles.lvl}>
              <T v="black" style={{ fontSize: 10, color: '#0d3a33' }}>
                {m.level}
              </T>
            </View>
            <T v="black" style={{ fontSize: 12, color: COLORS.gold }}>
              {m.name}
            </T>
            <T v="muted" style={{ fontSize: 10 }}>
              tap to tip
            </T>
          </View>
        ) : null}
        <T style={{ color: mine ? '#2b1600' : COLORS.text }}>{m.body}</T>
        <T v="muted" style={{ fontSize: 10, alignSelf: 'flex-end', color: mine ? '#6b3a00' : COLORS.muted }}>
          {time}
        </T>
      </Pressable>
    </View>
  );
}

export function TipSheet({ initialTo, onClose }: { initialTo: string; onClose: () => void }) {
  const skr = useGame((s) => s.wallet.skr);
  const busy = useGame((s) => s.wallet.busy);
  const owner = useGame((s) => s.wallet.owner);
  const tip = useChat((s) => s.tip);
  const [to, setTo] = useState(initialTo);
  const [amount, setAmount] = useState('100');
  const [note, setNote] = useState('');
  const n = Number(amount) || 0;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[styles.backdrop, { backgroundColor: '#040817cc' }]} onPress={onClose} />
      <View style={styles.tipCard}>
        <T v="display" style={{ fontSize: 26 }}>
          Send SKR
        </T>
        <T v="muted">To another miner's Solana wallet. Your wallet asks you to approve.</T>
        <T v="label" style={{ marginTop: 12 }}>
          To
        </T>
        <TextInput
          value={to}
          onChangeText={setTo}
          placeholder="Wallet address"
          placeholderTextColor={COLORS.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.field}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <T v="label">Amount</T>
          <T v="muted">You have {skr.toLocaleString(undefined, { maximumFractionDigits: 2 })} SKR</T>
        </View>
        <View style={[styles.field, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            value={amount}
            onChangeText={(t) => setAmount(t.replace(',', '.').replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            style={{ flex: 1, color: COLORS.text, fontFamily: F.display, fontSize: 24 }}
          />
          <T v="black" style={{ color: COLORS.skr }}>
            SKR · {usd(n)}
          </T>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
          {TIP_AMOUNTS.map((a) => (
            <Btn key={a} small label={String(a)} onPress={() => setAmount(String(a))} style={{ flex: 1 }} />
          ))}
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note (shows in chat)"
          placeholderTextColor={COLORS.muted}
          maxLength={120}
          style={[styles.field, { marginTop: 10 }]}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <Btn kind="ghost" label="Cancel" onPress={onClose} style={{ flex: 1 }} />
          <Btn
            kind="skr"
            label={busy ?? (owner ? `Send ${n ? n.toLocaleString() : ''} SKR` : 'Connect wallet first')}
            disabled={!owner || !to.trim() || !(n > 0) || n > skr || Boolean(busy)}
            onPress={async () => {
              if (await tip(to, n, note)) onClose();
            }}
            style={{ flex: 2 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.card2,
    borderWidth: 2,
    borderColor: COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 0,
    elevation: 4,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#04081788' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '78%',
    backgroundColor: COLORS.bg2,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 2,
    borderColor: COLORS.line,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderColor: COLORS.line },
  empty: { alignItems: 'center', gap: 6, padding: 30 },
  bubbleRow: { flexDirection: 'row' },
  bubble: {
    maxWidth: '82%',
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 2,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  bubbleMine: { backgroundColor: COLORS.gold, borderColor: '#ffe08a', borderTopLeftRadius: 16, borderTopRightRadius: 4 },
  lvl: { width: 18, height: 18, borderRadius: 5, backgroundColor: COLORS.teal, alignItems: 'center', justifyContent: 'center' },
  tip: { alignSelf: 'center', backgroundColor: '#c7f28418', borderColor: COLORS.skr, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '92%' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.line,
    backgroundColor: '#00000044',
    color: COLORS.text,
    paddingHorizontal: 12,
    fontFamily: F.body,
  },
  tipCard: { position: 'absolute', left: 16, right: 16, top: '18%', backgroundColor: COLORS.card, borderColor: COLORS.skr, borderWidth: 3, borderRadius: 24, padding: 18 },
  field: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.line,
    backgroundColor: '#00000044',
    color: COLORS.text,
    paddingHorizontal: 12,
    minHeight: 46,
    fontFamily: F.body,
  },
});
