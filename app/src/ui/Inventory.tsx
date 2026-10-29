/**
 * BAG: the Gali NFTs this wallet holds. Today that is the Founding Miner certificate; Gear 555 items join it
 * when the market opens. Read by the `nft` function (Helius DAS), so it shows what is really on chain.
 */
import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useMarket } from '../game/market';
import { fmtDay, useNft } from '../game/nft';
import { useGame } from '../game/store';
import { CertCard } from './CertClaim';
import { Btn, Card, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';

export function Inventory() {
  const owner = useGame((s) => s.wallet.owner);
  const { cert, items, loading, error, refresh, openPopup } = useNft();
  useEffect(() => {
    void refresh(owner, true);
  }, [owner, refresh]);
  const showMarket = useMarket((s) => s.show);

  if (!owner)
    return (
      <Card>
        <T>Connect a wallet to see the Gali NFTs it holds.</T>
      </Card>
    );
  const certs = items.filter((i) => i.kind === 'cert');
  const gear = items.filter((i) => i.kind === 'gear');
  const minted = cert?.claim?.status === 'minted';
  return (
    <View style={{ gap: 12 }}>
      <T v="label">FOUNDING MINER</T>
      {minted || certs.length ? (
        <PixelBox fill="rgba(60,40,8,0.6)" hi={COLORS.gold} lo="#04060f" style={styles.cert}>
          <CertCard width={300} />
          <T v="display" style={{ fontSize: 22, color: COLORS.gold }}>
            {certs[0]?.name ?? `Gali Founding Miner #${String(cert?.claim?.serial ?? 0).padStart(4, '0')}`}
          </T>
          <T v="muted" style={{ fontSize: 13, textAlign: 'center' }}>
            {cert ? `${cert.rounds} beta rounds · first dig ${fmtDay(cert.firstAt)} · soulbound` : 'Soulbound'}
          </T>
          <T style={{ textAlign: 'center' }}>Claims the Legendary Jarl Helmet when the Gali NFT market opens.</T>
        </PixelBox>
      ) : cert?.eligible ? (
        <Card glow={COLORS.gold}>
          <T v="bold">You qualify: you mined ORE during the closed beta.</T>
          <Btn kind="gold" label="CLAIM CERTIFICATE" onPress={openPopup} style={{ marginTop: 8 }} />
        </Card>
      ) : (
        <Card>
          <T v="muted">{loading ? 'Checking your beta mining...' : 'Founding Miner certificates go to wallets that mined a live ORE round in Gali during the closed beta.'}</T>
        </Card>
      )}

      <T v="label" style={{ marginTop: 6 }}>
        GEAR
      </T>
      {gear.length ? (
        <View style={styles.grid}>
          {gear.map((g) => (
            <PixelBox key={g.id} fill="rgba(11,20,48,0.9)" hi="#2d4282" lo="#04060f" style={styles.item}>
              {g.image ? <Image source={{ uri: g.image }} style={{ width: 72, height: 72, imageRendering: 'pixelated' } as never} /> : <PixIcon name="bag" size={48} />}
              <T v="bold" numberOfLines={2} style={{ fontSize: 12, textAlign: 'center' }}>
                {g.name}
              </T>
            </PixelBox>
          ))}
        </View>
      ) : (
        <Card>
          <T>No gear yet. The first Gear 555 drop is coming soon to the market by the hall in the lobby.</T>
          <Btn kind="teal" label="SEE THE GEAR" onPress={() => showMarket()} style={{ marginTop: 8 }} />
        </Card>
      )}
      {error ? (
        <T v="muted" style={{ fontSize: 12, color: COLORS.red }}>
          Couldn't read your NFTs: {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cert: { padding: 12, gap: 6, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { width: 100, padding: 8, gap: 4, alignItems: 'center' },
});
