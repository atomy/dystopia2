import { showMainMenu, loadSettings } from './ui/menus.js';
import { ClientGame } from './game/client.js';
import { sfx } from './audio/sfx.js';

const ui = document.getElementById('ui')!;
const gameEl = document.getElementById('game')!;
const settings = loadSettings();

async function boot(error = ''): Promise<void> {
  const choice = await showMainMenu(ui, settings, error);
  sfx.unlock();
  new ClientGame(ui, gameEl, settings, choice, (reason) => {
    history.replaceState(null, '', location.pathname);
    void boot(reason === 'Connection closed' ? '' : reason);
  });
}

void boot();
