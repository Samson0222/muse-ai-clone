/**
 * Muse AI Clone - Tools Data Layer & Service
 *
 * Provides API access to fetch autonomous agent tools and connectors from Supabase,
 * complete with user connection statuses and fallback mock data when Supabase
 * is unconfigured or offline.
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  Tool,
  ToolAction,
  ToolConnectionStatus,
  ToolWithConnection,
  UserToolConnection,
} from '@/types';

/**
 * Curated fallback mock tools used when Supabase is unconfigured or unavailable.
 * Modeled after the official Composio seed tools catalog.
 */
export const MOCK_TOOLS: Tool[] = [
  {
    id: 'mock-gmail-001',
    name: 'Gmail',
    slug: 'gmail',
    toolkit_slug: 'gmail',
    description: 'Send and receive emails, manage drafts, and search messages via Gmail.',
    category: 'Email & Communication',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg',
    logo_key: 'gmail',
    actions: [
      { name: 'GMAIL_SEND_EMAIL', description: 'Send an email message' },
      { name: 'GMAIL_LIST_MAILS', description: 'List and search emails' },
      { name: 'GMAIL_CREATE_DRAFT', description: 'Create an email draft' },
    ],
    composio_auth_config_id: 'ac_gmail_placeholder_001',
    is_active: true,
    sort_order: 1,
  },
  {
    id: 'mock-slack-002',
    name: 'Slack',
    slug: 'slack',
    toolkit_slug: 'slack',
    description: 'Send messages, read channels, and manage Slack workspace activity.',
    category: 'Team Collaboration',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Slack_icon_2019.svg',
    logo_key: 'slack',
    actions: [
      { name: 'SLACK_POST_MESSAGE', description: 'Post a message to a channel' },
      { name: 'SLACK_LIST_CHANNELS', description: 'List channels in workspace' },
      { name: 'SLACK_READ_MESSAGES', description: 'Fetch channel history' },
    ],
    composio_auth_config_id: 'ac_slack_placeholder_002',
    is_active: true,
    sort_order: 2,
  },
  {
    id: 'mock-gcal-003',
    name: 'Google Calendar',
    slug: 'googlecalendar',
    toolkit_slug: 'googlecalendar',
    description: 'Schedule events, check availability, and manage calendar entries.',
    category: 'Productivity & Scheduling',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg',
    logo_key: 'googlecalendar',
    actions: [
      { name: 'GOOGLECALENDAR_CREATE_EVENT', description: 'Create a new event' },
      { name: 'GOOGLECALENDAR_LIST_EVENTS', description: 'List upcoming calendar events' },
      { name: 'GOOGLECALENDAR_DELETE_EVENT', description: 'Cancel or delete an event' },
    ],
    composio_auth_config_id: 'ac_gcal_placeholder_003',
    is_active: true,
    sort_order: 3,
  },
  {
    id: 'mock-notion-004',
    name: 'Notion',
    slug: 'notion',
    toolkit_slug: 'notion',
    description: 'Create pages, manage databases, search docs, and organize workspaces in Notion.',
    category: 'Productivity & Workspace',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/e/e9/Notion-logo.svg',
    logo_key: 'notion',
    actions: [
      { name: 'NOTION_CREATE_PAGE', description: 'Create a new Notion page' },
      { name: 'NOTION_SEARCH', description: 'Search Notion workspace' },
      { name: 'NOTION_QUERY_DATABASE', description: 'Query items in a Notion database' },
    ],
    composio_auth_config_id: 'ac_notion_placeholder_004',
    is_active: true,
    sort_order: 4,
  },
  {
    id: 'mock-instagram-005',
    name: 'Instagram',
    slug: 'instagram',
    toolkit_slug: 'instagram',
    description: 'Publish posts, fetch profile insights, manage comments, and analyze engagement.',
    category: 'Social Media & Marketing',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg',
    logo_key: 'instagram',
    actions: [
      { name: 'INSTAGRAM_POST_PHOTO', description: 'Publish a photo or media post' },
      { name: 'INSTAGRAM_GET_USER_PROFILE', description: 'Get profile details and follower metrics' },
      { name: 'INSTAGRAM_LIST_COMMENTS', description: 'List comments on media' },
    ],
    composio_auth_config_id: 'ac_instagram_placeholder_005',
    is_active: true,
    sort_order: 5,
  },
  {
    id: 'mock-reddit-006',
    name: 'Reddit',
    slug: 'reddit',
    toolkit_slug: 'reddit',
    description: 'Post content, read subreddit threads, search posts, and track community discussions.',
    category: 'Social Media & Content',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/0/07/Reddit_icon.svg',
    logo_key: 'reddit',
    actions: [
      { name: 'REDDIT_SUBMIT_POST', description: 'Submit a post to a subreddit' },
      { name: 'REDDIT_GET_HOT_POSTS', description: 'Get hot posts from a subreddit' },
      { name: 'REDDIT_SEARCH', description: 'Search posts across subreddits' },
    ],
    composio_auth_config_id: 'ac_reddit_placeholder_006',
    is_active: true,
    sort_order: 6,
  },
  {
    id: 'mock-github-007',
    name: 'GitHub',
    slug: 'github',
    toolkit_slug: 'github',
    description: 'Manage repositories, open pull requests, create issues, and automate dev workflows.',
    category: 'Developer Tools',
    logo_url: 'https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg',
    logo_key: 'github',
    actions: [
      { name: 'GITHUB_CREATE_ISSUE', description: 'Create a new repository issue' },
      { name: 'GITHUB_LIST_REPOS', description: 'List user repositories' },
      { name: 'GITHUB_CREATE_PULL_REQUEST', description: 'Open a pull request' },
    ],
    composio_auth_config_id: 'ac_github_placeholder_007',
    is_active: true,
    sort_order: 7,
  },
];

