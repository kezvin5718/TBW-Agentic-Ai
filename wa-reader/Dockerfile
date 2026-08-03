FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
# ./auth holds the WhatsApp session — mount it as a volume so you don't re-scan.
CMD ["node", "index.mjs"]
