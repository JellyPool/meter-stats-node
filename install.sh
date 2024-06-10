# Delete the meter-stats repo folder if exists
echo "Deleting repository folder..."
rm -rf ./meter-stats-node/

# Pull the git repo
echo "Cloning new repository version.."
git clone https://github.com/nextblu/meter-stats-node.git

# Terminate the node_monitor container
echo "Terminating node_monitor container.."
docker rm $(docker stop $(docker ps -a -q --filter ancestor=node_monitor --format="{{.ID}}"))

# Initialize the new container installation
echo "Building new node_monitor version.."
docker build --network host meter-stats-node/ -t node_monitor
echo "Running new node_monitor container.."
docker run -d --restart always -t node_monitor

# Done!
echo "Done! Thanks for your contribution! You can find your node here: https://meterstats.jellypool.xyz/"