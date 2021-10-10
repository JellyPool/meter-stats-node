FROM node


WORKDIR /meter-stats-node
COPY . .
RUN npm install
RUN npm install -g pm2

ENV WS_SECRET="metermonitorsecret"
CMD ["pm2-runtime", "start", "app.json"]
