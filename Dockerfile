FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
EXPOSE 5000
CMD ["npm", "run", "eventsourced:start"]
