FROM node:16.13.0
WORKDIR /app
COPY . .
RUN npm install
