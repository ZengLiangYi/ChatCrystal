import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadIBMPlexSans } from '@remotion/google-fonts/IBMPlexSans';

const jetbrains = loadJetBrainsMono('normal', {
  weights: ['400', '700'],
  subsets: ['latin'],
});

const ibmPlex = loadIBMPlexSans('normal', {
  weights: ['400', '600', '700'],
  subsets: ['latin'],
});

export const FONT_MONO = jetbrains.fontFamily;
export const FONT_SANS = ibmPlex.fontFamily;
