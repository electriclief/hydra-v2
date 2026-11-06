# Service definitions carry an install face (schema v2)

The install face lives in `module/Services/public/ts/serviceSchema.ts` (CURRENT_SCHEMA = 2) and lands in
`services/<name>.js`, exported to `library/<slug>/service.json`.

## The four fields
- `schema` - the shape. Integer. A newer file WARNS and still loads; nothing refuses.
- `revision` - this definition own history. Bump on steps/hints/exceptions/needs/modes/launch.
- `installer_history[]` - append-only `{rev, at, by, note, hardware?, evidence?, verified?}`. `by` is credit
  and answerability; `hardware` is capability, never an address.
- `install{}` - `engine`, `requires`, `steps` (`{do, verify}`), `hints`, `exceptions`, `evidence`.

## The laws
- A hint PREDICTS, it never forbids: any `when` needs a `reconsider` or the validator warns.
- `verified:true` without `evidence` warns. A step without `verify` warns: only a human can pass it.
- A revision bump with no `installer_history` entry WARNS. It is never a refusal - malleable software.
- A reader NEVER rewrites a file: `migrateService()` works in memory and reports what it did not invent.

## State at filing
- `npm run test` in module/Services: serviceSchema 29/29, gate 10/10 modules green.
- All four existing services still load (`ok true`), each warning on `schema` only.
