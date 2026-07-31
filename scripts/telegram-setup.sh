#!/usr/bin/env bash
# Finds the Telegram chat id for reply alerts and sends a test message.
#
#   ./scripts/telegram-setup.sh <bot-token>
#
# Before running: create the bot with @BotFather in Telegram, then open the
# chat with your new bot and send it any message ("hi" is fine). Telegram will
# not tell anyone your chat id until you have spoken to the bot first.
set -euo pipefail

BOLD=$'\033[1m'; RESET=$'\033[0m'; RED=$'\033[31m'; GREEN=$'\033[32m'

token="${1:-}"
if [ -z "$token" ]; then
  echo "${RED}Usage: ./scripts/telegram-setup.sh <bot-token>${RESET}" >&2
  echo "Get the token from @BotFather — it looks like 8123456789:AAH....." >&2
  exit 1
fi

api="https://api.telegram.org/bot${token}"

echo "${BOLD}==> Checking the token${RESET}"
me=$(curl -fsS "${api}/getMe") || {
  echo "${RED}Telegram rejected that token. Copy it again from @BotFather.${RESET}" >&2
  exit 1
}
username=$(printf '%s' "$me" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
echo "Talking to @${username}"

echo "${BOLD}==> Looking for your chat${RESET}"
updates=$(curl -fsS "${api}/getUpdates")
chat_id=$(printf '%s' "$updates" | sed -n 's/.*"chat":{"id":\(-\{0,1\}[0-9]*\).*/\1/p' | head -1)

if [ -z "$chat_id" ]; then
  echo "${RED}No messages found.${RESET}" >&2
  echo "Open Telegram, search for @${username}, press Start, send it any" >&2
  echo "message, then run this script again." >&2
  exit 1
fi

echo "${GREEN}Found chat id: ${chat_id}${RESET}"

echo "${BOLD}==> Sending a test message${RESET}"
curl -fsS -X POST "${api}/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"${chat_id}\",\"text\":\"cylrm is wired up. Reply alerts will arrive here.\"}" \
  > /dev/null
echo "${GREEN}Sent — check your phone.${RESET}"

cat <<EOF

${BOLD}Add these two lines to /root/crm/.env on the droplet, then restart:${RESET}

  TELEGRAM_BOT_TOKEN=${token}
  TELEGRAM_CHAT_ID=${chat_id}

  ssh root@178.128.28.158 'pm2 restart crm'
EOF