/**
 * Safely normalizes actions stored as JSONB in Supabase into a typed ToolAction array.
 */
function normalizeActions(rawActions: any): ToolAction[] {
  if (Array.isArray(rawActions)) {
    return rawActions.map((item) => ({
      name: String(item?.name || ''),
      description: item?.description ? String(item.description) : undefined,
      parameters: item?.parameters || undefined,
    }));
  }

  if (typeof rawActions === 'string') {
    try {
      const parsed = JSON.parse(rawActions);
      if (Array.isArray(parsed)) {
        return normalizeActions(parsed);
      }
    } catch {
      // Ignore JSON parse errors and return empty
    }
  }

  return [];
}

/**
 * Maps a raw Supabase database row to the strongly-typed Tool interface.
 */
function mapRowToTool(row: any): Tool {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    toolkit_slug: String(row.toolkit_slug || row.slug || ''),
    description: String(row.description || ''),
    category: String(row.category || 'Other'),
    logo_url: row.logo_url ? String(row.logo_url) : null,
    logo_key: row.logo_key ? String(row.logo_key) : null,
    actions: normalizeActions(row.actions),
    composio_auth_config_id: row.composio_auth_config_id || null,
    is_active: row.is_active !== undefined ? Boolean(row.is_active) : true,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

/**
 * Maps a raw Supabase database row to the UserToolConnection interface.
 */
function mapRowToConnection(row: any): UserToolConnection {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    tool_id: String(row.tool_id),
    status: (row.status || 'not_connected') as ToolConnectionStatus,
    composio_connected_account_id: row.composio_connected_account_id || null,
    composio_connection_request_id: row.composio_connection_request_id || null,
    connected_label: row.connected_label || null,
    connected_email: row.connected_email || null,
    metadata: row.metadata || {},
    last_checked_at: row.last_checked_at || null,
    connected_at: row.connected_at || null,
    created_at: row.created_at || undefined,
    updated_at: row.updated_at || undefined,
  };
}

/**
 * Resolves the authenticated user ID from Supabase auth session.
 * Returns null if not logged in or if Supabase is unconfigured.
 */
