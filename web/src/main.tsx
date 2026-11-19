import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/dialog/dialog.js';
import '@material/web/progress/circular-progress.js';
import '@material/web/switch/switch.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import { styles as typescale } from '@material/web/typography/md-typescale-styles.js';
import './styles.css';
import { App } from './App';
import { isNative } from './lib/api';
import { currentUnits } from './lib/data';
import { pushCatalog, widgets } from './lib/widgets';
import { WidgetSetup } from './screens/WidgetSetup';

document.adoptedStyleSheets.push(typescale.styleSheet!);

const root = createRoot(document.getElementById('root')!);

/** The launcher opens this same app to set a widget up; in that case show the setup screen, not the dashboard. */
async function start() {
  let setup: Awaited<ReturnType<NonNullable<typeof widgets>['pendingConfigure']>> = {};
  if (isNative && widgets) {
    try {
      setup = await widgets.pendingConfigure();
      if (setup.id !== undefined) await pushCatalog(currentUnits()); // the widget can't draw until it knows the metrics
    } catch {
      /* an older native side: just the app */
    }
  }
  root.render(<StrictMode>{setup.id !== undefined ? <WidgetSetup id={setup.id} initial={setup.config} /> : <App />}</StrictMode>);
}
void start();
