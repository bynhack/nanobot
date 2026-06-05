import { useState } from 'react';

export function LoginPage({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (identity: string, password: string) => Promise<void> | void;
}) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="auth-modal">
      <div className="auth-card">
        <h2>登录</h2>
        <p>请输入 Supabase Auth 账号。</p>
        <input
          type="email"
          placeholder="邮箱"
          value={identity}
          autoComplete="username"
          onChange={(event) => setIdentity(event.target.value)}
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy) {
              void onSubmit(identity.trim(), password);
            }
          }}
        />
        {error ? <div className="flash">{error}</div> : null}
        <div className="auth-actions">
          <button
            id="auth-login"
            type="button"
            disabled={busy}
            onClick={() => void onSubmit(identity.trim(), password)}
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
