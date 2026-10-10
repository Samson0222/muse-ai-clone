/**
 * Chat Tab Screen ('/(tabs)/chat')
 *
 * Minimalist, clean conversational companion UI:
 * - Scrollable message thread
 * - Floating prompt bar (+ attachment, input box, voice mic, send action)
 * - Simple on-click Toast triggers
 */

import React, { useState, useRef, useEffect } from "react";
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
  Modal,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  Add01Icon,
  Copy01Icon,
  Mic01Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import * as Clipboard from "expo-clipboard";
import { Colors } from "@/constants/colors";
import { INITIAL_CHAT_MESSAGES } from "@/constants/dummyData";
import { ChatMessage } from "@/types";
import { showToast } from "@/context/ToastContext";
import { getApiUrl } from "@/lib/services";
import axios from "axios";
import { supabase } from "@/lib/supabase";
import {
  CreateThreadForDraft,
  GetMainThread,
  SaveMessage,
  LoadMessages,
  UpdateThreadTitle,
} from "@/services/chatHistory";
import { generateChatTitle, deriveTitleFromMessage } from "@/services/chatTitle";
import { useLocalSearchParams } from "expo-router";
import { ChatBrowserPreview } from "@/components/common/ChatBrowserPreview";
import { MarkdownText } from "@/components/common/MarkdownText";
import {
  ChatConfirmCard,
  ChatConnectCta,
  ChatScheduleCard,
} from "@/components/common/ChatToolCards";
import {
  createConfirmedSchedule,
  executeConfirmedToolAction,
} from "@/lib/composioBackend";
import { runToolConnectionFlow } from "@/lib/connectToolFlow";
import type {
  ChatConfirmRequest,
  ChatConfirmState,
  ChatConnectSuggestionTool,
  ChatScheduleRequest,
} from "@/types";

/** Companion name shown in the composer placeholder. */
const AGENT_NAME = "Cooper";

/** Text of the placeholder bubble shown while the agent works. */
const WORKING_TEXT = "Working...";

/** The device timezone, so "8 AM" means 8 AM for this user. */
const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Messages the model should see: no placeholders, no empty bubbles. */
const toHistory = (list: ChatMessage[]) =>
  list.filter((msg) => msg.text?.trim() && msg.text !== WORKING_TEXT);

