FROM node:22-slim
WORKDIR /app
# Fonts for the Stage 3.5 diagram-review rasterizer (@resvg/resvg-js). Without a
# system font installed, resvg renders all <text> labels blank — and the vision
# evaluator's whole job is reading those labels (CR-021).
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --production
COPY . .
ENV PORT=8080
CMD ["npm", "start"]
