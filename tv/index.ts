// TV entry. Same polyfills as the phone, then the TV app. Platform.isTV is true on every build from this folder.
import '../app/src/polyfills';
import { registerRootComponent } from 'expo';
import TvApp from '../app/src/tv/TvApp';

registerRootComponent(TvApp);
