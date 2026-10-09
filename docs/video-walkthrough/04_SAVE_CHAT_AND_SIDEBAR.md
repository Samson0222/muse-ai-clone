# 💾 Chapter 04 — Save Chat Conversation, Thread Loading & Sidebar Drawer

> **Video Timestamp:** `01:14:33 - 02:22:13`  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)

---

## 🎯 What the Video Covers in this Chapter

In this chapter, TubeGuruji transitions the app from a static in-memory chat into a **fully persistent, multi-thread conversational app powered by Supabase**:

1. **Supabase Database Schema:** Creating `chat_threads` and `chat_messages` tables with Row Level Security (RLS).
2. **Database Helper Service:** Implementing `src/services/chatHistory.ts` (`CreateNewThread`, `getThread`, `saveMessage`, `LoadMessages`, `GetAllUserThreads`, `DeleteThread`).
3. **Dynamic Host URL Helper:** `src/lib/services.ts` (`getApiUrl`) to resolve the local Metro IP for mobile emulators.
4. **Complete `chat.tsx` Overhaul:**
   - Reading `thread_id` and `chatType` from URL params via `useLocalSearchParams()`.
   - Fetching user's email from `supabase.auth.getSession()`.
   - Initializing/retrieving the user's default `"main"` thread on startup.
   - Loading historical messages from Supabase whenever the active thread changes.
   - Saving user messages into Supabase before calling the API.
   - Saving agent responses into Supabase (which automatically sets the thread title to the first 40 characters!).
   - Displaying `<ActivityIndicator /> AI is typing...` while waiting for the response.
5. **`SidebarDrawer.tsx` Integration:**
   - Loading all threads for the logged-in user with `GetAllUserThreads(userEmail)`.
   - Tapping a thread switches the active conversation via `router.push({ pathname: '/(tabs)/chat', params: { thread_id: item.id } })`.
   - "New Chat" button creates a fresh `'side'` thread and immediately opens it.
   - Thread deletion support.

---

## 🏛️ Step 1: Database Migration in Supabase

Run this SQL in your **Supabase SQL Editor**:

```sql
create extension if not exists "uuid-ossp";

-- 1. CHAT THREADS
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  type text not null default 'side' check (type in ('main', 'side')),
  title text default 'New Conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_threads enable row level security;

create policy "Users can manage their own threads"
  on public.chat_threads for all to authenticated
  using (auth.email() = user_email)
  with check (auth.email() = user_email);

-- 2. CHAT MESSAGES
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_email text,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "Users can manage messages in their threads"
  on public.chat_messages for all to authenticated
  using (
    exists (
      select 1 from public.chat_threads
      where public.chat_threads.id = public.chat_messages.thread_id
      and public.chat_threads.user_email = auth.email()
    )
  );
```

---

## 🛠️ Step 2: Implement `src/services/chatHistory.ts`

Ensure `src/services/chatHistory.ts` matches TubeGuruji's implementation:

```typescript
import { supabase } from "@/lib/supabase";

export type ChatThreadType = 'main' | 'side';
export type ChatMessageRole = 'user' | 'assistant';

/**
 * Creates a new conversation thread in Supabase.
 */
export const CreateNewThread = async (userEmail: string, type: ChatThreadType, title?: string) => {
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({
      user_email: userEmail,
      type: type,
      title: title || 'New Conversation'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Fetches thread by ID, or falls back to finding the user's 'main' thread.
 */
export const getThread = async (threadId: string, userEmail?: string) => {
  if (!threadId) {
    const { data, error } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('type', 'main')
      .eq('user_email', userEmail)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

/**
 * Saves a message to chat_messages and updates thread title / updated_at.
 */
export const saveMessage = async (
  userEmail: string,
  threadId: string,
  role: ChatMessageRole,
  content: string,
  metadata: any = {}
) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      user_email: userEmail,
      thread_id: threadId,
      role: role,
      content: content,
      metadata: metadata
    })
    .select()
    .single();

  if (error) throw error;

  // Update thread's updated_at timestamp
  await supabase
    .from('chat_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', threadId);

  // If this is the first assistant reply, use snippet as thread title
  if (role === 'assistant') {
    await supabase
      .from('chat_threads')
      .update({ title: content?.slice(0, 40) })
      .eq('id', threadId);
  }

  return data;
};

/**
 * Loads all messages for a thread ordered by creation date.
 */
export const LoadMessages = async (threadId: string) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
};

/**
 * Retrieves all threads for a user (for the Sidebar Drawer).
 */
export const GetAllUserThreads = async (userEmail: string) => {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

/**
 * Deletes a thread and all of its associated messages.
 */
export const DeleteThread = async (threadId: string) => {
  await supabase
    .from('chat_messages')
    .delete()
    .eq('thread_id', threadId);

  const { data, error } = await supabase
    .from('chat_threads')
    .delete()
    .eq('id', threadId);

  if (error) throw error;
  return data;
};
```

