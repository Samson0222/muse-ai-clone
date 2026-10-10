/**
 * Chat title naming.
 *
 * A thread is named once, right after its first exchange: the model proposes a
 * short, precise title and a local heuristic covers the offline / failure case.
 * Users can always rename a thread afterwards from the sidebar.
 */
import { getApiUrl } from '@/lib/services';

const MAX_TITLE_LENGTH = 48;
const MAX_WORDS = 6;

/** First few words of the user's message, cleaned up into a title. */
export function deriveTitleFromMessage(text: string): string {
  const clean = (text ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return 'New chat';

  const words = clean.split(' ').slice(0, MAX_WORDS).join(' ');
  const trimmed = words.replace(/[.,;:!?]+$/, '');
  const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

/**
 * Asks the backend for a short title for the first exchange.
 * Never throws: falls back to the local heuristic.
 */
export async function generateChatTitle(
  userMessage: string,
  agentMessage: string,
): Promise<string> {
  try {
    const response = await fetch(getApiUrl('chat-title'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage, agentMessage }),
    });

    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
      if (title) return title;
    }
  } catch {
    // Offline or dev server restarting: fall through to the local title.
  }

  return deriveTitleFromMessage(userMessage);
}
