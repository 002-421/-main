const { app, shell } = require('electron');

app.whenReady().then(() => {
  try {
    const filename = process.env.XRS_SHORTCUT_PATH;
    if (!filename) throw new Error('Shortcut path was not provided.');
    if (process.env.XRS_SHORTCUT_TARGET) {
      const written = shell.writeShortcutLink(filename, 'create', {
        target: process.env.XRS_SHORTCUT_TARGET,
        cwd: process.env.XRS_SHORTCUT_CWD,
        icon: process.env.XRS_SHORTCUT_ICON,
        description: 'XRS-05 synthetic test shortcut',
      });
      if (!written) throw new Error('Electron did not write the test shortcut.');
      process.stdout.write(JSON.stringify({ written: true }));
    } else {
      process.stdout.write(JSON.stringify(shell.readShortcutLink(filename)));
    }
    app.quit();
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  }
});
