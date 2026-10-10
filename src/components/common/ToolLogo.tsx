/**
 * ToolLogo Component
 *
 * Brand logo for a connectable tool, shared by the Tools & Connections screen
 * and the chat cards so both show the same icon. Uses the tool's `logo_url`
 * (SVG or bitmap) and falls back to a vector icon chosen by `logo_key`/slug
 * when the URL is missing or fails to load.
 */
import React, { useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { SvgUri } from 'react-native-svg';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  Calendar01Icon,
  Grid02Icon,
  Mail01Icon,
  Message01Icon,
} from '@hugeicons/core-free-icons';

import { Colors } from '@/constants/colors';

const KEY_ICONS: Record<string, any> = {
  gmail: Mail01Icon,
  outlook: Mail01Icon,
  slack: Message01Icon,
  discord: Message01Icon,
  telegram: Message01Icon,
  googlecalendar: Calendar01Icon,
};

export interface ToolLogoProps {
  logoUrl?: string | null;
  /** tools.logo_key, preferred for the fallback icon */
  logoKey?: string | null;
  /** tools.slug, used when there is no logo key */
  slug?: string | null;
  size?: number;
}

export function ToolLogo({ logoUrl, logoKey, slug, size = 28 }: ToolLogoProps) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    const isSvg =
      /\.svg(\?|$)/i.test(logoUrl) || logoUrl.includes('logos.composio.dev');

    return isSvg ? (
      <SvgUri
        uri={logoUrl}
        width={size}
        height={size}
        onError={() => setFailed(true)}
      />
    ) : (
      <Image
        source={{ uri: logoUrl }}
        style={{ width: size, height: size }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    );
  }

  const key = (logoKey || slug || '').toLowerCase();
  const icon = KEY_ICONS[key] ?? Grid02Icon;

  return (
    <HugeiconsIcon
      icon={icon}
      size={Math.round(size * 0.8)}
      color={Colors.iconDark}
      strokeWidth={2}
    />
  );
}

export default ToolLogo;
