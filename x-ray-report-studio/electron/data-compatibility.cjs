// Keep this allowlist in sync with the persisted key versions in src/workspace.ts
// and the Electron-owned files copied by user-data-backup.cjs. Add an application
// version only after its reader has been tested against this exact data contract.
const CURRENT_DATA_CONTRACT = 'xrs-local-data-v1';
const DATA_SCHEMA_VERSION = 1;

const APPLICATION_DATA_CONTRACTS = Object.freeze({
  '0.4.53': Object.freeze([CURRENT_DATA_CONTRACT]),
});

function applicationSupportsDataContract(applicationVersion, dataContract, schemaVersion = DATA_SCHEMA_VERSION) {
  if (!/^\d+\.\d+\.\d+$/.test(String(applicationVersion))) return false;
  if (schemaVersion !== DATA_SCHEMA_VERSION || !dataContract) return false;
  return APPLICATION_DATA_CONTRACTS[String(applicationVersion)]?.includes(dataContract) ?? false;
}

module.exports = { CURRENT_DATA_CONTRACT, DATA_SCHEMA_VERSION, applicationSupportsDataContract };
