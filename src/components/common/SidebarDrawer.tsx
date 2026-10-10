/**
 * SidebarDrawer Component
 *
 * Partial slide-over panel (the chat page stays visible on the right):
 * 1. Top bar: Agent name & search button
 * 2. Main chat: pinned row that always opens the user's primary conversation
 * 3. Chats: list of saved conversations, each renameable and deletable
 * 4. Bottom Toolbar: settings (left) and new chat (right)
 * 5. A "back to chat" button sits on the exposed strip of the chat page
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Pressable,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  ArrowRight01Icon,
  Delete02Icon,
  Settings01Icon,
  Search01Icon,
  Edit02Icon,
  PencilEdit02Icon,
  Comment01Icon,
} from '@hugeicons/core-free-icons';
import { Colors } from '@/constants/colors';
import { SideChatItem } from '@/types';
import { showToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import {
  DeleteThread,
  GetAllUserThreads,
  UpdateThreadTitle,
} from '@/services/chatHistory';
import { useRouter } from 'expo-router';

/** Share of the screen width taken by the panel; the rest shows the chat. */
const PANEL_RATIO = 0.82;
const ANIMATION_MS = 220;

export interface SidebarDrawerProps {
  /** Visibility state of the drawer modal */
  visible: boolean;
  /** Active chat session identifier */
  activeChatId?: string;
  /** Active agent name displayed in drawer header */
  agentName?: string;
  /** Callback fired to close the drawer */
  onClose: () => void;
  /** Callback fired when a conversation item is tapped */
  onSelectChat: (chatTitle: string) => void;
  /** Callback fired to initiate a clean chat session */
  onNewChat: () => void;
  /** Callback fired to navigate directly to settings */
  onOpenSettings?: () => void;
  /** Callback fired to clear all side chat topics */
  onClearSideChats?: () => void;
}

/**
 * Slide-over Session History Drawer
 */
