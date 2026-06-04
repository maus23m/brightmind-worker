FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# CR-021a: fail the build if the WASM rasterizer can't turn text into a non-blank
# PNG (fonts are vendored under assets/, no system fonts needed). A broken
# rasterizer then never deploys, instead of silently no-opping Stage 3.5 in prod.
RUN node scripts/render_check.js
ENV PORT=8080
CMD ["npm", "start"]
