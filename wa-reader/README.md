# TBW WhatsApp Group Reader (read-only)

Reads messages from the WhatsApp **groups** your dedicated number is a member of and
writes them into the `wa_inbox` table, which powers the **WhatsApp Task Bar** in the app.
It **never sends** anything.

> ⚠️ This uses the unofficial WhatsApp multi-device protocol (against WhatsApp ToS).
> Use a **dedicated / burner number**, added to your client groups — **never your main
> business line**. If that number is ever banned, you only lose the burner; rotate it and
> re-scan. Keep it read-only.

## First-time setup (on your VPS)

```bash
cd /opt/tbw-os/wa-reader

# Build the reader image
docker build -t tbw-wa-reader .

# Run it once interactively to scan the QR (creates ./auth)
docker run -it --rm \
  -e SUPABASE_URL="https://xqhygmdznuecoxdvcmyl.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<your service role key>" \
  -v $(pwd)/auth:/app/auth \
  tbw-wa-reader
```

On the **dedicated phone**: WhatsApp → **Settings → Linked Devices → Link a device** →
scan the QR shown in the terminal. Once it prints `✅ connected`, it's reading.

## Run it persistently

After the first scan succeeds (the `./auth` folder now holds the session):

```bash
docker run -d --restart unless-stopped --name tbw-wa-reader \
  -e SUPABASE_URL="https://xqhygmdznuecoxdvcmyl.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<your service role key>" \
  -v /opt/tbw-os/wa-reader/auth:/app/auth \
  tbw-wa-reader
```

Logs / status:

```bash
docker logs -f tbw-wa-reader
```

## Notes
- Add the dedicated number to every client group you want read.
- The linked phone should reconnect occasionally (multi-device tolerates ~14 days offline).
- If it logs "logged out", delete the `auth/` folder and re-scan.
- New messages appear in the app under **WhatsApp Task Bar** after you click **Scan new**
  (which runs the AI extraction). You can also automate that via a cron hitting
  `POST /api/whatsapp-inbox/extract`.