async function resolveCurrentUserId(explicitUserId?: string): Promise<string | null> {
  if (explicitUserId) return explicitUserId;
  if (!isSupabaseConfigured) return null;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;

    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Generates fallback ToolWithConnection models from the mock catalog.
 */
export function getMockToolsWithConnections(): ToolWithConnection[] {
  return MOCK_TOOLS.map((tool) => ({
    id: tool.id,
    tool_id: tool.id,
    name: tool.name,
    slug: tool.slug,
    toolkit_slug: tool.toolkit_slug,
    description: tool.description,
    category: tool.category,
    logo_url: tool.logo_url,
    logo_key: tool.logo_key,
    actions: tool.actions,
    status: 'not_connected',
    connected_label: null,
    connected_email: null,
    composio_auth_config_id: tool.composio_auth_config_id,
    connection_id: null,
  }));
}

/**
 * 1. Fetches all active tools from Supabase `tools` table.
 * Falls back to MOCK_TOOLS if Supabase is unconfigured or a network error occurs.
 */
export async function fetchTools(): Promise<Tool[]> {
  if (!isSupabaseConfigured) {
    console.warn('[toolsService] Supabase is not configured. Falling back to mock tools.');
    return MOCK_TOOLS;
  }

  try {
    const { data, error } = await supabase
      .from('tools')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.warn('[toolsService] Error querying tools from Supabase:', error.message);
      return MOCK_TOOLS;
    }

    if (!data || data.length === 0) {
      console.warn('[toolsService] No tools returned from Supabase tools table. Using fallback tools.');
      return MOCK_TOOLS;
    }

    return data.map(mapRowToTool);
  } catch (err: any) {
    console.warn('[toolsService] Unexpected exception in fetchTools:', err?.message || err);
    return MOCK_TOOLS;
  }
}

/**
 * Fetches user tool connection records from `user_tool_connections` table.
 * If userId is omitted, uses the current authenticated session.
 */
export async function fetchUserToolConnections(userId?: string): Promise<UserToolConnection[]> {
  if (!isSupabaseConfigured) {
    return [];
  }

  const currentUserId = await resolveCurrentUserId(userId);
  if (!currentUserId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('user_tool_connections')
      .select('*')
      .eq('user_id', currentUserId);

    if (error) {
      console.warn('[toolsService] Error querying user_tool_connections:', error.message);
      return [];
    }

    return (data || []).map(mapRowToConnection);
  } catch (err: any) {
    console.warn('[toolsService] Unexpected exception in fetchUserToolConnections:', err?.message || err);
    return [];
  }
}

/**
 * 2. Fetches tools combined with the current user's connection status.
 *
 * Returned structure includes:
 * - tool id
 * - name
 * - slug
 * - toolkit_slug
 * - description
 * - category
 * - logo_url
 * - logo_key
 * - actions
 * - status
 * - connected_label
 * - connected_email
 *
 * @param userId Optional user UUID. If not provided, resolves from current Supabase auth session.
 * @returns Array of ToolWithConnection objects.
 */
export async function fetchToolsWithConnectionStatus(userId?: string): Promise<ToolWithConnection[]> {
  if (!isSupabaseConfigured) {
    console.warn('[toolsService] Supabase is unconfigured. Returning fallback mock tools with connection status.');
    return getMockToolsWithConnections();
  }

  try {
    const [tools, connections] = await Promise.all([
      fetchTools(),
      fetchUserToolConnections(userId),
    ]);

    // Build lookup map by tool_id for O(1) matching
    const connectionMap = new Map<string, UserToolConnection>();
    for (const conn of connections) {
      connectionMap.set(conn.tool_id, conn);
    }

    return tools.map((tool): ToolWithConnection => {
      const conn = connectionMap.get(tool.id);

      return {
        id: tool.id,
        tool_id: tool.id,
        name: tool.name,
        slug: tool.slug,
        toolkit_slug: tool.toolkit_slug,
        description: tool.description,
        category: tool.category,
        logo_url: tool.logo_url,
        logo_key: tool.logo_key,
        actions: tool.actions,
        status: conn?.status || 'not_connected',
        connected_label: conn?.connected_label || null,
        connected_email: conn?.connected_email || null,
        composio_auth_config_id: tool.composio_auth_config_id || null,
        connection_id: conn?.id || null,
      };
    });
  } catch (err: any) {
    console.warn('[toolsService] Failed to fetch tools with connection status:', err?.message || err);
    return getMockToolsWithConnections();
  }
}

/**
 * Helper to fetch a single tool by its unique slug.
 */
export async function fetchToolBySlug(slug: string): Promise<Tool | null> {
  const tools = await fetchTools();
  return tools.find((t) => t.slug.toLowerCase() === slug.toLowerCase()) || null;
}

/**
 * Helper to fetch a single tool with its connection status by slug.
 */
export async function fetchToolWithConnectionBySlug(
  slug: string,
  userId?: string
): Promise<ToolWithConnection | null> {
  const tools = await fetchToolsWithConnectionStatus(userId);
  return tools.find((t) => t.slug.toLowerCase() === slug.toLowerCase()) || null;
}
