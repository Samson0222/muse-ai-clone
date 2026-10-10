/**
 * Muse AI Clone - Centralized Design Tokens & Color Palette
 * Primary Color: Modern Tech Blue (#2563EB / #0066FF)
 * Clean White UI theme with rich contrast and accents.
 */

export const Colors = {
  // Brand Primary (Blue)
  primary: '#2563EB',        // Main brand blue
  primaryDark: '#1D4ED8',    // Pressed/Hover state
  primaryLight: '#3B82F6',   // Lighter accent
  primaryGradientStart: '#3B82F6',
  primaryGradientEnd: '#1D4ED8',
  primarySubtle: '#EFF6FF',  // 50 shade for chips/backgrounds
  primaryGlow: 'rgba(37, 99, 235, 0.12)',
  primaryBorder: '#BFDBFE',  // Light blue border

  // Neutral / Layout Colors (Clean White Theme)
  white: '#FFFFFF',
  black: '#000000',
  background: '#FFFFFF',     // Main screen background
  surface: '#F8FAFC',        // Secondary card background (Slate 50)
  surfaceElevated: '#FFFFFF',// Elevated cards with shadow
  surfaceMuted: '#F1F5F9',   // Slate 100

  // Text Colors
  text: '#0F172A',           // Primary text (Slate 900)
  textPrimary: '#0F172A',    // Slate 900
  textSecondary: '#475569',  // Slate 600
  textMuted: '#94A3B8',      // Slate 400
  textDisabled: '#CBD5E1',   // Slate 300
  textWhite: '#FFFFFF',
  textLink: '#2563EB',

  // Border & Dividers
  border: '#E2E8F0',         // Slate 200
  borderLight: '#F1F5F9',    // Slate 100
  borderFocus: '#2563EB',    // Focus state border
  divider: '#E2E8F0',

  // Status & Feedback
  success: '#10B981',        // Emerald 500
  successLight: '#ECFDF5',
  warning: '#F59E0B',        // Amber 500
  warningLight: '#FFFBEB',
  error: '#EF4444',          // Red 500
  errorLight: '#FEF2F2',
  info: '#0EA5E9',           // Sky 500
  infoLight: '#F0F9FF',

  // Tab & Chat UI specific tokens
  tabInactive: '#1E2022',
  tabActive: '#1E2022',
  tabActiveBg: '#E6E8EA',
  chatBubbleUser: '#2563EB',       // Brand blue user bubble
  chatBubbleUserText: '#FFFFFF',   // White copy on the blue bubble
  chatBubbleUserLink: '#DBEAFE',   // Light blue links readable on the blue bubble
  chatBubbleUserCodeBg: 'rgba(255, 255, 255, 0.2)', // Code blocks inside the blue bubble
  chatBubbleUserRule: 'rgba(255, 255, 255, 0.5)',   // Quote bars and dividers inside it
  chatBubbleAi: '#EEF0F2',
  chatBubbleAiBorder: 'transparent',
  overlay: 'rgba(15, 23, 42, 0.45)',
  overlaySoft: 'rgba(15, 23, 42, 0.22)',  // Dim behind the slide-over drawer
  statusBlue: '#2563EB',
  iconDark: '#1E2022',
  iconMuted: '#9E9E9E',
  inputBg: '#FFFFFF',
  inputBorder: '#E5E7EB',
  dockBg: '#FFFFFF',

  // Google Branding
  googleBlue: '#4285F4',
  googleRed: '#EA4335',
  googleYellow: '#FBBC05',
  googleGreen: '#34A853',
  googleBorder: '#DADCE0',
  googleBgHover: '#F8FAFD',

  browserPreviewBg: '#FFFFFF',

  // Settings / list card surfaces
  cardBg: '#FAFAFB',
  cardBorder: '#ECEEF0',
  cardDivider: '#F0F0F2',

  // Dark Scheme Palette (for dark mode compatibility)
  light: {
    text: '#0F172A',
    background: '#FFFFFF',
    backgroundElement: '#F1F5F9',
    backgroundSelected: '#EFF6FF',
    textSecondary: '#475569',
    tint: '#2563EB',
    card: '#FFFFFF',
    border: '#E2E8F0',
  },
  dark: {
    text: '#F8FAFC',
    background: '#0B0F17',
    backgroundElement: '#1E293B',
    backgroundSelected: '#1E3A8A',
    textSecondary: '#94A3B8',
    tint: '#3B82F6',
    card: '#0F172A',
    border: '#1E293B',
  },
} as const;

export type ColorType = typeof Colors;
export default Colors;
