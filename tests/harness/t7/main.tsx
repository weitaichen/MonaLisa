// Harness entry: install fakes into the UI's dependency seam BEFORE the UI modules evaluate
// (state.ts reads params / prefs at import time), then mount exactly like src/main.tsx.
import { render } from 'preact';
import { defaultParams } from '../../../src/engine/params';
import { DEFAULT_PREFS } from '../../../src/store/settings';
import { deps } from '../../../src/ui/deps';
import { installFakes } from './fakes';

const q = new URLSearchParams(location.search);
await installFakes(deps, {
  params: defaultParams(),
  prefs: { ...DEFAULT_PREFS, installHintDismissed: q.get('hint') !== '1' },
});
await import('../../../src/ui/theme.css');
const { App } = await import('../../../src/ui/app');
render(<App />, document.getElementById('app')!);
(window as Window & { __harnessReady?: boolean }).__harnessReady = true;
