# Other devices and security

Latentry is meant for your own computer or a home network you trust. It has
**no login**: whoever can reach it can generate pictures, read the gallery
folders and drive the GPU.

## Use it from a phone or another computer

By default Latentry listens on this computer only (127.0.0.1). To open it to
your network:

1. Add to `.env.local` (in the Latentry folder):

    ```bash
    LATENTRY_HOST=0.0.0.0
    ```

2. Restart Latentry (`npm start`).
3. On Windows, when the firewall asks, allow Node.js on **private** networks.
4. On the other device, open `http://<this computer's address>:3000`, for
   example `http://192.168.1.20:3000`.

Other devices can generate and use the gallery. **Settings and Setup stay
read-only from them**: settings decide which folders are read and written.
To allow changing them from the network as well, set `SETTINGS_EDIT=lan`
(only on a network you trust: anyone who can change settings can point a
backend at their own server and receive your prompts and pictures from then
on); `SETTINGS_EDIT=off` makes them read-only everywhere.

## What protects it

- It listens on 127.0.0.1 unless `LATENTRY_HOST` says otherwise.
- `/api` only answers for `localhost` and private-network addresses (add
  others with `ALLOWED_HOSTS`), and refuses requests from other websites.
- Requests are rate-limited per device.
- The built-in engine listens on 127.0.0.1 with a random token only Latentry
  holds.
- Backend tokens are only sent to the server they were set up for.
- **Show in folder** / **Open in default app** in the gallery only work from
  this computer. They start the file manager or picture app without a shell,
  and only for pictures inside a gallery folder. The gallery has no way to
  delete, move or rename files.
- Next.js's anonymous usage reports and Hugging Face's are turned off.

To reach it from outside your network, put an authenticating reverse proxy in
front, one that overwrites `X-Forwarded-For` (the per-device limits trust
that header).

Report security problems privately through
[GitHub](https://github.com/33rd-kk/latentry/security/advisories/new).
