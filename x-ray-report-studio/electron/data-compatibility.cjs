// Keep this allowlist in sync with the persisted key versions in src/workspace.ts.
// Add a release only after its reader has been tested against this data contract.
const CURRENT_DATA_CONTRACT = 'xrs-local-data-v1';
const DATA_SCHEMA_VERSION = 1;

const APPLICATION_DATA_CONTRACTS = Object.freeze({
  '0.4.53': Object.freeze([CURRENT_DATA_CONTRACT]),
  // Undo history is kept under a separate optional localStorage key. Older readers preserve report documents; the fingerprint check safely drops stale history after an older app edits a report.
  '0.4.54': Object.freeze([CURRENT_DATA_CONTRACT]),
  // The local 0.4.55 upgrade keeps the same persisted report contract; undo history is optional.
  '0.4.55': Object.freeze([CURRENT_DATA_CONTRACT]),
  // Beta uses a separate profile; the persisted report format is unchanged.
  '0.4.55-beta.1': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.56': Object.freeze([CURRENT_DATA_CONTRACT]),
  // These Stable releases retain the same persisted report and profile contract.
  '0.4.57': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.58': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.59': Object.freeze([CURRENT_DATA_CONTRACT]),
  // The 0.4.60 updater recovery release retains the same persisted profile contract.
  '0.4.60': Object.freeze([CURRENT_DATA_CONTRACT]),
  // 0.4.61 is a technical release with the unchanged 0.4.60 profile contract.
  '0.4.61': Object.freeze([CURRENT_DATA_CONTRACT]),
  // 0.4.62 and updater rollback candidates retain the same persisted profile contract.
  '0.4.62': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.63': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.64': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.65': Object.freeze([CURRENT_DATA_CONTRACT]),
  // Clipboard/updater changes keep the tested .68 workspace and profile format.
  '0.4.68': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.69': Object.freeze([CURRENT_DATA_CONTRACT]),
  '0.4.70': Object.freeze([CURRENT_DATA_CONTRACT]),
});

function applicationSupportsDataContract(applicationVersion, dataContract, schemaVersion = DATA_SCHEMA_VERSION) {
  if (!/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(String(applicationVersion))) return false;
  if (schemaVersion !== DATA_SCHEMA_VERSION || !dataContract) return false;
  return APPLICATION_DATA_CONTRACTS[String(applicationVersion)]?.includes(dataContract) ?? false;
}

module.exports = { CURRENT_DATA_CONTRACT, DATA_SCHEMA_VERSION, applicationSupportsDataContract };
