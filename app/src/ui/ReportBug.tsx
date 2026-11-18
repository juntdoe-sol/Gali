/**
 * "Report a bug" in the Profile page: a short form that files the bug on the same board as gali.lol/beta
 * (public.beta_bugs, through game_report_bug, which keeps that board's checks and daily limits). The team sees it
 * in the admin page's Bugs tab, where an admin can approve an auto-fix.
 */
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { useGame } from '../game/store';
import { useName } from '../game/username';
import { publicKey, restBase } from '../game/world';
import { Btn, Card, Choice, INPUT, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_VERSION: string = (require('../../app.json') as { expo: { version: string } }).expo.version;

const SEVERITY: { k: 'blocker' | 'major' | 'minor' | 'cosmetic'; label: string; sub: string }[] = [
  { k: 'blocker', label: "Can't play", sub: 'Stuck or crashing' },
  { k: 'major', label: 'Big', sub: 'Something important is broken' },
  { k: 'minor', label: 'Small', sub: 'Annoying but playable' },
  { k: 'cosmetic', label: 'Looks wrong', sub: 'Text, art or layout' },
];

/** Which part of the game the player is in, in the beta board's words. */
function areaNow(): string {
  const where = useLobby.getState().where;
  return where === 'island' ? 'ORE Island' : where === 'lobby' ? 'Lobby' : 'Other';
}

async function send(body: Record<string, unknown>): Promise<number> {
  const base = restBase();
  if (!base) throw new Error('Bug reports are not available in this build.');
  const r = await fetch(`${base}/rest/v1/rpc/game_report_bug`, {
    method: 'POST',
    headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw new Error((j as { message?: string } | null)?.message || 'Could not send. Try again.');
  return Number(j);
}

export function ReportBugRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card style={styles.row}>
        <T style={{ flex: 1 }}>Found a bug?</T>
        <PixIcon name="warn" size={22} />
        <Btn small label="Report a bug" onPress={() => setOpen(true)} />
      </Card>
      {open ? <ReportBugModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReportBugModal({ onClose }: { onClose: () => void }) {
  const name = useName((s) => s.name);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [sev, setSev] = useState<(typeof SEVERITY)[number]['k'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const submit = async () => {
    setErr('');
    if (!name) return setErr('Pick a Gali name first (tap your name at the top).');
    if (title.trim().length < 4) return setErr('Give it a short title, 4 characters or more.');
    if (details.trim().length < 10) return setErr('Tell us a bit more about what happened.');
    if (!sev) return setErr('Pick how bad it is.');
    setBusy(true);
    try {
      const st = useGame.getState();
      const id = await send({
        p_username: name,
        p_wallet: st.wallet.owner || null,
        p_platform: Platform.OS === 'web' ? 'desktop' : 'android',
        p_device: Platform.OS === 'web' ? (typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 60) : 'web') : `Android ${String(Platform.Version)}`,
        p_area: areaNow(),
        p_severity: sev,
        p_title: title.trim(),
        p_details: details.trim(),
        p_build: APP_VERSION,
      });
      setDone(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.wrap}>
          <PixelBox fill="rgba(9,14,34,0.98)" hi="#2d4282" lo="#04060f" shadow={3} style={styles.box}>
            <T v="display" style={{ fontSize: 28, color: COLORS.gold }}>REPORT A BUG</T>
            {done !== null ? (
              <>
                <T>Bug #{done} is on the board. Thanks{name ? `, ${name}` : ''}. The team will look at it.</T>
                <T v="muted">You can follow it on gali.lol/beta.</T>
                <Btn kind="gold" label="Done" onPress={onClose} />
              </>
            ) : (
              <>
                <T v="muted">What broke? We add your game version and where you are for you.</T>
                <TextInput value={title} onChangeText={setTitle} maxLength={90} placeholder="Short title, e.g. Cave run gives no XP" placeholderTextColor={COLORS.muted} style={INPUT} />
                <TextInput value={details} onChangeText={setDetails} maxLength={2000} multiline placeholder="What did you do, what happened, what did you expect?" placeholderTextColor={COLORS.muted} style={[INPUT, { height: 110, paddingTop: 10, textAlignVertical: 'top' }]} />
                <T v="label">How bad is it?</T>
                <View style={styles.sev}>
                  {SEVERITY.map((s) => (
                    <Choice key={s.k} label={s.label} sub={s.sub} on={sev === s.k} onPress={() => setSev(s.k)} />
                  ))}
                </View>
                {err ? <T style={{ color: COLORS.red }}>{err}</T> : null}
                <View style={styles.btns}>
                  <Btn kind="ghost" label="Cancel" onPress={onClose} style={{ flex: 1 }} />
                  <Btn kind="gold" label={busy ? 'Sending…' : 'Send report'} disabled={busy} onPress={() => void submit()} style={{ flex: 1 }} />
                </View>
              </>
            )}
          </PixelBox>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  wrap: { width: '100%', maxWidth: 520 },
  box: { padding: 18, gap: 12 },
  sev: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btns: { flexDirection: 'row', gap: 10 },
});
