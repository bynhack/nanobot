import { createRoot } from 'react-dom/client';

import { App } from './app';

const root = document.getElementById('app');
if (!root) {
  throw new Error('缺少页面根节点');
}

createRoot(root).render(<App />);
