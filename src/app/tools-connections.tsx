/**
 * Tools & Connections Screen ('/tools-connections')
 *
 * Lists agent tools (from the toolsService data layer) grouped into
 * Email / Messaging / Calendar, with a live search bar and per-tool
 * connection status. Connect / Reconnect / Pending-refresh / Disconnect go
 * through the Composio backend routes (src/lib/composioBackend.ts).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  ArrowLeft01Icon,
  Search01Icon,
  Cancel01Icon,
  Link01Icon,
  RefreshIcon,
  Logout01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/theme';
import { showToast } from '@/context/ToastContext';
import { fetchToolsWithConnectionStatus } from '@/services/toolsService';
import {
  checkToolConnection,
  disconnectTool,
} from '@/lib/composioBackend';
import { runToolConnectionFlow } from '@/lib/connectToolFlow';
import { ToolLogo as SharedToolLogo } from '@/components/common/ToolLogo';
import type { ToolWithConnection } from '@/types';

WebBrowser.maybeCompleteAuthSession();

type GroupKey = 'Email' | 'Messaging' | 'Calendar' | 'Other';

const GROUP_ORDER: GroupKey[] = ['Email', 'Messaging', 'Calendar', 'Other'];

const LOGO_SIZE = 28;

/** Maps a tool to a display group using slug first, then category text. */
function resolveGroup(tool: ToolWithConnection): GroupKey {
  const slug = tool.slug.toLowerCase();
  const category = tool.category.toLowerCase();

  if (/(gmail|outlook|mail)/.test(slug)) return 'Email';
  if (slug.includes('calendar')) return 'Calendar';
  if (/(slack|discord|telegram|whatsapp|teams|message)/.test(slug)) return 'Messaging';

  if (category.includes('email')) return 'Email';
  if (category.includes('calendar') || category.includes('scheduling')) return 'Calendar';
  if (category.includes('messag') || category.includes('collaboration')) return 'Messaging';
  return 'Other';
}

/** Case-insensitive match on name, slug, description, category and action names. */
function matchesQuery(tool: ToolWithConnection, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    tool.name,
    tool.slug,
    tool.description,
    tool.category,
    resolveGroup(tool),
    ...tool.actions.map((a) => `${a.name} ${a.description || ''}`),
  ]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

const STATUS_META = {
  connected: { label: 'Connected', color: Colors.success },
  pending: { label: 'Pending', color: Colors.warning },
  failed: { label: 'Failed', color: Colors.error },
  revoked: { label: 'Revoked', color: Colors.error },
  not_connected: { label: 'Not connected', color: Colors.iconMuted },
} as const;

/** Thin adapter so rows and the manage sheet keep passing a whole tool. */
function ToolLogo({ tool }: { tool: ToolWithConnection }) {
  return (
    <SharedToolLogo
      logoUrl={tool.logo_url}
      logoKey={tool.logo_key}
      slug={tool.slug}
      size={LOGO_SIZE}
    />
  );
}

interface ToolActions {
  busy: boolean;
  onConnect: (tool: ToolWithConnection) => void;
  onManage: (tool: ToolWithConnection) => void;
}

function ActionButton({ tool, busy, onConnect, onManage }: { tool: ToolWithConnection } & ToolActions) {
  if (busy) {
    return (
      <View style={[styles.pillBtn, styles.connectBtn, styles.btnDisabled]}>
        <ActivityIndicator color={Colors.textWhite} size="small" />
      </View>
    );
  }

  if (tool.status === 'connected') {
    return (
      <TouchableOpacity
        style={[styles.pillBtn, styles.manageBtn]}
        activeOpacity={0.7}
        onPress={() => onManage(tool)}>
        <Text style={[styles.pillBtnText, styles.manageBtnText]}>Manage</Text>
      </TouchableOpacity>
    );
  }

  if (tool.status === 'pending') {
    return (
      <TouchableOpacity
        style={[styles.pillBtn, styles.manageBtn]}
        activeOpacity={0.7}
        onPress={() => onManage(tool)}>
        <Text style={[styles.pillBtnText, styles.manageBtnText]}>Resume</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.pillBtn, styles.connectBtn]}
      activeOpacity={0.8}
      onPress={() => onConnect(tool)}>
      <Text style={styles.pillBtnText}>
        {tool.status === 'failed' || tool.status === 'revoked' ? 'Reconnect' : 'Connect'}
      </Text>
    </TouchableOpacity>
  );
}

