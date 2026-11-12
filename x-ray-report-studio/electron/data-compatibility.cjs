// Keep this allowlist in sync with the persisted key versions in src/workspace.ts
// and the Electron-owned files copied by user-data-backup.cjs. Add an application
// version only after its reader has been tested against this exact data contract.
const CURRENT_DATA_CONTRACT = 'xrs-local-data-v1';
const DATA_SCHEMA_VERSION = 1;

const APPLICATION_DATA_CONTRACTS = Object.freeze({
  '0.4.53': Object.freeze([CURRENT_DATA_CONTRACT]),
  // Undo history is kept under a separate optional localStorage key. Older readers preserve report documents; the fingerprint check safely drops stale history after an older app edits a report.
  '0.4.54': Object.freeze([CURRENT_DATA_CONTRACT]),
  // Beta uses a separate profile; the persisted report format is unchanged.
  '0.4.55-beta.1': Object.freeze([CURRENT_DATA_CONTRACT]),
});

function applicationSupportsDataContract(applicationVersion, dataContract, schemaVersion = DATA_SCHEMA_VERSION) {
  if (!/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(String(applicationVersion))) return false;
  if (schemaVersion !== DATA_SCHEMA_VERSION || !dataContract) return false;
  return APPLICATION_DATA_CONTRACTS[String(applicationVersion)]?.includes(dataContract) ?? false;
}

module.exports = { CURRENT_DATA_CONTRACT, DATA_SCHEMA_VERSION, applicationSupportsDataContract };
