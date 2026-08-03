FROM node:20-alpine
WORKDIR /app
# git: some Baileys deps install from git URLs. python3/make/g++: for any native builds.
RUN apk add --no-cache git python3 make g++
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
# ./auth holds the WhatsApp session — mount it as a volume so you don't re-scan.
CMD ["node", "index.mjs"]
