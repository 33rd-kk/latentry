# What Latentry protects against

Latentry is for one person: you, on your own computer, and on the phones
and computers you pair with it. It has no accounts. This page lists who
could try to misuse it, what Latentry does about each, and what it leaves
to you. The details are in [SECURITY.md](https://github.com/33rd-kk/latentry/blob/main/SECURITY.md)
and the pages linked below.

The threats here are those of the
[Local Image Generation Security Profile (LIGSP)](https://github.com/33rd-kk/local-image-gen-security),
for which Latentry is the reference implementation; its
[conformance table](../reference/ligsp.md) goes through the profile's
requirements one by one.

## What Latentry trusts

- **This computer**, and anyone who can use it as you. Latentry cannot
  protect you from someone who is already logged in as you.
- **Devices you paired.** A paired device can generate, read the gallery
  folders and drive the GPU, as you can. It cannot change settings or
  install anything (unless you allow that with `SETTINGS_EDIT`).
- **Owner devices**, which you paired with a code from a terminal on this
  computer (`npm run owner-code`). They may also change settings and Setup
  and pair other devices, as this computer may. Whoever copies an owner
  device's cookie can do the same, so keep owner devices to networks you
  trust ([An owner device](network.md#an-owner-device)).
- **The backends you set up**, for what you send them. Latentry sends your
  prompts and pictures to the backend you choose, and to no other.

## Who could try, and what Latentry does

### A website you visit

Any page in your browser can send requests to `http://localhost`. It can
also try *DNS rebinding*: re-pointing its own hostname at your computer, so
that it can read the answers too.

- `/api` refuses requests from other sites, and accepts request bodies only
  as JSON, which a page cannot send to another site without its consent.
- `/api` answers only for `localhost`, IP addresses on your network, and
  hosts you list in `ALLOWED_HOSTS`, so a rebound hostname is refused.
- The built-in engine needs a random token that only Latentry holds, and
  answers only requests addressed to this computer by name or address.
- Pages cannot be framed by other sites.

### Another device on your network

- By default Latentry listens on this computer only. The pairing card on
  **Settings** says whether it is open to your network.
- Once it is open (`LATENTRY_HOST`), a device must be paired before it gets
  anything but the pairing page. You pair it with a code shown only on this
  computer, which works once and expires after 10 minutes.
- A paired device holds a signed cookie that page scripts cannot read. It
  expires after 30 days, and you can remove one device, or all of them, on
  Settings.
- By default, Settings, Setup and the pairing card work from this computer
  only. Paired devices do not see this computer's paths or folder names.
- Requests are limited per device, counted by the address the connection
  really comes from.

See [Other devices and security](network.md).

### Someone scanning the internet

Servers for image generation are often exposed by accident, and some have
been taken over through their extensions.

- Latentry listens on 127.0.0.1 unless you change it, and has no mode that
  is open without pairing.
- **Settings** warns when a ComfyUI or AUTOMATIC1111 / Forge backend is set
  at another computer's address without a token, since anyone who can
  reach such a server can use it directly, without going through Latentry.
  [Backends on other computers](network.md#backends-on-other-computers)
  says how to keep one closed.

### A model file, workflow or extension

- The engine reads weights only from `.safetensors` files, which cannot run
  code. A model folder whose weights come only in a pickle format (`.bin`,
  `.ckpt`, `.pt`) is refused.
- The ComfyUI workflows Latentry runs come only from the folder you set on
  this computer. A paired device can pick one by name, if you allow it, but
  cannot send its own, and a workflow saved in a picture is never run.
- Latentry never installs or updates extensions or custom nodes for a
  backend. Whatever you install there runs with that backend's rights.

### A swapped download

- Models, taggers and pose models fetched on **Setup**, or on first use,
  come from a fixed commit, and each file is checked against its SHA-256
  before it is used. So are the config files a single SDXL checkpoint
  needs.
- The engine's Python packages are installed from a lock with the SHA-256
  of every file. A file that does not match is never installed.
- The install scripts install Latentry's own JavaScript packages with
  `npm ci`, from `package-lock.json`, which has the hash of every package.
- Downloads go over HTTPS, checked against the certificate authorities
  Node.js trusts. Latentry takes out the ones whose keys are known to be
  compromised even when the Node.js it runs on still lists them: today
  three emSign roots, which Node.js itself dropped in 22.23.4, 24.22.1 and
  26.12.1.

### Someone who uses this computer or browser later

- Pages are not cached by the browser. What you type is kept in the browser
  only as the form you see and the characters you save, and not at all in
  [secret mode](secret-mode.md).
- A secret run leaves nothing in the browser, and the server forgets it a
  minute after it ends. On ComfyUI it also blanks the pictures it uploaded
  and deletes the run from ComfyUI's history. Its pictures are still saved
  to the gallery folder, as any run's are (see
  [what secret mode does not do](secret-mode.md#what-it-does-not-do)).
- The settings file, the pairing key, the paired-device list and the
  folder-name key can be read only by your account: mode 600, or on Windows
  an access list with only you (and Windows itself).
- Nothing is sent anywhere for statistics: Next.js's and Hugging Face's
  usage reports are turned off.

See [Privacy](privacy.md).

### Whoever receives a picture you share

- Saved pictures carry their prompt and settings, as other tools' do, so
  they can be read back. What Latentry writes into them holds no paths,
  location or camera data: model and LoRA names are file names only.
- A ComfyUI backend's full graph is removed from the saved picture.
- Pictures from a secret run are saved like any other, prompt included;
  move or delete the file to keep one from being shared.

## What Latentry does not protect against

- **Someone already on this computer as you**, or software running as you.
- **A paired device.** It can do what you can, except change settings.
  Paired devices share ordinary runs, so one can watch or stop a run
  started on another; a secret run stays with the page that started it.
  Remove a device you no longer trust.
- **An owner device.** It can do everything this computer can through
  Latentry, settings included, except open its file manager. Remove it
  when you no longer trust it.
- **Traffic on your network.** Over plain `http://`, prompts, pictures and
  the pairing cookie travel unencrypted, and anyone who can watch your
  network can read them.
- **The internet.** To reach Latentry from outside your network, put an
  authenticating reverse proxy in front of it, on this computer.
- **Your backends themselves.** Latentry cannot add a login to ComfyUI or
  AUTOMATIC1111 / Forge, or vet their extensions.
- **The pictures and prompts you choose to share.**

## Check your setup

The profile's checker looks at what you actually run: whether Latentry and
your backends can be reached from the network, whether they answer other
websites or any host name, whether your model folders hold pickle-format
files, and who can read Latentry's settings and keys. It only reads, and
only at the addresses and folders you name:

```bash
uvx local-image-gen-security check http://127.0.0.1:3000 http://127.0.0.1:8188 --models models --private .
```

Run it from Latentry's folder, with your own backends' addresses.
`--redact` hides addresses, ports and paths so the report can be shared.

To report a security problem, use
[GitHub's private reporting](https://github.com/33rd-kk/latentry/security/advisories/new).
