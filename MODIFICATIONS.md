# Modifications

This fork (`Actuna-Tech/node-red`) contains files modified by Actuna Sp. z o.o.
from the Node-RED 5.0.7 base version (commit `cd05a9a`). As required by
section 4(b) of the Apache License 2.0, every modified file carries a notice
that it has been changed.

- Source files that allow comments carry the notice in the file itself
  (template below), placed after the project licence header.
- Files that cannot hold a comment (JSON) or have no project licence header
  are listed in this file with a description of the changes.

This file, `AGENTS.md` and the `design/` directory belong to the fork only.
Branches prepared for a contribution to the Node-RED project contain neither
the notices nor this file.

## Notice template

```js
/*
 * Modified by Actuna Sp. z o.o.:
 *   <ID>: <what was changed and why>
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
```

- `<ID>` is the work item the change belongs to (for example `Z-14`, `FL-B-009`).
- A file changed again for another work item gets one more line in the
  existing block, not a second block.
- New files keep the project licence header and add the same block.

## Files without an in-file notice

| File | Reason | Changes |
|---|---|---|
| `packages/node_modules/@node-red/editor-client/locales/en-US/editor.json` | JSON - no comments | `layout.*` keys for the flow layout controls: flow properties, node and subflow appearance, user settings, context menu (Z-14, 14 keys); `layout.unknownValue` for unknown layout values (FL-B-005); `clipboard.import.lockedFlow` - hint that a locked flow cannot be replaced on import (FL-B-010) |
| `packages/node_modules/node-red/settings.js` | settings template without a licence header (a notice at the top would be copied into every user's settings file) | `editorTheme.flowLayout` - commented example and description of the `enabled` option (Z-14) |
| `package.json` | JSON - no comments | `test:e2e` script for the end-to-end tests, outside `npm test` (Z-14) |
| `CHANGELOG.md` | change log, not source | `Unreleased` sections describing the changes of the fork |

When another file of this kind is changed, add a row here in the same commit.

## Checking the notices

Every file changed from the base version must either contain the notice or be
listed above:

```bash
git diff --name-only cd05a9a..HEAD -- packages test scripts \
  | while read f; do grep -q "Modified by Actuna" "$f" || echo "$f"; done
```

The command lists only the files in the table above.
