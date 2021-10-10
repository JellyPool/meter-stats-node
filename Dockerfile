FROM node

RUN git clone https://github.com/nextblu/meter-stats-node /meter-stats-node
WORKDIR /meter-stats-node
RUN npm install
RUN npm install -g pm2
RUN grunt poa

EXPOSE  3000
ENV WS_SECRET="metermonitorsecret"
CMD ["pm2", "start", "app.json"]
