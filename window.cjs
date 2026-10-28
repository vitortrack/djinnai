const { app, BrowserWindow, shell } = require('electron');

const url = process.argv.at(-1);
const { origin } = new URL(url);

app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1100, height: 900, title: 'DjinnAI', backgroundColor: '#18181b', autoHideMenuBar: true });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin === origin) return;
    event.preventDefault();
    shell.openExternal(target);
  });
  window.loadURL(url);
});

app.on('window-all-closed', () => app.quit());