function ToolRow({ tool, ...actions }: { tool: ToolWithConnection } & ToolActions) {
  const status = STATUS_META[tool.status] ?? STATUS_META.not_connected;
  const account = tool.status === 'connected' ? tool.connected_email || tool.connected_label : null;
  const actionCount = tool.actions.length;

  return (
    <View style={styles.toolRow}>
      <View style={styles.logoTile}>
        <ToolLogo tool={tool} />
      </View>

      <View style={styles.toolBody}>
        <Text style={styles.toolName} numberOfLines={1}>{tool.name}</Text>
        <Text style={styles.toolDesc} numberOfLines={1}>{tool.description}</Text>
        <Text style={styles.toolMeta} numberOfLines={1}>
          <Text style={{ color: status.color, fontWeight: '700' }}>{status.label}</Text>
          {account ? ` · ${account}` : ''}
          {actionCount > 0 ? ` · ${actionCount} action${actionCount === 1 ? '' : 's'}` : ''}
        </Text>
      </View>

      <ActionButton tool={tool} {...actions} />
    </View>
  );
}

function ManageSheet({
  tool,
  refreshing,
  onClose,
  onRefresh,
  onReconnect,
  onDisconnect,
}: {
  tool: ToolWithConnection | null;
  refreshing: boolean;
  onClose: () => void;
  onRefresh: (tool: ToolWithConnection) => void;
  onReconnect: (tool: ToolWithConnection) => void;
  onDisconnect: (tool: ToolWithConnection) => void;
}) {
  const status = tool ? STATUS_META[tool.status] ?? STATUS_META.not_connected : null;
  const account = tool?.connected_email || tool?.connected_label;

  return (
    <Modal visible={!!tool} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {tool && status && (
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <View style={styles.logoTile}>
                <ToolLogo tool={tool} />
              </View>
              <View style={styles.sheetTitleWrap}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{tool.name}</Text>
                <View style={[styles.statusChip, { backgroundColor: status.color + '1F' }]}>
                  <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                  <Text style={[styles.statusChipText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.6}>
                <HugeiconsIcon icon={Cancel01Icon} size={18} color={Colors.iconMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetDesc}>{tool.description}</Text>

            {tool.status === 'connected' && (
              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <HugeiconsIcon icon={UserIcon} size={20} color={Colors.iconMuted} strokeWidth={2} />
                  <View style={styles.infoBody}>
                    <Text style={styles.infoLabel}>CONNECTED ACCOUNT</Text>
                    <Text
                      style={[styles.infoValue, !account && styles.infoValueMuted]}
                      numberOfLines={1}>
                      {account || (refreshing ? 'Checking…' : 'Not available yet')}
                    </Text>
                  </View>
                  {refreshing ? (
                    <ActivityIndicator size="small" color={Colors.iconMuted} />
                  ) : (
                    <TouchableOpacity onPress={() => onRefresh(tool)} hitSlop={10} activeOpacity={0.6}>
                      <HugeiconsIcon
                        icon={RefreshIcon}
                        size={20}
                        color={Colors.primary}
                        strokeWidth={2}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {tool.status === 'pending' && (
              <Text style={styles.sheetHint}>This connection was started but not finished.</Text>
            )}

            <TouchableOpacity
              style={[styles.sheetBtn, styles.reconnectBtn]}
              activeOpacity={0.8}
              onPress={() => onReconnect(tool)}>
              <HugeiconsIcon icon={Link01Icon} size={20} color={Colors.primary} strokeWidth={2} />
              <Text style={[styles.sheetBtnText, { color: Colors.primary }]}>
                {tool.status === 'pending' ? 'Continue Connecting' : 'Reconnect Account'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.disconnectBtn]}
              activeOpacity={0.8}
              onPress={() => onDisconnect(tool)}>
              <HugeiconsIcon icon={Logout01Icon} size={20} color={Colors.error} strokeWidth={2} />
              <Text style={[styles.sheetBtnText, { color: Colors.error }]}>
                {tool.status === 'pending' ? 'Cancel Connection' : 'Disconnect Tool'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

export default function ToolsConnectionsScreen() {
  const router = useRouter();
  const [tools, setTools] = useState<ToolWithConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setTools(await fetchToolsWithConnectionStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  // Backend routes accept the tool slug as well as its UUID.
  const refreshStatus = useCallback(
    async (tool: ToolWithConnection, quiet = false) => {
      setBusyId(tool.id);
      try {
        const state = await checkToolConnection(tool.slug);
        await load(true);
        if (!quiet) {
          showToast(
            state.status === 'connected'
              ? `${tool.name} connected`
              : state.status === 'pending'
                ? `${tool.name} is still pending`
                : `${tool.name} connection ${state.status}`,
          );
        }
      } catch (e: any) {
        showToast(e?.message ?? `Could not check ${tool.name}`);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  // Shared with the chat Connect CTA (src/lib/connectToolFlow.ts).
  const handleConnect = useCallback(
    async (tool: ToolWithConnection) => {
      setBusyId(tool.id);
      try {
        const { message } = await runToolConnectionFlow(tool.slug, tool.name);
        showToast(message);
        await load(true);
      } catch (e: any) {
        showToast(e?.message ?? `Could not connect ${tool.name}`);
        await load(true);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const doDisconnect = useCallback(
    async (tool: ToolWithConnection) => {
      setBusyId(tool.id);
      try {
        await disconnectTool(tool.slug);
        await load(true);
        showToast(`${tool.name} disconnected`);
      } catch (e: any) {
        showToast(e?.message ?? `Could not disconnect ${tool.name}`);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const [managing, setManaging] = useState<ToolWithConnection | null>(null);

  const openManage = useCallback(
    (tool: ToolWithConnection) => {
      setManaging(tool);
      // Pick up a finished OAuth or a missing account email in the background.
      const needsEmail = tool.status === 'connected' && !tool.connected_email;
      if (tool.status === 'pending' || needsEmail) refreshStatus(tool, true);
    },
    [refreshStatus],
  );

  // Keep the open sheet in sync with the latest tool data after refreshes.
  const managedTool = managing ? tools.find((t) => t.id === managing.id) ?? managing : null;

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map: Record<GroupKey, ToolWithConnection[]> = {
      Email: [],
      Messaging: [],
      Calendar: [],
      Other: [],
    };
    tools.filter((t) => matchesQuery(t, query)).forEach((t) => map[resolveGroup(t)].push(t));
    return map;
  }, [tools, query]);

  const visibleGroups = GROUP_ORDER.filter((key) => grouped[key].length > 0);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} activeOpacity={0.6}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={24} color={Colors.iconDark} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Tools & Connections</Text>
      </View>

      <View style={styles.searchWrap}>
        <HugeiconsIcon icon={Search01Icon} size={20} color={Colors.iconMuted} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search tools"
          placeholderTextColor={Colors.iconMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} activeOpacity={0.6}>
            <HugeiconsIcon icon={Cancel01Icon} size={18} color={Colors.iconMuted} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          {visibleGroups.map((key) => (
            <View key={key} style={styles.section}>
              <Text style={styles.sectionTitle}>{key}</Text>
              <View style={styles.groupCard}>
                {grouped[key].map((tool, idx) => (
                  <React.Fragment key={tool.id}>
                    {idx > 0 && <View style={styles.rowDivider} />}
                    <ToolRow
                      tool={tool}
                      busy={busyId === tool.id}
                      onConnect={handleConnect}
                      onManage={openManage}
                    />
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))}
          {visibleGroups.length === 0 && (
            <Text style={styles.emptyText}>
              {query.trim() ? `No tools match "${query.trim()}"` : 'No tools available.'}
            </Text>
          )}
        </ScrollView>
      )}

      <ManageSheet
        tool={managedTool}
        refreshing={!!managedTool && busyId === managedTool.id}
        onClose={() => setManaging(null)}
        onRefresh={(tool) => refreshStatus(tool)}
        onReconnect={(tool) => {
          setManaging(null);
          handleConnect(tool);
        }}
        onDisconnect={(tool) => {
          setManaging(null);
          doDisconnect(tool);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.iconDark,
    letterSpacing: -0.5,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: Spacing.three,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.iconDark,
    paddingVertical: 0,
    outlineStyle: 'none',
  } as any,
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.five,
  },
  section: {
    marginBottom: Spacing.three,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.iconMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 24,
    marginBottom: Spacing.two,
  },
  groupCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.white,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.cardDivider,
    marginLeft: 76,
    marginRight: 16,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  logoTile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBody: {
    flex: 1,
    minWidth: 0,
  },
  toolName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.iconDark,
    letterSpacing: -0.2,
  },
  toolDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  toolMeta: {
    fontSize: 11.5,
    color: Colors.iconMuted,
    marginTop: 3,
  },
  pillBtn: {
    minWidth: 92,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textWhite,
  },
  connectBtn: {
    backgroundColor: Colors.primary,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  manageBtn: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
  },
  manageBtnText: {
    color: Colors.iconDark,
  },
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.white,
    borderRadius: 28,
    padding: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  sheetTitleWrap: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 6,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.iconDark,
    letterSpacing: -0.4,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDesc: {
    fontSize: 15,
    lineHeight: 21,
    color: Colors.textSecondary,
    marginTop: 16,
    marginBottom: 16,
  },
  infoCard: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  infoBody: {
    flex: 1,
    minWidth: 0,
  },
  infoLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: Colors.iconMuted,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.iconDark,
    marginTop: 3,
  },
  sheetHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  infoValueMuted: {
    fontWeight: '500',
    color: Colors.iconMuted,
  },
  infoValueMono: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 3,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.cardDivider,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
  },
  sheetBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  reconnectBtn: {
    backgroundColor: Colors.primarySubtle,
    borderColor: Colors.primaryBorder,
  },
  disconnectBtn: {
    backgroundColor: Colors.errorLight,
    borderColor: Colors.errorLight,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.iconMuted,
    marginTop: Spacing.five,
    paddingHorizontal: 24,
  },
});
