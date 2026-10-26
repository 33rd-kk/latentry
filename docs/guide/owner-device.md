# Owner device

When Latentry runs in Docker, or on a computer you use from your laptop,
your browser is not "this computer" to it. Make it Latentry's **owner
device** instead. An owner device may change Settings and
Setup and pair your other devices, as this computer may.

1. On the computer running Latentry, in a terminal in the Latentry folder:

    ```bash
    docker compose exec latentry npm run owner-code
    # Without Docker:
    npm run owner-code
    ```

    It prints a code, once (pass `-- --port 3001` if Latentry is not on
    port 3000).
2. Open Latentry in your browser. It shows **Pair this device**: type that
   code there and choose **Pair**.

The owner code works once, for 10 minutes, like the other codes. Only a
terminal on that computer can make one, so being able to run a command
there is what makes an owner: an owner device cannot make another owner
from its browser. Settings lists it with **Owner**, and **Remove** takes
its rights away with its pairing.

An owner device stays one for **7 days**, not 30, and only a new owner code
renews it: pairing it again with an ordinary code makes it an ordinary
device. Each time an owner is added or removed, Latentry's log says so
(`[pairing] … owner: device 3 was paired as an owner`), with the device's
number only, never the code, its name or its address. An owner you did not
add shows up there and on Settings.

**If an owner device may be in the wrong hands** (a lost laptop, a copied
cookie), unpair everything from a terminal on that computer, then make
yourself a new owner code:

```bash
npm run forget-devices -- --yes
npm run owner-code
# In Docker:
docker compose exec latentry npm run forget-devices -- --yes
```

This works even if someone else, as an owner, removed your device.

An owner device keeps its cookie as every paired device does. Over plain
`http://` someone who can watch your network could copy it, and with it
change your settings, so use an owner device on a network you trust, or
put Latentry behind [HTTPS](network.md#https).

`SETTINGS_EDIT=lan` still lets every address that can reach Latentry change
settings, paired or not. An owner device is the safer way, and it works
from anywhere you paired it.

