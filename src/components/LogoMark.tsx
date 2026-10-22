import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { colors } from '../theme';

interface LogoMarkProps {
  size?: number;
}

// OG-LOG mark: a record sheet with a three-step clinical timeline
// (preoperative, OT, postoperative). Same geometry as assets/brand/*.svg.
export function LogoMark({ size = 44 }: LogoMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect width={64} height={64} rx={16} fill={colors.text} />
      <Line x1={20} y1={19} x2={20} y2={40} stroke={colors.accentOnNavy} strokeWidth={3} strokeLinecap="round" />
      <Circle cx={20} cy={19} r={5} fill={colors.accentOnNavy} />
      <Circle cx={20} cy={32} r={5} fill={colors.accentOnNavy} />
      <Circle cx={20} cy={45} r={5} fill={colors.text} stroke={colors.accentOnNavy} strokeWidth={3} />
      <Line x1={31} y1={19} x2={47} y2={19} stroke={colors.surface} strokeWidth={4} strokeLinecap="round" />
      <Line x1={31} y1={32} x2={43} y2={32} stroke={colors.surface} strokeWidth={4} strokeLinecap="round" />
      <Line x1={31} y1={45} x2={45} y2={45} stroke={colors.surface} strokeWidth={4} strokeLinecap="round" opacity={0.55} />
    </Svg>
  );
}
