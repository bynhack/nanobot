import { appStore } from './app-state';
import { STORAGE_KEYS } from './store';

export function AuthTokenModal({
  open,
  draftToken,
  setDraftToken,
  onClose,
}: {
  open: boolean;
  draftToken: string;
  setDraftToken: (value: string) => void;
  onClose: () => void;
}) {
  const saveToken = () => {
    const token = draftToken.trim();
    window.localStorage.setItem(STORAGE_KEYS.authToken, token);
    appStore.dispatch({ type: 'auth.set', token });
    onClose();
  };

  return (
    <div className={`auth-modal${open ? '' : ' hidden'}`}>
      <div className="auth-card">
        <h2>需要认证</h2>
        <p>请输入当前配置的访问令牌。</p>
        <input
          type="password"
          placeholder="请输入访问令牌"
          value={draftToken}
          onChange={(event) => setDraftToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              saveToken();
            }
          }}
        />
        <div className="auth-actions">
          <button id="auth-save" type="button" onClick={saveToken}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
