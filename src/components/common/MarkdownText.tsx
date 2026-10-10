/**
 * MarkdownText Component
 *
 * Lightweight Markdown renderer for chat bubbles — no extra dependency, so it
 * stays compatible with the current React Native / React versions and uses the
 * app's own type scale.
 *
 * Block syntax:  # headings, - / * / • bullets, 1. ordered lists, > quotes,
 *                ``` fenced code, --- rules, blank-line paragraphs
 * Inline syntax: **bold**, *italic*, _italic_, `code`, ~~strike~~,
 *                [label](url) and bare http(s) links
 *
 * Anything it does not recognise renders as plain text, so a model reply is
 * never swallowed by the parser.
 */
import React from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Colors } from '@/constants/colors';

export interface MarkdownTextProps {
  /** Raw markdown-ish text, usually a model reply. */
  content: string;
  /** Body text color (chat bubbles differ per sender). */
  color?: string;
  /** Link color, defaults to the brand blue. */
  linkColor?: string;
  /** Extra styling merged into every text run. */
  textStyle?: TextStyle;
  /** Code block background, for bubbles where the default gray is unreadable. */
  codeBackground?: string;
  /** Quote bar and divider color, for the same reason. */
  ruleColor?: string;
}

const MONOSPACE = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

async function openLink(url: string) {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await WebBrowser.openBrowserAsync(target);
  } catch {
    Linking.openURL(target).catch(() => {});
  }
}

/* ------------------------------------------------------------ inline parse */

type InlineRule = {
  pattern: RegExp;
  /**
   * Group index holding a character that must stay plain text (used to anchor
   * `_italic_` to a word boundary). Lookbehind is avoided on purpose: it is
   * not supported by every JS engine React Native ships with.
   */
  prefixGroup?: number;
  render: (
    match: RegExpExecArray,
    key: string,
    ctx: InlineContext,
  ) => React.ReactNode;
};

interface InlineContext {
  color: string;
  linkColor: string;
  textStyle?: TextStyle;
}

/** Renders the inner text of a matched span, so **bold _italic_** nests. */
function renderInner(
  text: string,
  key: string,
  ctx: InlineContext,
  style: TextStyle,
) {
  return (
    <Text key={key} style={style}>
      {parseInline(text, ctx, `${key}-i`)}
    </Text>
  );
}

