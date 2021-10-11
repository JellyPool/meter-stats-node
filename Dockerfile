FROM node


WORKDIR /meter-stats-node
COPY . .
RUN npm install
RUN npm install -g pm2

RUN chmod +x ./perform_app_init.sh 
RUN ./perform_app_init.sh

ENV WS_SECRET="metermonitorsecret"
CMD ["pm2-runtime", "start", "app.json"]
