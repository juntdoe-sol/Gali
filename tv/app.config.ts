/**
 * The TV build's Expo config. It starts from the phone app's app.json so every existing value (version, scheme,
 * EAS project, splash colours) stays in one place, then switches on the TV variant. The phone app's own app.json
 * is not touched.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';
import base from '../app/app.json';

const phone = base.expo;
const isTV = process.env.EXPO_TV === '1';
const variant = process.env.APP_VARIANT ?? 'tv';
const asset = (p: string) => p.replace('./assets/', '../app/assets/');

export default ({ config }: ConfigContext): ExpoConfig => {
  const tv = variant === 'tv';
  return {
    ...config,
    ...(phone as unknown as ExpoConfig),
    name: tv ? 'Gali: ORE Island' : phone.name,
    slug: phone.slug,
    // tsconfig.json's "paths" exists only so tsc can resolve ../app/src imports; Metro must not use it.
    experiments: { tsconfigPaths: false },
    orientation: tv ? 'landscape' : 'default',
    // gali:// opens the phone app (TV pairing links); the TV must not claim it.
    scheme: tv ? 'galitv' : phone.scheme,
    icon: asset(phone.icon),
    android: {
      ...phone.android,
      package: tv ? 'trade.aeonian.gali.tv' : phone.android.package,
      adaptiveIcon: {
        foregroundImage: asset(phone.android.adaptiveIcon.foregroundImage),
        backgroundColor: phone.android.adaptiveIcon.backgroundColor,
      },
      // The TV only needs the network (implied). No notifications, no audio settings, no vibration.
      permissions: tv ? [] : phone.android.permissions,
      // Libraries in the shared dependency list (notifications, sensors, secure-store, dev client) merge their own
      // permissions into the manifest. The TV uses none of them, so strip everything but the network.
      blockedPermissions: tv
        ? [
            'android.permission.VIBRATE',
            'android.permission.POST_NOTIFICATIONS',
            'android.permission.MODIFY_AUDIO_SETTINGS',
            'android.permission.RECEIVE_BOOT_COMPLETED',
            'android.permission.ACTIVITY_RECOGNITION',
            'android.permission.USE_BIOMETRIC',
            'android.permission.USE_FINGERPRINT',
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'com.google.android.c2dm.permission.RECEIVE',
            'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
            'com.sec.android.provider.badge.permission.READ',
            'com.sec.android.provider.badge.permission.WRITE',
            'com.htc.launcher.permission.READ_SETTINGS',
            'com.htc.launcher.permission.UPDATE_SHORTCUT',
            'com.sonyericsson.home.permission.BROADCAST_BADGE',
            'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
            'com.anddoes.launcher.permission.UPDATE_COUNT',
            'com.majeur.launcher.permission.UPDATE_BADGE',
            'com.huawei.android.launcher.permission.CHANGE_BADGE',
            'com.huawei.android.launcher.permission.READ_SETTINGS',
            'com.huawei.android.launcher.permission.WRITE_SETTINGS',
            'android.permission.READ_APP_BADGE',
            'com.oppo.launcher.permission.READ_SETTINGS',
            'com.oppo.launcher.permission.WRITE_SETTINGS',
            'me.everything.badger.permission.BADGE_COUNT_READ',
            'me.everything.badger.permission.BADGE_COUNT_WRITE',
          ]
        : [],
    },
    plugins: [
      [
        'expo-build-properties',
        { android: { minSdkVersion: 26, enableProguardInReleaseBuilds: false, enableMinifyInReleaseBuilds: false } },
      ],
      ['expo-splash-screen', { image: asset('./assets/splash-icon.png'), imageWidth: 200, resizeMode: 'contain', backgroundColor: '#091330' }],
      'expo-font',
      'expo-secure-store',
      // Leanback launcher category, banner and TV manifest entries. Only when building for TV.
      ...(isTV ? [['@react-native-tvos/config-tv', { isTV: true, androidTVBanner: './assets/banner.png' }] as [string, object]] : []),
    ],
  } as ExpoConfig;
};
