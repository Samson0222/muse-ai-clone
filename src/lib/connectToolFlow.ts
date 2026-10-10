/**
 * Shared Composio connect flow (client side).
 *
 * One implementation used by both the Tools & Connections screen and the
 * Connect CTA the agent shows in chat, so a connection started from either
 * place behaves identically: open OAuth, then confirm the real state with the
 * backend and clean up an abandoned attempt.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import {
  checkToolConnection,
  disconnectTool,
  startToolConnection,
  type ToolConnectionState,
} from '@/lib/composioBackend';

export interface ToolConnectionFlowResult {
  status: ToolConnectionState['status'] | 'cancelled';
  /** Toast-ready sentence describing the outcome. */
  message: string;
}

/**
 * Runs the full OAuth round trip for one tool.
 *
 * @param slug      tools.slug (the backend routes also accept the UUID)
 * @param name      display name used in the returned message
 * @param returnPath in-app path Composio redirects back to (deep link)
 */
export async function runToolConnectionFlow(
  slug: string,
  name: string,
  returnPath = 'tools-connections',
): Promise<ToolConnectionFlowResult> {
  const redirect = Linking.createURL(returnPath);
  const { connectUrl } = await startToolConnection(slug, redirect);
  const result = await WebBrowser.openAuthSessionAsync(connectUrl, redirect);

  // Browser closed: confirm the real state before deciding anything.
  const state = await checkToolConnection(slug);

  if (state.status === 'pending' && result.type !== 'success') {
    // User backed out: end the attempt so it doesn't linger as "Pending".
    await disconnectTool(slug);
    return { status: 'cancelled', message: 'Connection cancelled' };
  }

  if (state.status === 'connected') {
    return { status: 'connected', message: `${name} connected` };
  }

  return { status: state.status, message: `${name} connection ${state.status}` };
}
