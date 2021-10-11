#!/bin/sh

# Perorm app init, set ip address during build time

PUBLIC_IP_ADDR=$(curl ipinfo.io/ip)

echo """
[
  {
    \"name\": \"node-app\",
    \"script\": \"app.js\",
    \"log_date_format\": \"YYYY-MM-DD HH:mm Z\",
    \"merge_logs\": false,
    \"watch\": false,
    \"max_restarts\": 10,
    \"exec_interpreter\": \"node\",
    \"exec_mode\": \"fork_mode\",
    \"env\": {
      \"NODE_ENV\": \"production\",
      \"RPC_HOST\": \"$PUBLIC_IP_ADDR\",
      \"RPC_PORT\": \"8545\",
      \"LISTENING_PORT\": \"30303\",
      \"INSTANCE_NAME\": \"NewNode\",
      \"CONTACT_DETAILS\": \"https://www.jellypool.xyz\",
      \"WS_SERVER\": \"ws://meter-stats-server.nextblu.com:3030\",
      \"WS_SECRET\": \"metermonitorsecret\",
      \"VERBOSITY\": 2
    }
  }
]
""" >| app.json
