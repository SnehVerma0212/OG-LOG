import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { colors } from '../theme';

export type TabIconName = 'home' | 'cases' | 'statistics' | 'settings';

interface TabIconProps {
  name: TabIconName;
  color: string;
  size?: number;
}

// Simple 24×24 line icons drawn with one consistent stroke style.
export function TabIcon({ name, color, size = 24 }: TabIconProps) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === 'home' && (
        <Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" {...stroke} />
      )}
      {name === 'cases' && (
        <>
          <Rect x={5} y={4.5} width={14} height={16} rx={2} {...stroke} />
          <Rect x={9} y={2.5} width={6} height={3.5} rx={1} {...stroke} />
          <Line x1={9} y1={11} x2={15} y2={11} {...stroke} />
          <Line x1={9} y1={15} x2={13} y2={15} {...stroke} />
        </>
      )}
      {name === 'statistics' && (
        <>
          <Line x1={6} y1={20} x2={6} y2={13} {...stroke} strokeWidth={2.5} />
          <Line x1={12} y1={20} x2={12} y2={5} {...stroke} strokeWidth={2.5} />
          <Line x1={18} y1={20} x2={18} y2={10} {...stroke} strokeWidth={2.5} />
        </>
      )}
      {name === 'settings' && (
        <>
          <Line x1={4} y1={7} x2={20} y2={7} {...stroke} />
          <Line x1={4} y1={12} x2={20} y2={12} {...stroke} />
          <Line x1={4} y1={17} x2={20} y2={17} {...stroke} />
          <Circle cx={9} cy={7} r={2.25} {...stroke} fill={colors.surface} />
          <Circle cx={15} cy={12} r={2.25} {...stroke} fill={colors.surface} />
          <Circle cx={8} cy={17} r={2.25} {...stroke} fill={colors.surface} />
        </>
      )}
    </Svg>
  );
}
