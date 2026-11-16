# M8 P3a validation record

## Developer scope declaration

- Scope: `lib/obsidian-m8-sync-preferences.ts`, minimal preference IO exposure in `lib/obsidian-m8-windows-agent-controller.ts`, focused OS TEMP tests, and the P2→P3 TODO update.
- Persistent format: version 1 with exactly `version`, `enabled`, and `intent`; it cannot carry JWT, Owner UUID, note content, Vault lists, transport settings, or execution authority.
- Safety boundary: a loaded `enabled` or `running` value never invokes `start()` or bypasses the controller's existing fresh Owner/M5/schema gates.
- Test boundary: synthetic files under isolated OS TEMP only. No Production write, private Vault access, transport Adapter, background service, deployment, SQL003 rerun, publishing, or automatic merge was performed.
- This is P3a preference persistence only, not completed P3 or proof of long-running synchronization.

## Developer checks

The Developer records only checks actually run in the inner sandbox. The Supervisor must append the pinned outer validation results (command, platform, exit status, output digest and parsed OS-specific SKIPs) on the final unchanged tree before independent review and candidate commit.

- `npm run typecheck`: PASS on 2026-11-16 in the provided Linux/WSL inner checkout (`tsc --noEmit`, exit 0).
- `git diff --check`: PASS on 2026-11-16 in the provided inner checkout (exit 0); rerun after the final record edit before handoff.
- `npm run build`, `npm run test:unit`, `npm run test:release:closed:local`: not run by Developer; reserved for Supervisor pinned validation.

## Supervisor validation

Pending Supervisor execution; no result is claimed here.


## Supervisor validation record

These checks ran on the input tree below. The supervisor reruns the full trusted profile after adding this record; the separate immutable validation receipt binds those final checks to the reviewed candidate tree. Unrecognized or incomplete SKIP output remains unverified.

```json
{
  "version": 1,
  "workRunId": "1d393626-940f-4b15-ac76-5b75c649ec6f",
  "profileDigest": "2700e0e42b058e4a5e73768f80ce3a41e4330ed6e26009b6401707ed9d0081a3",
  "inputTreeSha": "39a7511970fa880aa2707d33517a80b12fa69181",
  "finalValidationEvidenceRef": "attempts/3305652e-df3c-46cf-a078-32fbbd37feaa/1d393626-940f-4b15-ac76-5b75c649ec6f.validation.json",
  "checks": [
    {
      "id": "typecheck",
      "kind": "build",
      "command": "npm run typecheck",
      "argv": [
        "npm",
        "run",
        "typecheck"
      ],
      "exitCode": 0,
      "durationMs": 1888,
      "startedAt": "2026-11-16T09:23:27.706Z",
      "finishedAt": "2026-11-16T09:23:29.594Z",
      "platform": "linux",
      "skipEvidence": {
        "format": "unrecognized",
        "skipped": null,
        "tests": [],
        "complete": false
      },
      "outputBytes": 0,
      "outputSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "id": "production-build",
      "kind": "build",
      "command": "npm run build",
      "argv": [
        "npm",
        "run",
        "build"
      ],
      "exitCode": 0,
      "durationMs": 8898,
      "startedAt": "2026-11-16T09:23:29.594Z",
      "finishedAt": "2026-11-16T09:23:39.754Z",
      "platform": "linux",
      "skipEvidence": {
        "format": "unrecognized",
        "skipped": null,
        "tests": [],
        "complete": false
      },
      "outputBytes": 1394,
      "outputSha256": "33b2c38725bb90cbdca17ba1e7c414a1c20b33ae2c51a1f6d4412cbdc74a7644"
    },
    {
      "id": "unit",
      "kind": "test",
      "command": "npm run test:unit",
      "argv": [
        "npm",
        "run",
        "test:unit"
      ],
      "exitCode": 0,
      "durationMs": 8351,
      "startedAt": "2026-11-16T09:23:39.781Z",
      "finishedAt": "2026-11-16T09:23:48.133Z",
      "platform": "linux",
      "skipEvidence": {
        "format": "tap",
        "skipped": 3,
        "tests": [
          {
            "test": "M5 Windows DPAPI actually seals and unseals the journal key for the same logged-on user",
            "reason": "No reason reported"
          },
          {
            "test": "native Windows File.Replace holds share-mode lock and independently writes an original backup",
            "reason": "No reason reported"
          },
          {
            "test": "native Windows replacement refuses a concurrent writer's open handle",
            "reason": "No reason reported"
          }
        ],
        "complete": true
      },
      "outputBytes": 145505,
      "outputSha256": "4bdd1dcf94908d381ba14b0164c46f8e7242e03b46577bfeaaebe8856748310b"
    },
    {
      "id": "production-closed",
      "kind": "test",
      "command": "npm run test:release:closed:local",
      "argv": [
        "npm",
        "run",
        "test:release:closed:local"
      ],
      "exitCode": 0,
      "durationMs": 830,
      "startedAt": "2026-11-16T09:23:48.134Z",
      "finishedAt": "2026-11-16T09:23:48.964Z",
      "platform": "linux",
      "skipEvidence": {
        "format": "unrecognized",
        "skipped": null,
        "tests": [],
        "complete": false
      },
      "outputBytes": 156,
      "outputSha256": "dfff65296140ee84b7f9cd92c1456b346ad5af275dbbfe115107df7d852f5dba"
    }
  ]
}
```
