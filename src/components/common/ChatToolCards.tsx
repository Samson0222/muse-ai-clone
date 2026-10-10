/**
 * Chat Tool Cards
 *
 * Two inline cards rendered inside an agent chat bubble:
 *
 * - `ChatConnectCta`  : the agent needs a tool the user has not connected yet.
 *   Connect runs the same OAuth flow as the Tools & Connections screen.
 * - `ChatConfirmCard` : a write action (send email, post to Slack, create an
 *   event) that only executes after the user presses Confirm.
 * - `ChatScheduleCard`: a recurring task that is only saved to Supabase after
 *   the user presses Confirm.
 */
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  CheckmarkCircle02Icon,
  Link01Icon,
  AlertCircleIcon,
  Clock01Icon,
} from '@hugeicons/core-free-icons';

import { Colors } from '@/constants/colors';
import { ToolLogo } from './ToolLogo';
import type {
  ChatConfirmRequest,
  ChatConfirmState,
  ChatConnectSuggestion,
  ChatConnectSuggestionTool,
  ChatScheduleRequest,
} from '@/types';

export interface ChatConnectCtaProps {
  suggestion: ChatConnectSuggestion;
  /** Slug currently being connected, if any. */
  busySlug?: string | null;
  /** Slugs already connected from this card. */
  connectedSlugs?: string[];
  onConnect: (tool: ChatConnectSuggestionTool) => void;
}

