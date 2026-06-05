import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { bootstrap } from './app-state';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }
  const url = bootstrap.supabase?.url?.trim() ?? '';
  const anonKey = bootstrap.supabase?.anonKey?.trim() ?? '';
  if (!url || !anonKey) {
    throw new Error('Supabase 登录配置缺失');
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function getSupabaseAccessToken(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    throw new Error(error.message || '读取 Supabase 登录状态失败');
  }
  return data.session?.access_token ?? '';
}

export async function signInWithSupabase(identity: string, password: string): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: identity,
    password,
  });
  if (error) {
    throw new Error(error.message || '登录失败');
  }
  const token = data.session?.access_token ?? '';
  if (!token) {
    throw new Error('Supabase 登录响应缺少访问令牌');
  }
  return token;
}

export async function signOutSupabase(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) {
    throw new Error(error.message || '退出登录失败');
  }
}
