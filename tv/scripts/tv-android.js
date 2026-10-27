// tv:android — prebuild (if needed), build the release APK, install it over ADB and launch it.
// Uses the device in ANDROID_SERIAL, or the only one adb sees. Release build, so the JS is bundled
// and the TV does not need Metro.
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const PKG = 'trade.aeonian.gali.tv';
const env = { ...process.env, EXPO_TV: '1', APP_VARIANT: 'tv' };
const run = (cmd, cwd = root) => {
  console.log(`> ${cmd}`);
  const r = spawnSync(cmd, { cwd, env, shell: true, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
};

if (!fs.existsSync(path.join(root, 'android'))) run('npx expo prebuild --platform android --clean');
// The bundle task only tracks files under tv/, not the shared code in ../app/src, so force it to run every time.
run('./gradlew :app:createBundleReleaseJsAndAssets --rerun', path.join(root, 'android'));
run('./gradlew assembleRelease', path.join(root, 'android'));

const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const serial = process.env.ANDROID_SERIAL || (() => {
  const lines = execSync('adb devices').toString().split('\n').slice(1).filter((l) => /\tdevice$/.test(l));
  if (lines.length !== 1) {
    console.error(`Expected exactly one ADB device, found ${lines.length}. Set ANDROID_SERIAL.`);
    process.exit(1);
  }
  return lines[0].split('\t')[0];
})();
run(`adb -s ${serial} install -r "${apk}"`);
run(`adb -s ${serial} shell monkey -p ${PKG} -c android.intent.category.LEANBACK_LAUNCHER 1`);