export function ChatConnectCta({
  suggestion,
  busySlug,
  connectedSlugs = [],
  onConnect,
}: ChatConnectCtaProps) {
  const tools = suggestion?.tools ?? [];
  if (tools.length === 0) return null;

  return (
    <View style={styles.card}>
      {tools.map((tool) => {
        const busy = busySlug === tool.slug;
        const connected = connectedSlugs.includes(tool.slug);
        return (
          <View key={tool.slug} style={styles.row}>
            <View style={styles.iconTile}>
              <ToolLogo
                logoUrl={tool.logo_url}
                logoKey={tool.logo_key}
                slug={tool.slug}
                size={24}
              />
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {tool.name}
            </Text>
            {connected ? (
              <View style={styles.connectedPill}>
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={16}
                  color={Colors.success}
                  strokeWidth={2.2}
                />
                <Text style={styles.connectedText}>Connected</Text>
              </View>
            ) : (
            <TouchableOpacity
              style={[styles.pillBtn, styles.primaryBtn, busy && styles.btnDisabled]}
              activeOpacity={0.85}
              disabled={busy}
              onPress={() => onConnect(tool)}>
              {busy ? (
                <ActivityIndicator size="small" color={Colors.textWhite} />
              ) : (
                <>
                  <HugeiconsIcon
                    icon={Link01Icon}
                    size={15}
                    color={Colors.textWhite}
                    strokeWidth={2.2}
                  />
                  <Text style={styles.primaryBtnText}>Connect</Text>
                </>
              )}
            </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

export interface ChatConfirmCardProps {
  request: ChatConfirmRequest;
  state: ChatConfirmState;
  onConfirm: (request: ChatConfirmRequest) => void;
  onCancel: (request: ChatConfirmRequest) => void;
}

const STATE_NOTE: Record<
  Exclude<ChatConfirmState, 'pending' | 'running'>,
  { text: string; color: string; icon: any }
> = {
  confirmed: {
    text: 'Confirmed and executed',
    color: Colors.success,
    icon: CheckmarkCircle02Icon,
  },
  cancelled: { text: 'Cancelled', color: Colors.iconMuted, icon: AlertCircleIcon },
  failed: { text: 'Failed — nothing was sent', color: Colors.error, icon: AlertCircleIcon },
};

export function ChatConfirmCard({
  request,
  state,
  onConfirm,
  onCancel,
}: ChatConfirmCardProps) {
  const running = state === 'running';
  const settled = state !== 'pending' && state !== 'running';
  const note = settled ? STATE_NOTE[state as keyof typeof STATE_NOTE] : null;

  return (
    <View style={styles.card}>
      <View style={styles.confirmHeader}>
        <View style={styles.iconTile}>
          <ToolLogo
            logoUrl={request.logoUrl}
            logoKey={request.logoKey}
            slug={request.toolkitSlug}
            size={24}
          />
        </View>
        <View style={styles.confirmHeaderBody}>
          <Text style={styles.confirmLabel}>NEEDS YOUR CONFIRMATION</Text>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {request.actionSummary}
          </Text>
        </View>
      </View>

      {request.details ? (
        <View style={styles.detailBox}>
          <Text style={styles.detailText}>{request.details}</Text>
        </View>
      ) : null}

      {note ? (
        <View style={styles.noteRow}>
          <HugeiconsIcon icon={note.icon} size={16} color={note.color} strokeWidth={2} />
          <Text style={[styles.noteText, { color: note.color }]}>{note.text}</Text>
        </View>
      ) : (
        <View style={styles.confirmActions}>
          <TouchableOpacity
            style={[styles.pillBtn, styles.ghostBtn, running && styles.btnDisabled]}
            activeOpacity={0.8}
            disabled={running}
            onPress={() => onCancel(request)}>
            <Text style={styles.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pillBtn, styles.primaryBtn, running && styles.btnDisabled]}
            activeOpacity={0.85}
            disabled={running}
            onPress={() => onConfirm(request)}>
            {running ? (
              <ActivityIndicator size="small" color={Colors.textWhite} />
            ) : (
              <Text style={styles.primaryBtnText}>Confirm</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export interface ChatScheduleCardProps {
  request: ChatScheduleRequest;
  state: ChatConfirmState;
  onConfirm: (request: ChatScheduleRequest) => void;
  onCancel: (request: ChatScheduleRequest) => void;
}

const SCHEDULE_NOTE: Record<
  Exclude<ChatConfirmState, 'pending' | 'running'>,
  { text: string; color: string; icon: any }
> = {
  confirmed: { text: 'Scheduled', color: Colors.success, icon: CheckmarkCircle02Icon },
  cancelled: { text: 'Cancelled', color: Colors.iconMuted, icon: AlertCircleIcon },
  failed: { text: 'Failed — nothing was scheduled', color: Colors.error, icon: AlertCircleIcon },
};

function deliveryLabel(request: ChatScheduleRequest) {
  return request.delivery === 'slack' && request.slackChannel
    ? `Slack ${request.slackChannel}`
    : 'This chat';
}

export function ChatScheduleCard({
  request,
  state,
  onConfirm,
  onCancel,
}: ChatScheduleCardProps) {
  const running = state === 'running';
  const settled = state !== 'pending' && state !== 'running';
  const note = settled ? SCHEDULE_NOTE[state as keyof typeof SCHEDULE_NOTE] : null;

  const rows: { label: string; value: string }[] = [
    { label: 'Repeats', value: `${request.scheduleSummary} (${request.timezone})` },
    { label: 'First run', value: request.nextRunLabel },
    { label: 'Delivery', value: deliveryLabel(request) },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.confirmHeader}>
        <View style={styles.iconTile}>
          <HugeiconsIcon icon={Clock01Icon} size={22} color={Colors.primary} strokeWidth={2} />
        </View>
        <View style={styles.confirmHeaderBody}>
          <Text style={styles.confirmLabel}>SCHEDULE THIS TASK?</Text>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {request.title}
          </Text>
        </View>
      </View>

      <View style={styles.detailBox}>
        <Text style={styles.detailText}>{request.task}</Text>
        {rows.map((row) => (
          <View key={row.label} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{row.label}</Text>
            <Text style={styles.detailValue}>{row.value}</Text>
          </View>
        ))}
      </View>

      {note ? (
        <View style={styles.noteRow}>
          <HugeiconsIcon icon={note.icon} size={16} color={note.color} strokeWidth={2} />
          <Text style={[styles.noteText, { color: note.color }]}>{note.text}</Text>
        </View>
      ) : (
        <View style={styles.confirmActions}>
          <TouchableOpacity
            style={[styles.pillBtn, styles.ghostBtn, running && styles.btnDisabled]}
            activeOpacity={0.8}
            disabled={running}
            onPress={() => onCancel(request)}>
            <Text style={styles.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pillBtn, styles.primaryBtn, running && styles.btnDisabled]}
            activeOpacity={0.85}
            disabled={running}
            onPress={() => onConfirm(request)}>
            {running ? (
              <ActivityIndicator size="small" color={Colors.textWhite} />
            ) : (
              <Text style={styles.primaryBtnText}>Confirm</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 12,
    gap: 10,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: Colors.iconDark,
  },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    minWidth: 92,
    paddingHorizontal: 14,
    borderRadius: 17,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
  },
  primaryBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textWhite,
  },
  ghostBtn: {
    backgroundColor: Colors.surfaceMuted,
  },
  ghostBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    minWidth: 92,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: Colors.successLight,
  },
  connectedText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.success,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confirmHeaderBody: {
    flex: 1,
    gap: 2,
  },
  confirmLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: Colors.iconMuted,
  },
  detailBox: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  detailLabel: {
    width: 64,
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.iconMuted,
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.iconDark,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noteText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
