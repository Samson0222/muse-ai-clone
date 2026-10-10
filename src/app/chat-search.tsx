/**
 * Chat Search Screen ('/chat-search')
 *
 * Opened from the sidebar's search button.
 * - Title block at the top, results listed underneath
 * - Search field pinned to the bottom, above the keyboard
 * - Matches a chat by its title OR by the content of any message in it;
 *   a content match shows the matching snippet under the chat title
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
  Cancel01Icon,
  Comment01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';

import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { GetAllUserThreads } from '@/services/chatHistory';

const DEBOUNCE_MS = 250;
const SNIPPET_LENGTH = 90;

interface ChatResult {
  id: string;
  title: string;
  updatedAt: string | null;
  /** Message text that matched the query, when the title did not. */
  snippet?: string;
}

/** "4 days ago" style timestamps, matching the chat list design. */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return 'last week';
  if (weeks < 5) return `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return 'last month';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Trims a message down to the text around the match. */
function buildSnippet(content: string, query: string): string {
  const text = (content ?? '').replace(/\s+/g, ' ').trim();
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, SNIPPET_LENGTH);

  const start = Math.max(0, at - 30);
  const slice = text.slice(start, start + SNIPPET_LENGTH);
  return `${start > 0 ? '…' : ''}${slice}${
    start + SNIPPET_LENGTH < text.length ? '…' : ''
  }`;
}

/** Escapes the PostgREST `ilike` wildcards so a literal query matches. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export default function ChatSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<any[]>([]);
  const [results, setResults] = useState<ChatResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const userEmailRef = useRef<string | null>(null);

  // Load every thread once: with an empty query the screen lists them all.
  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const email = data?.session?.user?.email ?? null;
        userEmailRef.current = email;
        if (!email) return;

        const rows = await GetAllUserThreads(email);
        setThreads(rows ?? []);
      } catch (error) {
        console.error('[chat-search] failed to load chats', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const toResult = (thread: any, snippet?: string): ChatResult => ({
    id: thread.id,
    title: thread.title || 'Untitled chat',
    updatedAt: thread.updated_at ?? thread.created_at ?? null,
    snippet,
  });

  /** Title matches locally, message matches through Supabase. */
  const runSearch = useCallback(
    async (text: string) => {
      const q = text.trim();

      if (!q) {
        setResults(threads.map((thread) => toResult(thread)));
        setSearching(false);
        return;
      }

      const lower = q.toLowerCase();
      const titleMatches = threads.filter((thread) =>
        String(thread.title ?? '').toLowerCase().includes(lower),
      );
      const matched = new Map<string, ChatResult>(
        titleMatches.map((thread) => [thread.id, toResult(thread)]),
      );

      const email = userEmailRef.current;
      if (email) {
        try {
          const { data, error } = await supabase
            .from('chat_messages')
            .select('thread_id, content, created_at')
            .eq('user_email', email)
            .ilike('content', `%${escapeLike(q)}%`)
            .order('created_at', { ascending: false })
            .limit(100);

          if (error) throw error;

          for (const message of data ?? []) {
            if (matched.has(message.thread_id)) continue;
            const thread = threads.find((item) => item.id === message.thread_id);
            if (!thread) continue;
            matched.set(
              thread.id,
              toResult(thread, buildSnippet(String(message.content ?? ''), q)),
            );
          }
        } catch (error) {
          console.error('[chat-search] message search failed', error);
        }
      }

      // Keep the newest-first order of the thread list.
      setResults(
        threads
          .map((thread) => matched.get(thread.id))
          .filter(Boolean) as ChatResult[],
      );
      setSearching(false);
    },
    [threads],
  );

  // Debounce so typing does not fire a query per keystroke.
  useEffect(() => {
    if (loading) return;
    setSearching(!!query.trim());
    const timer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, loading, runSearch]);

  const openChat = (result: ChatResult) => {
    router.replace({
      pathname: '/(tabs)/chat',
      params: { thread_id: result.id },
    });
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chat' as any);
  };

  const hasQuery = !!query.trim();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Title block */}
        <View style={styles.titleBlock}>
          <View style={styles.titleIcon}>
            <HugeiconsIcon
              icon={Search01Icon}
              size={24}
              color={Colors.iconDark}
              strokeWidth={2}
            />
          </View>
          <Text style={styles.title}>Search your chats</Text>
          <Text style={styles.subtitle}>
            Matches chat titles and anything said inside them.
          </Text>
        </View>

        {/* Results */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionHeader}>
              {hasQuery ? 'Results' : 'All chats'}
            </Text>

            {results.length === 0 && !searching && (
              <Text style={styles.emptyText}>
                {hasQuery
                  ? `No chats match "${query.trim()}".`
                  : 'No chats yet.'}
              </Text>
            )}

            {results.map((result) => (
              <TouchableOpacity
                key={result.id}
                style={styles.resultRow}
                activeOpacity={0.7}
                onPress={() => openChat(result)}>
                <View style={styles.resultIcon}>
                  <HugeiconsIcon
                    icon={Comment01Icon}
                    size={19}
                    color={Colors.iconMuted}
                    strokeWidth={2}
                  />
                </View>

                <View style={styles.resultBody}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {result.title}
                  </Text>
                  {result.snippet ? (
                    <Text style={styles.resultSnippet} numberOfLines={1}>
                      {result.snippet}
                    </Text>
                  ) : null}
                  <Text style={styles.resultMeta}>
                    {formatRelativeTime(result.updatedAt)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Bottom search bar */}
        <View style={styles.searchBar}>
          <View style={styles.searchCapsule}>
            <HugeiconsIcon
              icon={Search01Icon}
              size={19}
              color={Colors.iconMuted}
              strokeWidth={2}
            />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={Colors.iconMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
            />
            {searching ? <ActivityIndicator size="small" color={Colors.iconMuted} /> : null}
          </View>

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={close}
            activeOpacity={0.8}
            accessibilityLabel="Close search">
            <HugeiconsIcon
              icon={Cancel01Icon}
              size={20}
              color={Colors.iconDark}
              strokeWidth={2.2}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 24,
    gap: 6,
  },
  titleIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
    marginBottom: 2,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: Colors.iconDark,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.iconMuted,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 12,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.iconMuted,
  },
  emptyText: {
    paddingHorizontal: 20,
    paddingTop: 6,
    fontSize: 14.5,
    lineHeight: 21,
    color: Colors.iconMuted,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  resultIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
    marginTop: 2,
  },
  resultBody: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.iconDark,
  },
  resultSnippet: {
    fontSize: 13.5,
    color: Colors.textSecondary,
  },
  resultMeta: {
    fontSize: 12.5,
    color: Colors.iconMuted,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 14,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.cardDivider,
  },
  searchCapsule: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.iconDark,
    paddingVertical: 0,
  },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceMuted,
  },
});