const INLINE_RULES: InlineRule[] = [
  {
    // Code spans win first: their content is never re-parsed.
    pattern: /`([^`\n]+)`/,
    render: (match, key, ctx) => (
      <Text key={key} style={[styles.code, { color: ctx.color }]}>
        {match[1]}
      </Text>
    ),
  },
  {
    pattern: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    render: (match, key, ctx) => (
      <Text
        key={key}
        style={[styles.link, { color: ctx.linkColor }]}
        onPress={() => openLink(match[2])}>
        {match[1]}
      </Text>
    ),
  },
  {
    pattern: /\*\*([^\n]+?)\*\*/,
    render: (match, key, ctx) => renderInner(match[1], key, ctx, styles.bold),
  },
  {
    pattern: /__([^\n]+?)__/,
    render: (match, key, ctx) => renderInner(match[1], key, ctx, styles.bold),
  },
  {
    pattern: /~~([^\n]+?)~~/,
    render: (match, key, ctx) => renderInner(match[1], key, ctx, styles.strike),
  },
  {
    // Single `*`: a **bold** run always matches earlier, so it wins the scan.
    pattern: /\*(?!\s)([^*\n]+?)\*(?!\*)/,
    render: (match, key, ctx) => renderInner(match[1], key, ctx, styles.italic),
  },
  {
    // `_italic_` only at a word boundary, so snake_case_names stay intact.
    pattern: /(^|[\s([{"'])_(?!\s)([^_\n]+?)_(?![\w_])/,
    prefixGroup: 1,
    render: (match, key, ctx) => renderInner(match[2], key, ctx, styles.italic),
  },
  {
    pattern: /(https?:\/\/[^\s<>()]+)/,
    render: (match, key, ctx) => (
      <Text
        key={key}
        style={[styles.link, { color: ctx.linkColor }]}
        onPress={() => openLink(match[1])}>
        {match[1]}
      </Text>
    ),
  },
];

/** Splits a line into styled runs, earliest match first. */
function parseInline(
  text: string,
  ctx: InlineContext,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let index = 0;

  while (rest.length > 0) {
    let best: { match: RegExpExecArray; rule: InlineRule } | null = null;

    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest);
      if (match && (!best || match.index < best.match.index)) {
        best = { match, rule };
      }
    }

    if (!best) {
      nodes.push(rest);
      break;
    }

    // A prefix group stays plain text (e.g. the space before `_italic_`).
    const prefixLength = best.rule.prefixGroup
      ? (best.match[best.rule.prefixGroup] ?? '').length
      : 0;
    const start = best.match.index + prefixLength;

    if (start > 0) {
      nodes.push(rest.slice(0, start));
    }

    nodes.push(best.rule.render(best.match, `${keyPrefix}-${index}`, ctx));
    rest = rest.slice(best.match.index + best.match[0].length);
    index += 1;
  }

  return nodes;
}

/* ------------------------------------------------------------- block parse */

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; items: string[] }
  | { type: 'ordered'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s{0,4}[-*•]\s+(.*)$/;
const ORDERED = /^\s{0,4}(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])\s*\1\s*\1[\s\-*_]*$/;

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (FENCE.test(line)) {
      flushParagraph();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.type === 'bullet') last.items.push(bullet[1]);
      else blocks.push({ type: 'bullet', items: [bullet[1]] });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.type === 'ordered') last.items.push(ordered[2]);
      else blocks.push({ type: 'ordered', items: [ordered[2]] });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.type === 'quote') last.text += ` ${quote[1]}`;
      else blocks.push({ type: 'quote', text: quote[1] });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

const HEADING_SIZES: Record<number, number> = {
  1: 19,
  2: 17.5,
  3: 16.5,
  4: 16,
  5: 15.5,
  6: 15.5,
};

/* ----------------------------------------------------------------- render */

export function MarkdownText({
  content,
  color = Colors.iconDark,
  linkColor = Colors.primary,
  textStyle,
  codeBackground,
  ruleColor,
}: MarkdownTextProps) {
  const ctx: InlineContext = { color, linkColor, textStyle };
  const blocks = React.useMemo(() => parseBlocks(content ?? ''), [content]);
  const base = [styles.body, { color }, textStyle];

  // Plain single paragraph: render bare text so bubble metrics stay identical.
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return <Text style={base}>{parseInline(blocks[0].text, ctx, 'p0')}</Text>;
  }

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const spacing = index === 0 ? undefined : styles.blockSpacing;

        switch (block.type) {
          case 'heading':
            return (
              <Text
                key={key}
                style={[
                  base,
                  styles.heading,
                  { fontSize: HEADING_SIZES[block.level] ?? 16 },
                  spacing,
                ]}>
                {parseInline(block.text, ctx, key)}
              </Text>
            );

          case 'bullet':
            return (
              <View key={key} style={[styles.list, spacing]}>
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-${itemIndex}`} style={styles.listRow}>
                    <Text style={[base, styles.marker]}>•</Text>
                    <Text style={[base, styles.listText]}>
                      {parseInline(item, ctx, `${key}-${itemIndex}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );

          case 'ordered':
            return (
              <View key={key} style={[styles.list, spacing]}>
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-${itemIndex}`} style={styles.listRow}>
                    <Text style={[base, styles.marker]}>{itemIndex + 1}.</Text>
                    <Text style={[base, styles.listText]}>
                      {parseInline(item, ctx, `${key}-${itemIndex}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );

          case 'quote':
            return (
              <View
                key={key}
                style={[
                  styles.quote,
                  spacing,
                  ruleColor ? { borderLeftColor: ruleColor } : null,
                ]}>
                <Text style={[base, styles.quoteText]}>
                  {parseInline(block.text, ctx, key)}
                </Text>
              </View>
            );

          case 'code':
            return (
              <View
                key={key}
                style={[
                  styles.codeBlock,
                  spacing,
                  codeBackground ? { backgroundColor: codeBackground } : null,
                ]}>
                <Text style={[styles.code, styles.codeBlockText, { color }]}>
                  {block.text}
                </Text>
              </View>
            );

          case 'rule':
            return (
              <View
                key={key}
                style={[
                  styles.rule,
                  spacing,
                  ruleColor ? { backgroundColor: ruleColor } : null,
                ]}
              />
            );

          default:
            return (
              <Text key={key} style={[base, spacing]}>
                {parseInline(block.text, ctx, key)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  body: {
    fontSize: 15.5,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  blockSpacing: {
    marginTop: 8,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  link: {
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  heading: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  list: {
    width: '100%',
    gap: 3,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  marker: {
    width: 20,
    fontWeight: '600',
  },
  listText: {
    flex: 1,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.border,
    paddingLeft: 10,
  },
  quoteText: {
    fontStyle: 'italic',
    opacity: 0.9,
  },
  code: {
    fontFamily: MONOSPACE,
    fontSize: 14,
  },
  codeBlock: {
    backgroundColor: Colors.surfaceMuted,
    borderRadius: 10,
    padding: 10,
  },
  codeBlockText: {
    lineHeight: 20,
  },
  rule: {
    height: 1,
    backgroundColor: Colors.border,
    width: '100%',
  },
});

export default MarkdownText;
