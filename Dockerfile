FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# data/ (session + anti-delete state) is mounted as a Fly volume at runtime,
# not baked into the image.
CMD ["node", "index.js"]
