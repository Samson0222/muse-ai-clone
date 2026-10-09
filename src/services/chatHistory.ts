import { supabase } from "@/lib/supabase";

export type ChatThreadType = 'main' | 'side';
export type ChatMessageRole = 'user' | 'assistant';

export const CreateNewThread = async (userEmail: string, type: ChatThreadType, title?: string) => {
  const { data, error } = await supabase
    .from('chat_threads')
    .insert({
      user_email: userEmail,
      type,
      title: title || 'New Conversation',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};


export const GetThread = async (threadId: string, userEmail?: string) => {
    if (!threadId) {
        let { data, error } = await supabase
        .from('chat_threads')
        .select('*')
        .eq('type', "main")
        .eq('user_email', userEmail)
        .maybeSingle();

        if (error) throw error;
        return data;
    };

    let { data, error } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('id', threadId)
      .maybeSingle();

    if (error) throw error;
    return data;
}

export const GetLatestThread =async (userEmail: string) => {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const LoadMessages = async (threadId: string) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
};

export const SaveMessage = async (
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

export const GetAllUserThreads = async (userEmail: string) => {
  const { data, error } = await supabase
    .from('chat_threads')
    .select('*')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

export const DeleteThread = async (threadId: string) => {
  // Delete all messages associated with the thread
  await supabase
    .from('chat_messages')
    .delete()
    .eq('thread_id', threadId);
  // Delete the thread itself
  const { data, error } = await supabase
    .from('chat_threads')
    .delete()
    .eq('id', threadId);

  if (error) throw error;
  return data;
};

// Case compatibility aliases matching tutorial video variations
export const saveMessage = SaveMessage;
export const getThread = GetThread;
export const getLatestThread = GetLatestThread;
export const loadMessages = LoadMessages;
export const createNewThread = CreateNewThread;
export const getAllUserThreads = GetAllUserThreads;
export const deleteThread = DeleteThread;

