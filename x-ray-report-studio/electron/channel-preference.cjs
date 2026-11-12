async function changeUpdateChannel({ requested, current, profile, backup, persist }) {
  if (requested !== 'stable' && requested !== 'beta') throw new Error('Неизвестный канал обновлений.');
  if (requested === current) return { channel: current, profile, restarting: false };
  if (requested === 'beta' && profile !== 'beta') {
    await backup();
    await persist({ channel: 'beta', profile: 'beta', onboarded: true });
    return { channel: 'beta', profile: 'beta', restarting: true };
  }
  // Switching a Beta binary to Stable updates only its feed. The isolated
  // profile is retained and no older app is installed automatically.
  await persist({ channel: requested, profile, onboarded: profile === 'beta' });
  return { channel: requested, profile, restarting: false };
}

module.exports = { changeUpdateChannel };