/** Names a new thread in the background; failures are silent by design. */
async function nameThread(
  threadId: string,
  userMessage: string,
  agentMessage: string,
) {
  try {
    const title = await generateChatTitle(userMessage, agentMessage);
    await UpdateThreadTitle(threadId, title);
  } catch (error) {
    console.error("Error naming chat thread:", error);
  }
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const [isSending, setIsSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  /** Thread created by this screen's own first send: its history is on screen. */
  const createdHereRef = useRef<string | null>(null);
  /** Latest messages for async callbacks that outlive a render (e.g. OAuth). */
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  /** Message the user long-pressed, shown in the action menu. */
  const [menuMessage, setMenuMessage] = useState<ChatMessage | null>(null);
  const { thread_id, chatType, fresh } = useLocalSearchParams<{
    thread_id?: string;
    /**
     * 'side' starts a new, empty side chat (the sidebar New chat button).
     * Anything else opens the main conversation.
     */
    chatType?: string;
    /** Changes on every New chat press so a new, empty chat opens. */
    fresh?: string;
  }>();

  // Calculate header height offset for iOS KeyboardAvoidingView (SafeAreaView top + AppHeader height)
  const headerOffset = Platform.OS === "ios" ? insets.top + 98 : 0;

  // Opening Chat without a thread_id shows an unsaved draft first (main chat by
  // default, a side chat after New chat). Nothing is written to Supabase until
  // the first message is sent.
  useEffect(() => {
    if (thread_id) {
      setThreadId(thread_id);
      return;
    }
    createdHereRef.current = null;
    setThreadId(null);
    setMessages([]);
  }, [thread_id, fresh]);

  // No thread id and not an explicit New chat: this is the main chat. Reuse the
  // main thread if it exists, otherwise stay a draft and create it on the first
  // message.
  useEffect(() => {
    if (thread_id || chatType === "side" || !userEmail) return;
    let cancelled = false;
    GetMainThread(userEmail)
      .then((main) => {
        if (!cancelled && main?.id && !createdHereRef.current) {
          setThreadId(main.id);
        }
      })
      .catch((error) => console.error("Error loading main chat:", error));
    return () => {
      cancelled = true;
    };
  }, [thread_id, chatType, fresh, userEmail]);

  useEffect(() => {
    const loadUser = async () => {
      const data = await supabase.auth.getSession();
      const userEmail = data.data?.session?.user?.email || "";
      setUserEmail(userEmail);
    };
    loadUser();
  }, []);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    if (!threadId || !userEmail) return;
    // Skip the reload for a thread this screen just created: the live
    // conversation (including the streaming reply) is already rendered.
    if (createdHereRef.current === threadId) return;
    GetChatHistory();
  }, [threadId, userEmail]);

  const GetChatHistory = async () => {
    const messages = await LoadMessages(threadId ?? "");
    const MappedMessages = messages?.map((msg: any) => ({
      id: msg.id,
      sender: msg.role === "user" ? "user" : "agent",
      text: msg.content,
      timestamp: new Date(msg.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    })) as ChatMessage[];
    setMessages(MappedMessages ?? []);
  };

  // Scroll to bottom when keyboard appears
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(showEvent, () => {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    return () => sub.remove();
  }, []);

  /**
   * Runs one agent turn.
   * - New message: the user bubble is added and persisted first.
   * - Resume (`resumeHistory`): the original request is sent again as-is,
   *   used after a Connect so the user never has to retype it.
   */
  const runTurn = async (text: string, resumeHistory?: ChatMessage[]) => {
    const isResume = !!resumeHistory;
    setIsSending(true);

    let requestMessages: ChatMessage[];
    if (resumeHistory) {
      requestMessages = resumeHistory;
    } else {
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        sender: "user",
        text,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      requestMessages = [...messagesRef.current, userMsg];
      setMessages((prev) => [...prev, userMsg]);
    }

    // A draft chat becomes a real thread only once a conversation happens.
    const draftType = chatType === "side" ? "side" : "main";
    let activeThreadId = threadId;
    const isNewThread = !activeThreadId && !isResume;
    if (isNewThread) {
      try {
        const created = await CreateThreadForDraft(
          userEmail ?? "",
          draftType === "main" ? "Main Chat" : deriveTitleFromMessage(text),
          draftType,
        );
        activeThreadId = created?.id ?? null;
        createdHereRef.current = activeThreadId;
        setThreadId(activeThreadId);
      } catch (error) {
        console.error("Error creating chat thread:", error);
      }
    }

    if (!isResume) {
      await SaveMessage(userEmail ?? "", activeThreadId ?? "", "user", text, {});
    }

    const agentMessageId = `msg-${Date.now() + 1}`;

    try {
      const ApiUrl = getApiUrl("/chat");

      // The agent needs the session to read this user's connected tools.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch(ApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          messages: toHistory(requestMessages),
          timezone: deviceTimezone(),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to connect to agent");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      // Add placeholder message immediately
      setMessages((prev) => [
        ...prev,
        {
          id: agentMessageId,
          sender: "agent",
          text: WORKING_TEXT,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, {
          stream: true,
        });

        const lines = buffer.split("\n");

        // Keep unfinished line
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const data = JSON.parse(line);

          // Browser created -> show preview immediately
          if (data.type === "browser") {
            patchMessage(agentMessageId, { browserPreview: data.browser });
          }

          // A required tool is not connected -> show the Connect CTA
          if (data.type === "connect") {
            patchMessage(agentMessageId, { connectSuggestion: data.connect });
          }

          // A write action is waiting for Confirm / Cancel
          if (data.type === "confirm") {
            patchMessage(agentMessageId, {
              confirmRequest: data.confirm,
              confirmState: "pending" as ChatConfirmState,
            });
          }

          // A recurring task is waiting for Confirm / Cancel
          if (data.type === "schedule") {
            patchMessage(agentMessageId, {
              scheduleRequest: data.schedule,
              scheduleState: "pending" as ChatConfirmState,
            });
          }

          // Final agent response
          if (data.type === "final") {
            // Stop the typing indicator now: the stream stays open a little
            // longer while browser sessions are torn down server side.
            setIsSending(false);

            const agentText =
              data.output || "No Response from AI agent, Try Again";
            patchMessage(agentMessageId, { text: agentText });

            await SaveMessage(
              userEmail ?? "",
              activeThreadId ?? "",
              "assistant",
              agentText,
              {},
            );

            // Name a brand-new side chat from its first exchange (the main
            // chat keeps its fixed name).
            // Detached on purpose: naming calls the model, and awaiting it
            // here would keep the "AI is typing..." indicator on screen.
            if (isNewThread && activeThreadId && draftType === "side") {
              nameThread(activeThreadId, text, agentText);
            }
          }

          if (data.type === "error") {
            throw new Error(data.message);
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      // Never leave a "Working..." bubble behind: it would also be sent to
      // the model as if the assistant had said it.
      patchMessage(agentMessageId, {
        text: "Something went wrong on my side. Please try again.",
      });
      showToast("Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text) return;

    setInputText("");
    await runTurn(text);
  };

  /** Appends an agent message and persists it to the thread. */
  const appendAgentMessage = async (text: string, metadata: any = {}) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sender: "agent",
        text,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    await SaveMessage(
      userEmail ?? "",
      threadId ?? "",
      "assistant",
      text,
      metadata,
    );
  };

  const patchMessage = (messageId: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, ...patch } : msg)),
    );
  };

  /**
   * Connect CTA: runs the same OAuth flow as Tools & Connections. Once every
   * tool on the card is connected, the original request is re-sent
   * automatically, so the user never has to retype it.
   */
  const handleConnectTool = async (
    messageId: string,
    tool: ChatConnectSuggestionTool,
  ) => {
    setConnectingSlug(tool.slug);
    try {
      const result = await runToolConnectionFlow(
        tool.slug,
        tool.name,
        "(tabs)/chat",
      );
      showToast(result.message);
      if (result.status !== "connected") return;

      const card = messagesRef.current.find((msg) => msg.id === messageId);
      const needed = card?.connectSuggestion?.tools.map((t) => t.slug) ?? [];
      const connected = Array.from(
        new Set([...(card?.connectedSlugs ?? []), tool.slug]),
      );
      patchMessage(messageId, { connectedSlugs: connected });

      // Wait for the other tools on this card, if any.
      if (needed.some((slug) => !connected.includes(slug))) return;

      // The request that triggered the card is the user message before it.
      const list = messagesRef.current;
      const cardIndex = list.findIndex((msg) => msg.id === messageId);
      let requestIndex = cardIndex - 1;
      while (requestIndex >= 0 && list[requestIndex].sender !== "user") {
        requestIndex -= 1;
      }
      if (requestIndex < 0) {
        showToast(`${tool.name} connected. Send your request again.`);
        return;
      }

      await runTurn(list[requestIndex].text, list.slice(0, requestIndex + 1));
    } catch (error: any) {
      showToast(error?.message ?? `Could not connect ${tool.name}`);
    } finally {
      setConnectingSlug(null);
    }
  };

  const handleCopyMessage = async (message: ChatMessage) => {
    setMenuMessage(null);
    try {
      await Clipboard.setStringAsync(message.text);
      showToast("Copied");
    } catch {
      showToast("Could not copy this message");
    }
  };

  /** Confirm card: executes the pending write action server side. */
  const handleConfirmAction = async (
    messageId: string,
    request: ChatConfirmRequest,
  ) => {
    patchMessage(messageId, { confirmState: "running" });
    try {
      const result = await executeConfirmedToolAction(
        request.capability,
        request.input,
      );
      patchMessage(messageId, {
        confirmState: result.status === "success" ? "confirmed" : "failed",
      });
      await appendAgentMessage(result.message, {
        tool_run: {
          capability: request.capability,
          action: result.action,
          status: result.status,
        },
      });
    } catch (error: any) {
      patchMessage(messageId, { confirmState: "failed" });
      const message = error?.message ?? "Tool execution failed";
      showToast(message);
      await appendAgentMessage(`I couldn't complete that: ${message}`, {
        tool_run: { capability: request.capability, status: "failed" },
      });
    }
  };

  const handleCancelAction = (messageId: string, request: ChatConfirmRequest) => {
    patchMessage(messageId, { confirmState: "cancelled" });
    showToast(`Cancelled — ${request.toolName} was not used`);
  };

  /**
   * Schedule card: only now is the task saved to Supabase, where the cron
   * dispatcher (`agent-run`) picks it up once `next_run_at` is due.
   */
  const handleConfirmSchedule = async (
    messageId: string,
    request: ChatScheduleRequest,
  ) => {
    patchMessage(messageId, { scheduleState: "running" });
    try {
      const created = await createConfirmedSchedule(request, threadId);
      patchMessage(messageId, { scheduleState: "confirmed" });
      const where =
        created.delivery === "slack" && request.slackChannel
          ? `in Slack ${request.slackChannel}`
          : "here in this chat";
      await appendAgentMessage(
        `Scheduled: **${request.title}**. ${created.scheduleSummary} (${request.timezone}). The first run is ${created.nextRunLabel}, and I'll post the result ${where}.`,
        { schedule: { id: created.id, status: "created" } },
      );
    } catch (error: any) {
      patchMessage(messageId, { scheduleState: "failed" });
      const message = error?.message ?? "Could not save the schedule";
      showToast(message);
      await appendAgentMessage(`I couldn't schedule that: ${message}`, {
        schedule: { status: "failed" },
      });
    }
  };

  const handleCancelSchedule = (messageId: string) => {
    patchMessage(messageId, { scheduleState: "cancelled" });
    showToast("Cancelled — nothing was scheduled");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerOffset}
    >
      <View style={styles.content}>
        {/* Scrollable Messages Thread */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableWithoutFeedback
            onPress={Keyboard.dismiss}
            accessible={false}
          >
            <View style={styles.scrollInner}>
              {/* Centered Date Badge */}
              <View style={styles.dateBadgeContainer}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeText}>Today</Text>
                </View>
              </View>

              {/* Messages */}
              {messages.map((msg) => {
                const isUser = msg.sender === "user";
                return (
                  <TouchableOpacity
                    key={msg.id}
                    activeOpacity={0.9}
                    delayLongPress={300}
                    onPress={Keyboard.dismiss}
                    onLongPress={() => setMenuMessage(msg)}
                    style={[
                      styles.messageRow,
                      isUser ? styles.userMessageRow : styles.agentMessageRow,
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        isUser ? styles.userBubble : styles.agentBubble,
                      ]}
                    >
                      <MarkdownText
                        content={msg.text}
                        color={
                          isUser ? Colors.chatBubbleUserText : Colors.iconDark
                        }
                        linkColor={
                          isUser ? Colors.chatBubbleUserLink : Colors.primary
                        }
                        codeBackground={
                          isUser ? Colors.chatBubbleUserCodeBg : undefined
                        }
                        ruleColor={
                          isUser ? Colors.chatBubbleUserRule : undefined
                        }
                        textStyle={
                          isUser
                            ? styles.userBubbleText
                            : styles.agentBubbleText
                        }
                      />
                      {!isUser && msg.browserPreview ? (
                        <ChatBrowserPreview
                          browserPreview={msg.browserPreview}
                        />
                      ) : null}
                      {!isUser && msg.connectSuggestion ? (
                        <ChatConnectCta
                          suggestion={msg.connectSuggestion}
                          busySlug={connectingSlug}
                          connectedSlugs={msg.connectedSlugs}
                          onConnect={(tool) =>
                            handleConnectTool(msg.id, tool)
                          }
                        />
                      ) : null}
                      {!isUser && msg.confirmRequest ? (
                        <ChatConfirmCard
                          request={msg.confirmRequest}
                          state={msg.confirmState ?? "pending"}
                          onConfirm={(request) =>
                            handleConfirmAction(msg.id, request)
                          }
                          onCancel={(request) =>
                            handleCancelAction(msg.id, request)
                          }
                        />
                      ) : null}
                      {!isUser && msg.scheduleRequest ? (
                        <ChatScheduleCard
                          request={msg.scheduleRequest}
                          state={msg.scheduleState ?? "pending"}
                          onConfirm={(request) =>
                            handleConfirmSchedule(msg.id, request)
                          }
                          onCancel={() => handleCancelSchedule(msg.id)}
                        />
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {isSending && (
                <Text
                  style={{
                    fontStyle: "italic",
                    color: Colors.iconMuted,
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  <ActivityIndicator /> AI is typing...
                </Text>
              )}
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>

        {/* Floating Input Pill */}
        <View style={styles.inputWrapper}>
          <View style={styles.inputBar}>
            {/* Plus Attach Button */}
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={() => showToast("Attach file")}
              activeOpacity={0.7}
            >
              <HugeiconsIcon
                icon={Add01Icon}
                size={20}
                color={Colors.iconDark}
                strokeWidth={2.2}
              />
            </TouchableOpacity>

            {/* Prompt Text Input */}
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              onFocus={() => {
                setTimeout(() => {
                  scrollViewRef.current?.scrollToEnd({ animated: true });
                }, 100);
              }}
              placeholder={`Message ${AGENT_NAME}`}
              placeholderTextColor={Colors.iconMuted}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />

            {/* Right Action: Voice or Send */}
            {inputText.trim().length > 0 ? (
              <TouchableOpacity
                style={[styles.circleBtn, styles.sendBtn]}
                onPress={handleSend}
                activeOpacity={0.8}
              >
                <HugeiconsIcon
                  icon={SentIcon}
                  size={18}
                  color={Colors.white}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={() => showToast("Voice input")}
                activeOpacity={0.7}
              >
                <HugeiconsIcon
                  icon={Mic01Icon}
                  size={20}
                  color={Colors.iconDark}
                  strokeWidth={2}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Long-press message menu */}
      <Modal
        visible={!!menuMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuMessage(null)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setMenuMessage(null)}
        >
          <View style={styles.menuCard}>
            {menuMessage?.timestamp ? (
              <Text style={styles.menuTimestamp}>{menuMessage.timestamp}</Text>
            ) : null}
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={() => menuMessage && handleCopyMessage(menuMessage)}
            >
              <HugeiconsIcon
                icon={Copy01Icon}
                size={20}
                color={Colors.iconDark}
                strokeWidth={2}
              />
              <Text style={styles.menuItemText}>Copy</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    flexGrow: 1,
  },
  scrollInner: {
    flexGrow: 1,
  },
  dateBadgeContainer: {
    alignItems: "center",
    marginVertical: 14,
  },
  dateBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  dateBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
  },
  messageRow: {
    marginBottom: 12,
    width: "100%",
    flexDirection: "row",
  },
  userMessageRow: {
    justifyContent: "flex-end",
  },
  agentMessageRow: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: Colors.chatBubbleUser,
    borderBottomRightRadius: 6,
  },
  agentBubble: {
    backgroundColor: Colors.chatBubbleAi,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15.5,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  userBubbleText: {
    color: Colors.chatBubbleUserText,
    fontWeight: "500",
  },
  agentBubbleText: {
    color: Colors.iconDark,
    fontWeight: "400",
  },
  menuBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.overlaySoft,
    paddingHorizontal: 32,
  },
  menuCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 20,
    backgroundColor: Colors.white,
    paddingVertical: 8,
    overflow: "hidden",
  },
  menuTimestamp: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
    fontSize: 12.5,
    fontWeight: "600",
    color: Colors.iconMuted,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.iconDark,
  },
  inputWrapper: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 12 : 10,
    paddingTop: 6,
    backgroundColor: Colors.white,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#ECEEF0",
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    backgroundColor: Colors.iconDark,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.iconDark,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "ios" ? 8 : 4,
  },
});
