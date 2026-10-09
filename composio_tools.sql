-- Composio Tools Connection Schema Migration for Supabase

-- 1. Helper function for handling updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create tools table
CREATE TABLE IF NOT EXISTS public.tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    toolkit_slug TEXT NOT NULL,
    description TEXT,
    category TEXT,
    logo_url TEXT,
    logo_key TEXT,
    actions JSONB DEFAULT '[]'::jsonb,
    composio_auth_config_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create user_tool_connections table
CREATE TABLE IF NOT EXISTS public.user_tool_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'pending', 'connected', 'failed', 'revoked')),
    composio_connected_account_id TEXT,
    composio_connection_request_id TEXT,
    connected_label TEXT,
    connected_email TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    last_checked_at TIMESTAMPTZ,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_tool_connections_user_tool_unique UNIQUE (user_id, tool_id)
);

-- 4. Create agent_tool_runs table
CREATE TABLE IF NOT EXISTS public.agent_tool_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tool_id UUID REFERENCES public.tools(id) ON DELETE SET NULL,
    action_name TEXT NOT NULL,
    input_summary TEXT,
    output_summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Set up updated_at triggers
DROP TRIGGER IF EXISTS set_tools_updated_at ON public.tools;
CREATE TRIGGER set_tools_updated_at
BEFORE UPDATE ON public.tools
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_user_tool_connections_updated_at ON public.user_tool_connections;
CREATE TRIGGER set_user_tool_connections_updated_at
BEFORE UPDATE ON public.user_tool_connections
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_tools_slug ON public.tools (slug);
CREATE INDEX IF NOT EXISTS idx_tools_is_active ON public.tools (is_active);
CREATE INDEX IF NOT EXISTS idx_tools_sort_order ON public.tools (sort_order);

CREATE INDEX IF NOT EXISTS idx_user_tool_connections_user_id ON public.user_tool_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_user_tool_connections_tool_id ON public.user_tool_connections (tool_id);
CREATE INDEX IF NOT EXISTS idx_user_tool_connections_status ON public.user_tool_connections (status);

CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_user_id ON public.agent_tool_runs (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_tool_id ON public.agent_tool_runs (tool_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_created_at ON public.agent_tool_runs (created_at DESC);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tool_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_runs ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies for tools
DROP POLICY IF EXISTS "Allow authenticated users to select active tools" ON public.tools;
CREATE POLICY "Allow authenticated users to select active tools"
ON public.tools
FOR SELECT
TO authenticated, anon
USING (is_active = true);

-- 9. RLS Policies for user_tool_connections
DROP POLICY IF EXISTS "Users can select their own tool connections" ON public.user_tool_connections;
CREATE POLICY "Users can select their own tool connections"
ON public.user_tool_connections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tool connections" ON public.user_tool_connections;
CREATE POLICY "Users can insert their own tool connections"
ON public.user_tool_connections
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tool connections" ON public.user_tool_connections;
CREATE POLICY "Users can update their own tool connections"
ON public.user_tool_connections
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tool connections" ON public.user_tool_connections;
CREATE POLICY "Users can delete their own tool connections"
ON public.user_tool_connections
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 10. RLS Policies for agent_tool_runs
DROP POLICY IF EXISTS "Users can select their own agent tool runs" ON public.agent_tool_runs;
CREATE POLICY "Users can select their own agent tool runs"
ON public.agent_tool_runs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own agent tool runs" ON public.agent_tool_runs;
CREATE POLICY "Users can insert their own agent tool runs"
ON public.agent_tool_runs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 11. Seed Initial Tools Data (Gmail, Slack, Google Calendar, Notion, Instagram, Reddit, GitHub, Twitter, Trello, Jira)
INSERT INTO public.tools (
    name,
    slug,
    toolkit_slug,
    description,
    category,
    logo_url,
    logo_key,
    actions,
    composio_auth_config_id,
    is_active,
    sort_order
) VALUES
(
    'Gmail',
    'gmail',
    'gmail',
    'Send and receive emails, manage drafts, and search messages via Gmail.',
    'Email & Communication',
    'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg',
    'gmail',
    '[{"name": "GMAIL_SEND_EMAIL", "description": "Send an email message"}, {"name": "GMAIL_LIST_MAILS", "description": "List and search emails"}, {"name": "GMAIL_CREATE_DRAFT", "description": "Create an email draft"}]'::jsonb,
    'ac_gmail_placeholder_001',
    true,
    1
),
(
    'Slack',
    'slack',
    'slack',
    'Send messages, read channels, and manage Slack workspace activity.',
    'Team Collaboration',
    'https://upload.wikimedia.org/wikipedia/commons/d/d5/Slack_icon_2019.svg',
    'slack',
    '[{"name": "SLACK_POST_MESSAGE", "description": "Post a message to a channel"}, {"name": "SLACK_LIST_CHANNELS", "description": "List channels in workspace"}, {"name": "SLACK_READ_MESSAGES", "description": "Fetch channel history"}]'::jsonb,
    'ac_slack_placeholder_002',
    true,
    2
),
(
    'Google Calendar',
    'googlecalendar',
    'googlecalendar',
    'Schedule events, check availability, and manage calendar entries.',
    'Productivity & Scheduling',
    'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg',
    'googlecalendar',
    '[{"name": "GOOGLECALENDAR_CREATE_EVENT", "description": "Create a new event"}, {"name": "GOOGLECALENDAR_LIST_EVENTS", "description": "List upcoming calendar events"}, {"name": "GOOGLECALENDAR_DELETE_EVENT", "description": "Cancel or delete an event"}]'::jsonb,
    'ac_gcal_placeholder_003',
    true,
    3
),
(
    'Notion',
    'notion',
    'notion',
    'Create pages, manage databases, search docs, and organize workspaces in Notion.',
    'Productivity & Workspace',
    'https://upload.wikimedia.org/wikipedia/commons/e/e9/Notion-logo.svg',
    'notion',
    '[{"name": "NOTION_CREATE_PAGE", "description": "Create a new Notion page"}, {"name": "NOTION_SEARCH", "description": "Search Notion workspace"}, {"name": "NOTION_QUERY_DATABASE", "description": "Query items in a Notion database"}]'::jsonb,
    'ac_notion_placeholder_004',
    true,
    4
),
(
    'Instagram',
    'instagram',
    'instagram',
    'Publish posts, fetch profile insights, manage comments, and analyze engagement.',
    'Social Media & Marketing',
    'https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg',
    'instagram',
    '[{"name": "INSTAGRAM_POST_PHOTO", "description": "Publish a photo or media post"}, {"name": "INSTAGRAM_GET_USER_PROFILE", "description": "Get profile details and follower metrics"}, {"name": "INSTAGRAM_LIST_COMMENTS", "description": "List comments on media"}]'::jsonb,
    'ac_instagram_placeholder_005',
    true,
    5
),
(
    'Reddit',
    'reddit',
    'reddit',
    'Post content, read subreddit threads, search posts, and track community discussions.',
    'Social Media & Content',
    'https://upload.wikimedia.org/wikipedia/commons/0/07/Reddit_icon.svg',
    'reddit',
    '[{"name": "REDDIT_SUBMIT_POST", "description": "Submit a post to a subreddit"}, {"name": "REDDIT_GET_HOT_POSTS", "description": "Get hot posts from a subreddit"}, {"name": "REDDIT_SEARCH", "description": "Search posts across subreddits"}]'::jsonb,
    'ac_reddit_placeholder_006',
    true,
    6
),
(
    'GitHub',
    'github',
    'github',
    'Manage repositories, open pull requests, create issues, and automate dev workflows.',
    'Developer Tools',
    'https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg',
    'github',
    '[{"name": "GITHUB_CREATE_ISSUE", "description": "Create a new repository issue"}, {"name": "GITHUB_LIST_REPOS", "description": "List user repositories"}, {"name": "GITHUB_CREATE_PULL_REQUEST", "description": "Open a pull request"}]'::jsonb,
    'ac_github_placeholder_007',
    true,
    7
),
(
    'X (Twitter)',
    'twitter',
    'twitter',
    'Post tweets, search posts, monitor mentions, and engage with followers.',
    'Social Media & Marketing',
    'https://upload.wikimedia.org/wikipedia/commons/c/ce/X_logo_2023.svg',
    'twitter',
    '[{"name": "TWITTER_CREATETWEET", "description": "Post a new tweet/post"}, {"name": "TWITTER_SEARCH_RECENT", "description": "Search recent tweets"}, {"name": "TWITTER_GET_USER_TIMELINE", "description": "Fetch user timeline posts"}]'::jsonb,
    'ac_twitter_placeholder_008',
    true,
    8
),
(
    'Trello',
    'trello',
    'trello',
    'Create boards, manage cards, track progress lists, and automate task boards.',
    'Project & Task Management',
    'https://upload.wikimedia.org/wikipedia/commons/7/7a/Trello-logo-blue.svg',
    'trello',
    '[{"name": "TRELLO_CREATE_CARD", "description": "Create a card on a list"}, {"name": "TRELLO_GET_BOARDS", "description": "Get user Trello boards"}, {"name": "TRELLO_MOVE_CARD", "description": "Move card to another list"}]'::jsonb,
    'ac_trello_placeholder_009',
    true,
    9
),
(
    'Jira',
    'jira',
    'jira',
    'Track issues, manage sprints, create Jira tickets, and update project status.',
    'Project & Task Management',
    'https://upload.wikimedia.org/wikipedia/commons/8/8a/Jira_Logo.svg',
    'jira',
    '[{"name": "JIRA_CREATE_ISSUE", "description": "Create a new Jira ticket"}, {"name": "JIRA_SEARCH_ISSUES", "description": "Search Jira issues using JQL"}, {"name": "JIRA_UPDATE_ISSUE", "description": "Update status or details of an issue"}]'::jsonb,
    'ac_jira_placeholder_010',
    true,
    10
)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    toolkit_slug = EXCLUDED.toolkit_slug,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    logo_url = EXCLUDED.logo_url,
    logo_key = EXCLUDED.logo_key,
    actions = EXCLUDED.actions,
    composio_auth_config_id = EXCLUDED.composio_auth_config_id,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();
