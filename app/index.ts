import './src/polyfills';
import { registerRootComponent } from 'expo';
import { Boot } from './src/boot';

// Boot reads the screen choice first, then loads the app (see src/boot.tsx).
registerRootComponent(Boot);
