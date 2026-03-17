export const COLORS = [
  '#0050FF', // Bright blue (largest section, top right)
  '#FF6B35', // Orange (bottom right, smaller)
  '#FF7F5C', // Coral/salmon (bottom right, adjacent to orange)
  '#50D4A8', // Mint/turquoise green (bottom left)
  '#D4A650', // Golden yellow/tan (top left)
  '#6B8FFF', // Light blue/periwinkle (left side)
  '#6B4FFF', // Purple/violet (bottom left area)
  '#003DA6', // Darker blue
  '#D45A29', // Darker orange
]

export const COLOR_VARIATIONS = {
  // Curated palettes with higher contrast and more variety - now with 8 colors each
  '#0050FF': ['#4299E1', '#667EEA', '#38B2AC', '#805AD5', '#A26BF9', '#63B3ED', '#319795', '#D6BCFA'], // Blue: Cool tones
  '#D4A650': ['#ECC94B', '#F6E05E', '#ED8936', '#DD6B20', '#975A16', '#FAF089', '#E53E3E', '#D69E2E'], // Yellow: Warm tones
  '#6B8FFF': ['#90CDF4', '#A3BFFA', '#7F9CF5', '#B794F4', '#F687B3', '#9AE6B4', '#D6BCFA', '#FBB6CE'], // Light Blue: Soft pastels
  '#6B4FFF': ['#7C3AED', '#A78BFA', '#5B21B6', '#EC4899', '#F472B6', '#BE185D', '#4F46E5', '#312E81'], // Purple: Vibrant tones
  '#50D4A8': ['#48BB78', '#68D391', '#4FD1C5', '#38B2AC', '#4299E1', '#9AE6B4', '#2F855A', '#3182CE'], // Green: Greens and blues
  '#FF6B35': ['#F97316', '#FB923C', '#FBBF24', '#FACC15', '#EF4444', '#DC2626', '#E11D48', '#BE185D'], // Orange: Hot tones
  '#FF7F5C': ['#F56565', '#ED64A6', '#B794F4', '#F6AD55', '#FF8757', '#F6E05E', '#FBB6CE', '#D6BCFA'], // Coral: Warm pastels
  '#003DA6': ['#2B6CB0', '#3182CE', '#4299E1', '#2C5282', '#0067AD', '#63B3ED', '#2A4365', '#00A3C4'], // Dark Blue: Monochromatic blues
  '#D45A29': ['#DD6B20', '#ED8936', '#F6AD55', '#C05621', '#975A16', '#D69E2E', '#E98444', '#AF8C72'], // Dark Orange: Terracotta, Sienna, Amber
}

export function getColorVariations(mainColor: string): string[] {
  return COLOR_VARIATIONS[mainColor] || [mainColor, mainColor, mainColor, mainColor, mainColor]
}

export const THEME_COLORS = {
  blue: '#0050FF',
  orange: '#FF6B35',
  yellow: '#D4A650',
  lightBlue: '#6B8FFF',
  purple: '#6B4FFF',
  green: '#50D4A8',
  coral: '#FF7F5C',
  darkBlue: '#003DA6',
  darkOrange: '#D45A29',
} as const

export type PieTheme = keyof typeof THEME_COLORS

export const getThemeColors = (theme: PieTheme | null): string[] => {
  if (!theme) {
    return COLORS
  }
  const mainColor = THEME_COLORS[theme]
  const variations = getColorVariations(mainColor)
  return [mainColor, ...variations]
}
