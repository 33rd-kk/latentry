# Other devices and security

Latentry is meant for your own computer or a home network you trust. It has
no accounts or passwords. This computer can always use it; any other device
must be **paired** first, with a code shown on this computer.

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
   example `http://192.168.1.20:3000`. It shows **Pair this device**.
5. On this computer, open **Settings**, scroll to **Phones and other
   computers** and choose **Add a device**.
6. Type the code it shows on the other device, give the device a name if
   you like (for example "My phone"), and choose **Pair**.

The code works once, for 10 minutes. A paired device stays paired for 30
days; then it asks for a new code.

- **On this computer**, the same card lists the paired devices, each with
  its name (or a number), when it was paired and when that ends. **Remove**
  unpairs one device; **Forget all devices** unpairs them all (for a lost
  phone, say).
- **On a paired device**, its **Settings** page says what it is paired as
  and when that ends, and **Unpair this device** unpairs it. From three days
  before the end, every page says so, with a link to pair it again.

The list keeps only the name, when the device was paired and when that
ends; nothing about when or how it is used. It is stored encrypted next to
the settings file.

Paired devices can generate and use the gallery. **Settings and Setup stay
read-only from them**: settings decide which folders are read and written.
To allow changing them from the network as well, set `SETTINGS_EDIT=lan`
(only on a network you trust: anyone who can change settings can point a
backend at their own server and receive your prompts and pictures from then
on); `SETTINGS_EDIT=off` makes them read-only everywhere.

## What protects it

- It listens on 127.0.0.1 unless `LATENTRY_HOST` says otherwise.
- Every device other than this computer must be paired: until then it gets
  only the pairing page, and every `/api` call is refused. A paired device
  holds a signed cookie that scripts on the page cannot read. Over plain
  `http://` that cookie, like everything else, travels unencrypted on your
  network.
- `/api` only answers for `localhost` and private-network addresses (add
  others with `ALLOWED_HOSTS`), and refuses requests from other websites.
- Requests are rate-limited per device, counted by the address the
  connection really comes from.
- Stopping a run takes that run's id, which only the page watching it has.
- The built-in engine listens on 127.0.0.1 with a random token only Latentry
  holds, and answers only requests addressed to this computer.
- Backend tokens are only sent to the server they were set up for.
- **Show in folder** / **Open in default app** in the gallery only work from
  this computer. They start the file manager or picture app without a shell,
  and only for pictures inside a gallery folder. The gallery has no way to
  delete, move or rename files.
- Next.js's anonymous usage reports and Hugging Face's are turned off.

To reach it from outside your network, put an authenticating reverse proxy in
front, on this computer, one that overwrites `X-Forwarded-For` (Latentry
believes that header only from a proxy on this computer). If that proxy does
its own login, `LATENTRY_PAIRING=off` turns pairing off; without such a
proxy, do not: then anyone who can reach Latentry can use it.

Report security problems privately through
[GitHub](https://github.com/33rd-kk/latentry/security/advisories/new).
