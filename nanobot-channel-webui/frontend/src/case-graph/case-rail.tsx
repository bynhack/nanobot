import { Search } from 'lucide-react';

import type { CaseGraphCaseOption, CaseGraphSelectableAccount } from './types';

interface CaseRailProps {
  cases: CaseGraphCaseOption[];
  casesLoading: boolean;
  caseIdDraft: string;
  accountQuery: string;
  availableAccounts: CaseGraphSelectableAccount[];
  accountsLoading: boolean;
  selectedAccountIds: string[];
  onCaseIdChange: (value: string) => void;
  onAccountQueryChange: (value: string) => void;
  onToggleAccount: (accountId: string) => void;
  onToggleAccountGroup: (accountIds: string[]) => void;
}

export function CaseRail({
  cases,
  casesLoading,
  caseIdDraft,
  accountQuery,
  availableAccounts,
  accountsLoading,
  selectedAccountIds,
  onCaseIdChange,
  onAccountQueryChange,
  onToggleAccount,
  onToggleAccountGroup,
}: CaseRailProps) {
  const selectedSet = new Set(selectedAccountIds);
  const groupedAccounts = new Map<string, CaseGraphSelectableAccount[]>();
  for (const account of availableAccounts) {
    const key = (account.suspectName || '').trim() || account.accountName.trim() || `未命名主体-${account.accountId}`;
    const bucket = groupedAccounts.get(key);
    if (bucket) {
      bucket.push(account);
    } else {
      groupedAccounts.set(key, [account]);
    }
  }

  return (
    <section className="case-graph-rail" aria-label="主体选择区">
      <div className="case-graph-form">
        <label className="case-graph-field">
          <span>案件</span>
          <select
            className="case-graph-select"
            value={caseIdDraft}
            onChange={(event) => onCaseIdChange(event.target.value)}
            disabled={casesLoading}
          >
            <option value="">{casesLoading ? '案件加载中...' : '请选择案件'}</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.caseName || item.caseCode || item.id}
              </option>
            ))}
          </select>
        </label>

        <label className="case-graph-field">
          <span>主体检索</span>
          <div className="case-graph-search">
            <Search size={14} />
            <input
              value={accountQuery}
              onChange={(event) => onAccountQueryChange(event.target.value)}
              placeholder={caseIdDraft ? '请选择主体' : '先选案件'}
              disabled={!caseIdDraft}
            />
          </div>
        </label>

        <div className="case-graph-legend-row">
          <span className="case-graph-legend-item">
            <i className="case-graph-legend-dot is-obtained" />
            已调取
          </span>
          <span className="case-graph-legend-item">
            <i className="case-graph-legend-dot is-pending" />
            未调取
          </span>
        </div>
      </div>

      <div className="case-graph-picker case-graph-picker--fill">
        <div className="case-graph-block-title">
          <span>全部对象</span>
          <span>{selectedAccountIds.length} 已选</span>
        </div>
        <div className="case-graph-picker-list">
          {!caseIdDraft ? <div className="case-graph-empty">先选一个案件。</div> : null}
          {caseIdDraft && accountsLoading ? <div className="case-graph-empty">主体列表加载中...</div> : null}
          {caseIdDraft && !accountsLoading && availableAccounts.length === 0 ? (
            <div className="case-graph-empty">当前条件下没有可选主体。</div>
          ) : null}
          {Array.from(groupedAccounts.entries()).map(([groupName, accounts]) => {
            const groupIds = accounts.map((account) => account.accountId);
            const checkedCount = groupIds.filter((accountId) => selectedSet.has(accountId)).length;
            const fullyChecked = checkedCount === groupIds.length && groupIds.length > 0;
            const partiallyChecked = checkedCount > 0 && !fullyChecked;

            return (
              <details className="case-graph-picker-group" key={groupName} open>
                <summary className="case-graph-picker-group-summary">
                  <label
                    className="case-graph-picker-group-toggle"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={fullyChecked}
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = partiallyChecked;
                        }
                      }}
                      onChange={() => onToggleAccountGroup(groupIds)}
                    />
                    <div className="case-graph-picker-group-copy">
                      <strong>{groupName}</strong>
                      <p>{accounts.length} 个账号</p>
                    </div>
                  </label>
                </summary>
                <div className="case-graph-picker-group-items">
                  {accounts.map((account) => {
                    const checked = selectedSet.has(account.accountId);
                    const obtainState = Number(account.isObtain) === 1 ? 'obtained' : 'pending';
                    const displayName = account.tradeCard || `账号 ${account.accountId}`;
                    const metaLabel = account.accountCategory ? accountCategoryLabel(account.accountCategory) : `账号 ID ${account.accountId}`;
                    return (
                      <label className={`case-graph-picker-item is-${obtainState}`} key={account.accountId}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleAccount(account.accountId)}
                        />
                        <div className="case-graph-picker-copy">
                          <strong title={displayName}>{displayName}</strong>
                          <p title={metaLabel}>{metaLabel}</p>
                        </div>
                        <span
                          className={`case-graph-obtain-indicator is-${obtainState}`}
                          aria-label={obtainState === 'obtained' ? '已调取' : '未调取'}
                          title={obtainState === 'obtained' ? '已调取' : '未调取'}
                        />
                      </label>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function accountCategoryLabel(value: number): string {
  if (value === 1) return '银行账号信息';
  if (value === 2) return '财付通（微信）账号';
  if (value === 3) return '支付宝账号';
  if (value === 4) return '虚拟币';
  return '账号信息';
}
