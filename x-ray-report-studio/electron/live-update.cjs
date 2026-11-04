/** Switch the current window to a packaged renderer, rolling back if it fails. */
async function activateRendererUpdate({ loadFile, installedIndex, previousIndex, waitForReady }) {
  let ready;
  try {
    ready = waitForReady();
    ready.catch(() => {});
    await loadFile(installedIndex);
    await ready;
    return { activated: true };
  } catch (error) {
    // Observe a failed/timed-out ready promise before starting the rollback.
    // A loadFile failure can happen before the renderer sends app:ready.
    try {
      const restored = waitForReady();
      await loadFile(previousIndex);
      await restored;
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function isUsableRenderer(details, frame) {
  const shell = details?.shell;
  return details?.appRoot === true
    && Number(details.templateCount) > 0
    && Number(details.textLength) >= 200
    && Number(details.viewport?.width) > 0
    && Number(details.viewport?.height) > 0
    && Number(shell?.width) > 0
    && Number(shell?.height) > 0
    && shell?.display !== 'none'
    && shell?.visibility === 'visible'
    && shell?.opacity !== '0'
    && Number(frame?.distinctSampleColors) >= 8;
}

module.exports = { activateRendererUpdate, isUsableRenderer };