---

## 🌐 Step 3: Implement `src/lib/services.ts` (`getApiUrl`)

On physical devices or mobile emulators, `fetch('/api/chat')` cannot find the Metro dev server. `Constants.expoConfig?.hostUri` dynamically gets the development machine's local IP:

```typescript
import Constants from 'expo-constants';

export function getApiUrl(path: string) {
  const hostUrl = Constants.expoConfig?.hostUri;
  return `http://${hostUrl}/api${path}`;
}
```

---

## 📱 Step 4: Complete Update for `src/app/(tabs)/chat.tsx`

Here is the exact, complete implementation TubeGuruji builds in the video for `chat.tsx`:

```tsx
/**
 * Chat Tab Screen ('/(tabs)/chat')
 *
 * Full-featured conversational companion UI with Supabase persistence:
 * - Thread loading and auto-initialization of 'main' thread
 * - Search param listener to switch threads from Drawer
 * - Loading chat history from Supabase
 * - Optimistic UI updates with typing indicator
 * - Persistent message storage for user and agent
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { Add01Icon, Mic01Icon, SentIcon } from '@hugeicons/core-free-icons';
import { useLocalSearchParams } from 'expo-router';
import axios from 'axios';

import { Colors } from '@/constants/colors';
import { ChatMessage } from '@/types';
import { showToast } from '@/context/ToastContext';
import { getApiUrl } from '@/lib/services';
import { supabase } from '@/lib/supabase';
import {
  CreateNewThread,
  getThread,
  LoadMessages,
  saveMessage,
} from '@/services/chatHistory';

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadData, setThreadData] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const headerOffset = Platform.OS === 'ios' ? insets.top + 98 : 0;

  // 1. Listen to thread_id passed from Sidebar Drawer navigation
  const { thread_id } = useLocalSearchParams();

  useEffect(() => {
    if (thread_id) {
      setThreadId(thread_id as string);
    }
  }, [thread_id]);

  // 2. Fetch logged-in user email on mount
  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email;
      setUserEmail(email ?? null);
    };
    loadUser();
  }, []);

  // 3. Auto-scroll to latest message
  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // 4. Initialize thread and fetch message history
  useEffect(() => {
    if (!userEmail) return;

    if (!threadId) {
      GetThreadData();
    } else {
      getChatHistory();
    }
  }, [threadId, userEmail]);

  // Ensure default 'main' thread exists in Supabase
  const GetThreadData = async () => {
    if (!userEmail) return;

    let thread = await getThread('', userEmail);
    if (!thread) {
      thread = await CreateNewThread(userEmail, 'main', 'Main Chat');
    }
    setThreadData(thread);
    setThreadId(thread?.id ?? null);
  };

  // Load historical messages from Supabase for current thread
  const getChatHistory = async () => {
    if (!threadId) return;

    const dbMessages = await LoadMessages(threadId);
    const mapped: ChatMessage[] = (dbMessages || []).map((msg: any) => ({
      id: msg.id,
      sender: msg.role === 'user' ? 'user' : 'agent',
      text: msg.content,
      timestamp: new Date(msg.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

    setMessages(mapped);
  };

  // Keyboard auto-scroll listener
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    return () => sub.remove();
  }, []);

  // 5. Send message, save to Supabase, call API, save agent reply
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !threadId) return;

    setIsSending(true);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');

    // Save user message to Supabase
    await saveMessage(userEmail ?? '', threadId, 'user', text, {});

    try {
      const apiUrl = getApiUrl('/chat');
      const result = await axios.post(apiUrl, {
        messages: [...messages, userMsg],
      });

      const data = result.data;
      const agentReplyText = data?.output ?? 'No response from AI agent. Try again.';

      const agentMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'agent',
        text: agentReplyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, agentMsg]);

      // Save agent response to Supabase (also sets thread title!)
      await saveMessage(userEmail ?? '', threadId, 'assistant', agentReplyText, {});
    } catch (error) {
      console.error('Error sending message:', error);
      showToast('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerOffset}>
      <View style={styles.content}>
        {/* Scrollable Messages Thread */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.scrollInner}>
              {/* Centered Date Badge */}
              <View style={styles.dateBadgeContainer}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeText}>Today</Text>
                </View>
              </View>

              {/* Message List */}
              {messages.map((msg) => {
                const isUser = msg.sender === 'user';
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.messageRow,
                      isUser ? styles.userMessageRow : styles.agentMessageRow,
                    ]}>
                    <View
                      style={[
                        styles.bubble,
                        isUser ? styles.userBubble : styles.agentBubble,
                      ]}>
                      <Text
                        style={[
                          styles.bubbleText,
                          isUser ? styles.userBubbleText : styles.agentBubbleText,
                        ]}>
                        {msg.text}
                      </Text>
                    </View>
                  </View>
                );
              })}

              {/* Typing indicator when waiting for agent */}
              {isSending && (
                <View style={styles.typingContainer}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.typingText}>Cooper is thinking...</Text>
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>

        {/* Floating Prompt Input Bar */}
        <View style={styles.inputWrapper}>
          <View style={styles.inputBar}>
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={() => showToast('Attach file')}
              activeOpacity={0.7}>
              <HugeiconsIcon icon={Add01Icon} size={20} color={Colors.iconDark} strokeWidth={2.2} />
            </TouchableOpacity>

            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ask anything..."
              placeholderTextColor={Colors.iconMuted}
              multiline
            />

            <TouchableOpacity
              style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || isSending}
              activeOpacity={0.8}>
              <HugeiconsIcon
                icon={inputText.trim() ? SentIcon : Mic01Icon}
                size={18}
                color={Colors.white}
                strokeWidth={2.2}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  content: { flex: 1 },
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 100 },
  scrollInner: { flex: 1 },
  dateBadgeContainer: { alignItems: 'center', marginVertical: 12 },
  dateBadge: {
    backgroundColor: '#F1F3F5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  dateBadgeText: { fontSize: 12, color: Colors.iconMuted, fontWeight: '500' },
  messageRow: { marginVertical: 6, flexDirection: 'row' },
  userMessageRow: { justifyContent: 'flex-end' },
  agentMessageRow: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: Colors.chatBubbleUser,
    borderBottomRightRadius: 4,
  },
  agentBubble: {
    backgroundColor: Colors.chatBubbleAi,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, color: Colors.iconDark },
  userBubbleText: { color: Colors.iconDark },
  agentBubbleText: { color: Colors.iconDark },
  typingContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  typingText: { fontSize: 13, color: Colors.iconMuted, fontStyle: 'italic' },
  inputWrapper: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.iconDark,
    paddingHorizontal: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#9CA3AF',
  },
});
```

---

## 🗂️ Step 5: Update `src/components/common/SidebarDrawer.tsx` (`CreateNewSideChat`)

In the video tutorial, TubeGuruji preserves the full starter drawer layout (Main chat capsule at the top + Side chats list in the center + Bottom toolbar with Search & Compose button), and wires up Supabase data using **`CreateNewSideChat`**:

- **Main Chat:** The top capsule jumps to the user's permanent `'main'` thread.
- **Side Chats:** The scrollable list below displays user threads where `type === 'side'`.
- **`CreateNewSideChat`:** Called when the user taps the compose pencil button in the bottom toolbar. It creates a new thread in Supabase with `type: 'side'`, switches to it with `router.replace`, refreshes the drawer list, and closes the drawer.

Replace `src/components/common/SidebarDrawer.tsx` with TubeGuruji's exact implementation:

```tsx
/**
 * SidebarDrawer Component
 *
 * Fullscreen sliding drawer interface providing session management:
 * 1. Top bar: Agent title & right arrow dismissal button
 * 2. Main Chat: Quick jump capsule back to primary conversation
 * 3. Side Chats: Filterable list of parallel conversation threads with unread indicators
 * 4. Bottom Toolbar: Settings gear shortcut, search filter input, and compose new side chat button
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  ArrowRight01Icon,
  Delete02Icon,
  Edit02Icon,
  Search01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';

import { Colors } from '@/constants/colors';
import { showToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import {
  CreateNewThread,
  DeleteThread,
  GetAllUserThreads,
} from '@/services/chatHistory';
import { SideChatItem } from '@/types';

export interface SidebarDrawerProps {
  visible: boolean;
  activeChatId?: string;
  agentName?: string;
  onClose: () => void;
  onSelectChat?: (chatTitle: string) => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onClearSideChats?: () => void;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  visible,
  agentName = 'Cooper',
  onClose,
  onOpenSettings,
  onClearSideChats,
}) => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sideChatList, setSideChatList] = useState<SideChatItem[]>([]);
  const [mainChatThread, setMainChatThread] = useState<any>(null);

  // Load user session on mount
  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email;
      setUserEmail(email ?? null);
    };
    loadUser();
  }, []);

  // Refresh threads whenever drawer opens or userEmail is ready
  useEffect(() => {
    if (userEmail && visible) {
      GetAllUserChatThreads();
    }
  }, [userEmail, visible]);

  // Fetch threads and separate into 'main' and 'side' chats
  const GetAllUserChatThreads = async () => {
    if (!userEmail) return;
    const data = await GetAllUserThreads(userEmail);

    const mainChat = data?.find((thread: any) => thread.type === 'main');
    const sideChats: SideChatItem[] = (data || [])
      .filter((thread: any) => thread.type === 'side')
      .map((thread: any) => ({
        id: thread.id,
        title: thread.title,
        hasUnreadDot: thread.has_unread_updates ?? false,
      }));

    setSideChatList(sideChats);
    setMainChatThread(mainChat);
  };

  // 🌟 TubeGuruji's CreateNewSideChat implementation
  const CreateNewSideChat = async () => {
    if (!userEmail) return;

    // Create a new side chat thread and close the drawer
    const sideThread = await CreateNewThread(userEmail, 'side', 'New Side Chat');

    router.replace({
      pathname: '/(tabs)/chat',
      params: {
        thread_id: sideThread?.id,
        chatType: 'side',
      },
    });

    GetAllUserChatThreads();
    onClose();
  };

  // Delete a thread and refresh list
  const deleteThread = async (threadId: string) => {
    await DeleteThread(threadId);
    GetAllUserChatThreads();
  };

  // Filter side chat topics by active search query
  const filteredChats = sideChatList.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <SafeAreaView style={styles.safeContainer} edges={['top', 'bottom', 'left', 'right']}>
          {/* Top Bar: Center Name + Right Arrow Button */}
          <View style={styles.header}>
            <View style={styles.headerSideSpacer} />
            <Text style={styles.headerTitle}>{agentName}</Text>
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close sidebar">
              <HugeiconsIcon icon={ArrowRight01Icon} size={22} color={Colors.iconDark} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {/* Main Chat Capsule Button */}
          <View style={styles.mainChatWrapper}>
            <TouchableOpacity
              style={styles.mainChatCapsule}
              onPress={() => {
                router.replace({
                  pathname: '/(tabs)/chat',
                  params: {
                    thread_id: mainChatThread?.id,
                    chatType: 'main',
                  },
                });
                onClose();
              }}
              activeOpacity={0.8}>
              <Text style={styles.mainChatText}>Main chat</Text>
            </TouchableOpacity>
          </View>

          {/* Thin Divider Line */}
          <View style={styles.divider} />

          {/* Side Chats Section */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderText}>Side chats</Text>
            </View>

            {/* Side Chats List */}
            {filteredChats.map((chat) => (
              <View key={chat.id}>
                <TouchableOpacity
                  style={styles.chatRow}
                  onPress={() => {
                    router.replace({
                      pathname: '/(tabs)/chat',
                      params: {
                        thread_id: chat.id,
                        chatType: 'side',
                      },
                    });
                    onClose();
                  }}
                  activeOpacity={0.7}>
                  <Text style={styles.chatRowText} numberOfLines={1}>
                    {chat.title}
                  </Text>
                  <View style={styles.actionRow}>
                    {chat.hasUnreadDot && <View style={styles.blueDot} />}
                    <TouchableOpacity
                      style={styles.trashBtn}
                      onPress={() => {
                        deleteThread(chat.id);
                        onClearSideChats?.();
                      }}
                      activeOpacity={0.7}
                      accessibilityLabel="Delete chat">
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        size={20}
                        color={Colors.iconMuted}
                        strokeWidth={1.8}
                      />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          {/* Bottom Toolbar: Settings Gear (Left) + Search (Center) + Compose (Right) */}
          <View style={styles.bottomToolbar}>
            {/* Settings Gear Button */}
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={() => {
                showToast('Settings');
                onClose();
                onOpenSettings?.();
              }}
              activeOpacity={0.7}
              accessibilityLabel="Settings">
              <HugeiconsIcon icon={Settings01Icon} size={22} color={Colors.iconDark} strokeWidth={2} />
            </TouchableOpacity>

            {/* Search Capsule Input */}
            <View style={styles.searchCapsule}>
              <HugeiconsIcon icon={Search01Icon} size={18} color={Colors.iconMuted} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search"
                placeholderTextColor={Colors.iconMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {/* 🌟 New Side Chat Compose Button (Calls CreateNewSideChat) */}
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={CreateNewSideChat}
              activeOpacity={0.7}
              accessibilityLabel="New side chat">
              <HugeiconsIcon icon={Edit02Icon} size={20} color={Colors.iconDark} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: Colors.white },
  safeContainer: { flex: 1, backgroundColor: Colors.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerSideSpacer: { width: 48 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.iconDark, letterSpacing: -0.2 },
  circleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0F0F2',
    ...Platform.select({
      ios: {
        shadowColor: Colors.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
      web: { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)' },
    }),
  },
  mainChatWrapper: { paddingHorizontal: 20, marginTop: 8, marginBottom: 16 },
  mainChatCapsule: {
    width: '100%',
    height: 54,
    backgroundColor: Colors.tabActiveBg,
    borderRadius: 27,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  mainChatText: { fontSize: 16, fontWeight: '700', color: Colors.iconDark },
  divider: { height: 1, backgroundColor: '#F0F0F2', width: '100%' },
  scrollArea: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  sectionHeaderText: { fontSize: 15, fontWeight: '600', color: Colors.iconMuted },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  chatRowText: { fontSize: 16, fontWeight: '400', color: Colors.iconDark, flex: 1, paddingRight: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  blueDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#0066FF' },
  trashBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  bottomToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 16,
    backgroundColor: Colors.white,
  },
  searchCapsule: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5F6F8',
    borderWidth: 1,
    borderColor: '#ECECEC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginHorizontal: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.iconDark, paddingVertical: 0 },
});

export default SidebarDrawer;
```

---

## ✅ Chapter Verification Gate

Follow these verification steps to ensure your code matches TubeGuruji's screen:

1. **Launch the App:** Run `npx expo start` and open the app.
2. **Main Thread Creation:** Check Supabase SQL Editor:
   ```sql
   select * from public.chat_threads where type = 'main';
   ```
   A row with `title = 'Main Chat'` should exist for your user email.
3. **Send Message:** Send a message like *"What are 3 productivity tips?"*.
   - User message is stored in `chat_messages`.
   - Cooper replies, and the reply is saved in `chat_messages`.
   - The thread's `title` updates to the first 40 characters of Cooper's reply.
4. **New Chat:** Open the Sidebar Drawer and tap **"New Chat"**.
   - A new row is inserted into `chat_threads` with `type = 'side'`.
   - The chat viewport clears for the new conversation.
5. **Switching Conversations:** Select a previous thread from the drawer list; all historical messages for that thread load into the viewport.
