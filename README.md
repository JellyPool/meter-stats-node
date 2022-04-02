Meter node status monitor [![Docker](https://github.com/nextblu/meter-stats-node/actions/workflows/docker-publish.yml/badge.svg?branch=master)](https://github.com/nextblu/meter-stats-node/actions/workflows/docker-publish.yml)
=================================

This is the backend service that should be runned inside the same machine of the Meter node.
This a fork of ethstats, but for Meter.

We highly encourage you to use the provided Dockerfile.

## Configuration

Before starting *you must* open the port **8545**. This is the RPC port and it's necessary to query block data.

Clone the repo

```bash
git clone https://github.com/nextblu/meter-stats-node.git
```

Now type

```bash
cd meter-stats-node
```

and follow the next section!

## Run

You can start the service with the following docker commands:

```bash
docker build . -t node_monitor
docker run -d -t node_monitor
```

🥳 Congratulations! Now you are part of the meterstats website!


Enter the validator Telegram group for more information: https://t.me/joinchat/amEwf_syLTFhYjRk

Ported and maintained by Jelly.