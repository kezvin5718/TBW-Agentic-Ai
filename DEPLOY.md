# TBW OS Production Deployment Guide (Ubuntu VPS & Caddy)

This document provides step-by-step instructions for deploying the TBW Operations System on your Ubuntu VPS (such as KVM 2) using Docker Compose and Caddy (for automatic HTTPS).

---

## 1. Prerequisites & DNS Configuration
1. Ensure you have an Ubuntu VPS (Ubuntu 22.04 LTS or 24.04 LTS).
2. Point your domain DNS records:
   * **A Record** pointing `bron.digital` to your **VPS Public IP Address**.
   * **A Record** pointing `www.bron.digital` to your **VPS Public IP Address**.

---

## 2. Server Setup (First-Time Only)
1. SSH into your VPS as `root`:
   ```bash
   ssh root@your_vps_ip
   ```
2. Clone the repository onto the server:
   ```bash
   git clone git@github.com:kezvin5718/TBW-Agentic-Ai.git tbw-os
   cd tbw-os
   ```
3. Run the one-time system setup script to install Docker, Docker Compose, Caddy, and configure the UFW firewall:
   ```bash
   chmod +x deploy/setup.sh
   ./deploy/setup.sh
   ```

---

## 3. Configuration (`.env` file)
Create the production environment file on the server:
1. In the `tbw-os/` root folder, create a `.env` file:
   ```bash
   nano .env
   ```
2. Paste all production keys. Ensure the following VPS-specific variables are set:
   ```env
   # VPS Production Config
   DOMAIN=bron.digital
   CRON_ENABLED=true

   # Supabase Credentials
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

   # LLM API Keys
   OPENROUTER_API_KEY=your_openrouter_key

   # WhatsApp Configuration
   WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
   WHATSAPP_PHONE_NUMBER_ID=your_phone_id
   WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_id
   FOUNDER_PHONE_NUMBER=919999999999
   FOUNDER_WHATSAPP_NUMBER=919999999999

   # Meta Ads Configuration
   META_ACCESS_TOKEN=your_meta_token
   META_AD_ACCOUNT_ID=act_your_ad_account_id
   ```
3. Save and close (`Ctrl+O`, Enter, `Ctrl+X`).

---

## 4. Run the Application
Start the containers in detached mode:
```bash
docker compose up -d --build
```
Caddy will automatically fetch Let's Encrypt SSL certificates for your domain `bron.digital` and serve the dashboard securely!

---

## 5. Monitoring & Logs
To view logs for the Next.js app or reverse proxy, run:
```bash
# View all container logs
docker compose logs -f

# View Next.js server logs only (including background cron jobs output)
docker compose logs -f web

# View Caddy HTTPS server logs only
docker compose logs -f caddy
```

---

## 6. Redeploying After Changes
Whenever you push updates to GitHub and want to pull them to the VPS:
1. Simply run the redeploy script:
   ```bash
   ./deploy/deploy.sh
   ```
This script automatically pulls the latest main branch, builds the Next.js standalone container, restarts the services, and verifies the `/api/health` status.
