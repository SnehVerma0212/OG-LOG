import type { TextStyle } from 'react-native';

// Colour tokens. Text colours are chosen to keep at least 4.5:1 contrast
// against both `background` and `surface`.
export const colors = {
  background: '#F7F5F0', // warm off-white
  surface: '#FFFFFF',
  surfaceMuted: '#F1EEE7',
  border: '#E4DFD5',
  text: '#14233A', // dark navy
  textSecondary: '#4E5D6E',
  textTertiary: '#5F6B79',
  accent: '#0F766E', // restrained teal
  accentPressed: '#0B5E58',
  accentSoft: '#E3F1EF',
  accentOnNavy: '#5CC8B8', // lighter teal for use on navy, e.g. the logo mark
  onAccent: '#FFFFFF',
  notice: '#8A5300',
  noticeSoft: '#FBF1DC',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

// Minimum comfortable touch target on both iOS (44pt) and Android (48dp).
export const touchTarget = 48;

// Keeps content readable on tablets instead of stretching edge to edge.
export const maxContentWidth = 640;

export const typography = {
  largeTitle: { fontSize: 32, lineHeight: 38, fontWeight: '700', color: colors.text },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: colors.text },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.text },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400', color: colors.text },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: '400', color: colors.textSecondary },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600', color: colors.text },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', color: colors.textTertiary },
} satisfies Record<string, TextStyle>;
