# Pairing fixtures

What Latentry's pairing wrote before it moved into `lib/pairing`, made with
the code of 0.17.1 (unchanged on main at 30ff06c). Devices paired then carry
these cookies, so `__tests__/pairing-core.verify.ts` checks that today's
code still lets them in, and keeps out the one that was removed.

- `key-file/`: the key in its own file (`latentry.pairing-key`).
- `key-from-env/`: the key from `LATENTRY_PAIRING_KEY`, here `ab` × 32, so
  there is no key file.

Each holds the sealed device list (`latentry.pairing-devices.json`) and
`cookies.json`: the time they were made (`now`) and the cookies of a phone
named "Test phone", of an owner, and of a device paired then removed. The
keys are made up for this test and let nothing in anywhere else.

**Never make these again.** New code would write them the new way and hide
the break they are there to catch.
