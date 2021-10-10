Meter node status monitor
=================================

This is the backend service that should be runned inside the same machine of the Meter node.
This a fork of ethstats, but for Meter.

We highly encourage you to use the provided Dockerfile.

## Configuration

Clone the repo, then configure the app by modifying [app.json](/app.json). 
Please edit only the fields with the comment.

```json
[
  {
    "name": "meternode",
    "script": "app.js",
    "log_date_format": "YYYY-MM-DD HH:mm Z",
    "merge_logs": false,
    "watch": false,
    "max_restarts": 10,
    "exec_interpreter": "node",
    "exec_mode": "fork_mode",
    "env": {
      "NODE_ENV": "production",
      "RPC_HOST": "161.35.80.111", // This is the ip addr of your server
      "RPC_PORT": "8545",
      "LISTENING_PORT": "30303",
      "INSTANCE_NAME": "Jelly", // The name of your node (Will be fetched)
      "CONTACT_DETAILS": "https://www.jellypool.xyz", // Contact details (will be fetched anyway)
      "WS_SERVER": "ws://meterstats.jellypool.xyz:3030", 
      "WS_SECRET": "metermonitorsecret",
      "VERBOSITY": 2
    }
  }
]
```

Enter the validator Telegram group for more information: https://t.me/joinchat/amEwf_syLTFhYjRk

## Run

After editing the app.json file you can start the service with the following docker commands:

```bash
docker build . -t node_monitor
docker start -d -t node_monitor
```
