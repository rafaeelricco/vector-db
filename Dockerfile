FROM docker.io/node:20
WORKDIR /app

RUN npm install --global corepack@latest
RUN corepack enable pnpm
RUN corepack use pnpm@latest-10

COPY package*.json ./
RUN pnpm install

COPY . .

RUN pnpm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
