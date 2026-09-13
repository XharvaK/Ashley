# Project Ashley on Linux Mint (4GB spare laptop)

24/7 **agent-service + discord-bot** only (~400–500 MB). Nuclear Discord companion — no voice, Orpheus, or Telegram.

Private repo: `https://github.com/XharvaK/project-ashley`

## Fastest path (recommended)

### On Windows (once)

```powershell
cd C:\Users\<user>\Projects\project-ashley
# Commit + push deploy/linux-mint (ask agent if not pushed yet)
powershell -File scripts\mint\prepare-mint-transfer.ps1 -StopAshley
```

Copy Desktop `ashley-mint-transfer\` to a USB stick.

### On Mint

1. Sign into GitHub in the browser (or `gh auth login`).
2. Plug USB, open the transfer folder in a terminal:

```bash
bash first-boot-from-usb.sh
```

That installs Node 22 + `gh`, clones the private repo, installs `.env`, enables systemd user units.

3. Check:

```bash
bash ~/project-ashley/deploy/linux-mint/status.sh
```

## Already cloned?

If the folder is still `~/composer-assistant`, rename once then pull:

```bash
mv ~/composer-assistant ~/project-ashley
cd ~/project-ashley && git remote set-url origin https://github.com/XharvaK/project-ashley.git
bash ~/project-ashley/deploy/linux-mint/bootstrap.sh --env-file /path/to/ashley-mint-transfer/.env
```

Fresh clone:

```bash
bash ~/project-ashley/deploy/linux-mint/bootstrap.sh --env-file /path/to/ashley-mint-transfer/.env
```

## Updates later

Canonical path from Windows after push:

```powershell
npm run start:ashley
```

That SSHs to Mint, fast-forwards the checkout, then **exec**s that checkout's `update.sh`. Activation is stop → build → install candidate user-systemd policy → daemon-reload → start. Ashley is down for the build. If build or policy prep fails, units stay stopped.

On the Mint laptop itself:

```bash
cd ~/project-ashley
git pull --ff-only && bash deploy/linux-mint/update.sh
```

`update.sh` activates the current checkout only. It does not fetch.

## Sandbox boundary

Production uses the direct, unprivileged Sandbox V2 path. There is no broker
daemon, broker socket, delegated key installation, or Sandbox V1 systemd unit.
The V2 project registry is operator-owned and read-only to Ashley. Physical V2
qualification uses isolated disposable fixtures and does not touch production
databases, registries, or workspaces:

```bash
cd ~/project-ashley
npm run build --prefix apps/sandbox-policy
npm run build --prefix apps/sandbox-m1
npm run build --prefix apps/sandbox-tree
npm run build --prefix apps/sandbox-v2
node scripts/mint/m3-m4-physical-qualification.mjs
```

The qualification runner refuses to execute on Windows and never performs
capability promotion.

### Without opening the laptop (SSH)

On Mint once:

```bash
bash ~/project-ashley/deploy/linux-mint/enable-ssh.sh
```

From Windows (after you know Mint’s LAN IP / hostname):

```powershell
cd C:\Users\<user>\Projects\project-ashley
# optional: commit first, then:
powershell -File scripts\mint\remote-update.ps1 -HostName 192.168.x.x -User YOUR_MINT_USER -PushFirst
```

That SSHs in, fast-forwards the checkout, then execs coherent activation (stop / build / candidate policy / start). Lid can stay closed.

## Ops

```bash
systemctl --user status ashley-agent ashley-discord
journalctl --user -u ashley-agent -u ashley-discord -f
curl -s http://127.0.0.1:3710/health
systemctl --user stop ashley-discord ashley-agent
```

## Important

- **One Discord token** — production is Mint only. From Windows, `npm run start:ashley` SSHs here (never starts a local Discord bot). Windows local start requires `-AllowWindows` and Mint must be stopped first.
- Never commit `.env`.
- Delete the USB transfer folder after install.
- Runtime data stays at `~/.composer-assistant/` (historical path; do not rename casually).

## Optional SSH from Windows

```bash
# on Mint
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
hostname -I
```

```powershell
# on Windows
ssh USER@MINT_IP
scp -r $env:USERPROFILE\Desktop\ashley-mint-transfer USER@MINT_IP:~/
```