export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  visible,
  agentName = 'Cooper',
  onClose,
  onSelectChat,
  onNewChat,
  onOpenSettings,
  onClearSideChats,
}) => {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const panelWidth = Math.round(width * PANEL_RATIO);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [chatList, setChatList] = useState<SideChatItem[]>([]);
  const [mainChat, setMainChat] = useState<{ id: string } | null>(null);
  const [renamingChat, setRenamingChat] = useState<SideChatItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  // Keep the modal mounted until the slide-out animation finishes.
  const [rendered, setRendered] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setRendered(true);

    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: ANIMATION_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setRendered(false);
    });
  }, [visible, progress]);

  // Load user session on mount
  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getSession();
      setUserEmail(data?.session?.user?.email ?? null);
    };
    loadUser();
  }, []);

  const GetAllUserChatThreads = useCallback(async () => {
    if (!userEmail) return;
    const data = await GetAllUserThreads(userEmail);

    const rows = data ?? [];

    // The main chat is pinned above the list; everything else is listed
    // newest first.
    const main = rows.find((thread: any) => thread.type === 'main');
    setMainChat(main ? { id: main.id } : null);
    setChatList(
      rows
        .filter((thread: any) => thread.type !== 'main')
        .map((thread: any) => ({
          id: thread.id,
          title: thread.title || 'Untitled chat',
          hasUnreadDot: thread.has_unread_updates ?? false,
        })),
    );
  }, [userEmail]);

  // Reload on every open so chats saved since the last visit show up.
  useEffect(() => {
    if (visible) GetAllUserChatThreads();
  }, [visible, GetAllUserChatThreads]);

  const DeleteChat = async (threadId: string) => {
    await DeleteThread(threadId);
    GetAllUserChatThreads();
  };

  const OpenChat = (chat: SideChatItem) => {
    router.replace({
      pathname: '/(tabs)/chat',
      params: { thread_id: chat.id },
    });
    onSelectChat(chat.title);
    onClose();
  };

  /**
   * Opens the main chat. With no main thread yet this is an empty draft: the
   * thread is created when the first message is sent.
   */
  const OpenMainChat = () => {
    router.replace({
      pathname: '/(tabs)/chat',
      params: mainChat
        ? { thread_id: mainChat.id, chatType: 'main' }
        : { chatType: 'main', fresh: String(Date.now()) },
    });
    onSelectChat('Main chat');
    onClose();
  };

  /** Full-screen search over saved chats. */
  const OpenSearch = () => {
    onClose();
    router.push('/chat-search' as any);
  };

  const OpenRename = (chat: SideChatItem) => {
    setRenamingChat(chat);
    setRenameValue(chat.title);
  };

  const SaveRename = async () => {
    const title = renameValue.trim();
    if (!renamingChat || !title) return;

    setSavingRename(true);
    try {
      await UpdateThreadTitle(renamingChat.id, title);
      setChatList((prev) =>
        prev.map((chat) =>
          chat.id === renamingChat.id ? { ...chat, title } : chat,
        ),
      );
      setRenamingChat(null);
      showToast('Chat renamed');
    } catch {
      showToast('Could not rename this chat');
    } finally {
      setSavingRename(false);
    }
  };

  const slide = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth, 0],
  });

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Dim the chat page still visible on the right */}
        <Animated.View
          style={[styles.backdrop, { opacity: progress }]}
          pointerEvents="none"
        />
        <Pressable
          style={styles.backdropTouch}
          onPress={onClose}
          accessibilityLabel="Close sidebar"
        />

        {/* Slide-over panel */}
        <Animated.View
          style={[
            styles.panel,
            { width: panelWidth, transform: [{ translateX: slide }] },
          ]}>
          <SafeAreaView style={styles.safeContainer} edges={['top', 'bottom', 'left']}>
            {/* Top Bar: Agent name + Search */}
            <View style={styles.header}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {agentName}
              </Text>

              <TouchableOpacity
                style={styles.circleBtn}
                onPress={OpenSearch}
                activeOpacity={0.7}
                accessibilityLabel="Search chats">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={21}
                  color={Colors.iconDark}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            </View>

            {/* Pinned main chat */}
            <TouchableOpacity
              style={styles.mainChatRow}
              onPress={OpenMainChat}
              activeOpacity={0.7}
              accessibilityLabel="Open main chat">
              <View style={styles.mainChatIcon}>
                <HugeiconsIcon
                  icon={Comment01Icon}
                  size={19}
                  color={Colors.iconDark}
                  strokeWidth={2}
                />
              </View>
              <Text style={styles.mainChatText}>Main chat</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Saved Chats Section */}
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderText}>Chats</Text>
              </View>

              {chatList.length === 0 && (
                <Text style={styles.emptyText}>
                  No side chats yet. Tap New chat to start one.
                </Text>
              )}

              {chatList.map((chat) => (
                <View key={chat.id} style={styles.chatRowWrapper}>
                  {/* Tappable title (left) */}
                  <TouchableOpacity
                    style={styles.chatRow}
                    onPress={() => OpenChat(chat)}
                    activeOpacity={0.7}>
                    <Text style={styles.chatRowText} numberOfLines={1}>
                      {chat.title}
                    </Text>
                    {chat.hasUnreadDot && <View style={styles.blueDot} />}
                  </TouchableOpacity>

                  {/* Rename */}
                  <TouchableOpacity
                    style={styles.rowIconBtn}
                    onPress={() => OpenRename(chat)}
                    activeOpacity={0.7}
                    accessibilityLabel={`Rename ${chat.title}`}>
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={19}
                      color={Colors.iconMuted}
                      strokeWidth={1.8}
                    />
                  </TouchableOpacity>

                  {/* Delete */}
                  <TouchableOpacity
                    style={styles.rowIconBtn}
                    onPress={() => {
                      DeleteChat(chat.id);
                      onClearSideChats?.();
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel={`Delete ${chat.title}`}>
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={20}
                      color={Colors.iconMuted}
                      strokeWidth={1.8}
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            {/* Bottom Toolbar: Settings (left) + New chat (right) */}
            <View style={styles.bottomToolbar}>
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={() => {
                  onClose();
                  onOpenSettings?.();
                }}
                activeOpacity={0.7}
                accessibilityLabel="Settings">
                <HugeiconsIcon
                  icon={Settings01Icon}
                  size={22}
                  color={Colors.iconDark}
                  strokeWidth={2}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.circleBtn, styles.newChatBtn]}
                onPress={onNewChat}
                activeOpacity={0.7}
                accessibilityLabel="New chat">
                <HugeiconsIcon
                  icon={Edit02Icon}
                  size={20}
                  color={Colors.iconDark}
                  strokeWidth={2}
                />
                <Text style={styles.newChatText}>New chat</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Animated.View>

        {/* Back to chat, on the exposed strip of the chat page */}
        <Animated.View
          style={[styles.backToChatWrap, { left: panelWidth, opacity: progress }]}>
          <SafeAreaView edges={['top']}>
            <TouchableOpacity
              style={[styles.circleBtn, styles.backToChatBtn]}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Back to chat">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={22}
                color={Colors.iconDark}
                strokeWidth={2.2}
              />
            </TouchableOpacity>
          </SafeAreaView>
        </Animated.View>

        {/* Rename Chat Sheet */}
        {renamingChat && (
          <View style={styles.renameBackdrop}>
            <Pressable
              style={styles.renameBackdropTouch}
              onPress={() => setRenamingChat(null)}
            />
            <View style={styles.renameSheet}>
              <Text style={styles.renameTitle}>Rename chat</Text>
              <TextInput
                style={styles.renameInput}
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Chat title"
                placeholderTextColor={Colors.iconMuted}
                maxLength={60}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={SaveRename}
              />
              <View style={styles.renameActions}>
                <TouchableOpacity
                  style={[styles.renameBtn, styles.renameCancel]}
                  activeOpacity={0.8}
                  onPress={() => setRenamingChat(null)}>
                  <Text style={styles.renameCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.renameBtn,
                    styles.renameSave,
                    (!renameValue.trim() || savingRename) && styles.renameDisabled,
                  ]}
                  activeOpacity={0.85}
                  disabled={!renameValue.trim() || savingRename}
                  onPress={SaveRename}>
                  {savingRename ? (
                    <ActivityIndicator size="small" color={Colors.textWhite} />
                  ) : (
                    <Text style={styles.renameSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.overlaySoft,
  },
  backdropTouch: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.white,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: Colors.black,
        shadowOffset: { width: 4, height: 0 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
      },
      android: {
        elevation: 16,
      },
      web: {
        boxShadow: '4px 0 24px rgba(0, 0, 0, 0.12)',
      },
    }),
  },
  safeContainer: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  backToChatWrap: {
    position: 'absolute',
    top: 0,
    paddingLeft: 12,
    paddingTop: 8,
  },
  backToChatBtn: {
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 14,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.iconDark,
    letterSpacing: -0.2,
  },
  circleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.cardDivider,
    ...Platform.select({
      ios: {
        shadowColor: Colors.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      },
    }),
  },
  divider: {
    height: 1,
    backgroundColor: Colors.cardDivider,
    width: '100%',
  },
  mainChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  mainChatIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
  },
  mainChatText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.iconDark,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  sectionHeaderRow: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.iconMuted,
  },
  emptyText: {
    paddingHorizontal: 20,
    paddingTop: 4,
    fontSize: 14.5,
    lineHeight: 21,
    color: Colors.iconMuted,
  },
  chatRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  chatRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingVertical: 14,
  },
  chatRowText: {
    fontSize: 16,
    fontWeight: '400',
    color: Colors.iconDark,
    flex: 1,
    paddingRight: 10,
  },
  rowIconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.statusBlue,
  },
  newChatBtn: {
    width: 'auto',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
  },
  newChatText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.iconDark,
  },
  bottomToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 16,
    backgroundColor: Colors.white,
  },
  renameBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  renameBackdropTouch: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  renameSheet: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  renameTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.iconDark,
  },
  renameInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Colors.iconDark,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  renameBtn: {
    minWidth: 96,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameCancel: {
    backgroundColor: Colors.surfaceMuted,
  },
  renameCancelText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  renameSave: {
    backgroundColor: Colors.primary,
  },
  renameSaveText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: Colors.textWhite,
  },
  renameDisabled: {
    opacity: 0.6,
  },
});

export default SidebarDrawer;
